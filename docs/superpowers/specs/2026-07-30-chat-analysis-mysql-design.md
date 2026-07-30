# 对话式需求分析工作台 + MySQL 持久化 设计文档

- 日期:2026-07-30
- 状态:已确认(六节设计逐节通过)
- 前置:ADR 0005/0006/0007(分析画板)、2026-07-29-test-design-canvas-design.md(测试设计画布)

## 1. 背景与目标

需求分析模块从"表单 + 记录列表"重构为 ChatGPT 式对话工作台:

- 新聊天首页(图2 风格):居中问候 + 大输入框 + 智能体模板 chips + 示例卡片
- 会话视图(图4 风格):消息流 + 沉底小输入框,可续聊,每轮产出文件卡片
- 文件库:会话产出**手动保存**才入库,卡片网格展示,与会话完全解耦
- 画布:会话文件与文件库文件双来源打开,各自独立编辑持久化
- 画板左栏测试设计图表(因果图/判定表/正交表)收编进模板中心;智能体模板成为"生成方案"的统一入口
- 存储从 JSON 文件迁移到 MySQL(仅需求分析域)
- 全程流式输出(打字机正文 + 完成后文件卡片)

非目标:测试用例等其他工具域的存储迁移;全站换肤;暗色模式;画布增量协议(图表渐进渲染);会话协作/分享。

## 2. 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 会话与画布关系 | 一轮提问产出一份文件卡片;追问追加新卡片(追加产物模式),会话可持续追问(含历史会话) |
| 会话与文件库 | 彻底解耦。手动"保存到文件库"=深拷贝快照;删会话不删库;会话内编辑永不自动入库 |
| 画布副本 | 会话文件与文件库文件两份独立副本,各自可编辑、各自持久化 |
| 文件库打开行为 | 卡片点击直接进画布,可编辑 |
| 智能体模板 | 一期 5 个:思维导图(默认)/因果图/判定表/正交表/流程图;"更多智能体"入口保留(弹模板中心) |
| 流式形态 | 打字机正文 + 可折叠思考过程 + 完成后文件卡片(复用 SSE 合帧管线) |
| MySQL | 8.0,原生 mysql2 + 手写 SQL,仅迁需求分析域;库名 ai_test_tools,表前缀 ra_ |
| 连接配置 | 环境变量(.env),.env.example 入库,真实 .env 进 .gitignore,不硬编码 |
| 边栏 | Logo(点击回首页)/新聊天/文件库(徽章+1 动画)/"最近"会话列表;无模板中心与设置入口 |
| 视觉范围 | 只重做需求分析模块,浅色 + 紫蓝渐变 + 玻璃拟态,.ra-chat 命名空间,不动全局 token |
| DB 不可用 | 降级内存态继续服务 + 横幅提示,不阻断启动;重启恢复 |

## 3. 数据模型(MySQL)

库:`ai_test_tools`,启动时 `CREATE DATABASE IF NOT EXISTS` + 自动建表。

环境变量:

```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=123456
MYSQL_DATABASE=ai_test_tools
```

四张表:

### ra_sessions
| 字段 | 类型 | 说明 |
|---|---|---|
| id | VARCHAR(36) PK | `sess_` 前缀 + uuid |
| title | VARCHAR(200) | 首轮提问前 20 字自动生成,可重命名 |
| agent_template | VARCHAR(32) | 首轮模板 kind |
| created_at / updated_at | DATETIME(3) | updated_at 驱动边栏排序 |

### ra_messages
| 字段 | 类型 | 说明 |
|---|---|---|
| id | VARCHAR(36) PK | `msg_` 前缀 |
| session_id | VARCHAR(36) FK → ra_sessions ON DELETE CASCADE | |
| role | ENUM('user','assistant') | |
| content | MEDIUMTEXT | 正文(assistant 为流式收敛文案) |
| reasoning | MEDIUMTEXT NULL | 思考过程(可折叠展示) |
| status | ENUM('streaming','done','error') | 断流残骸为 error |
| created_at | DATETIME(3) | |

### ra_session_files
| 字段 | 类型 | 说明 |
|---|---|---|
| id | VARCHAR(36) PK | `sf_` 前缀;画布 `/board/:fileId` 默认来源 |
| session_id | VARCHAR(36) FK ON DELETE CASCADE | |
| message_id | VARCHAR(36) FK ON DELETE CASCADE | 产出于哪条消息 |
| kind | ENUM('mindmap','cause-effect','decision-table','orthogonal','flowchart') | |
| title | VARCHAR(200) | |
| payload | JSON | `{ tree, findings, sourceText, board }`,直接喂画板反序列化 |
| saved_to_library | TINYINT(1) | 防重复入库标志,不建立引用 |
| created_at / updated_at | DATETIME(3) | 会话内编辑写回 payload 更新 |

### ra_library_files
| 字段 | 类型 | 说明 |
|---|---|---|
| id | VARCHAR(36) PK | `lf_` 前缀;画布 `?from=library` 来源 |
| kind / title | 同上 | |
| payload | JSON | 入库时从会话文件深拷贝,之后完全独立 |
| source_session_title | VARCHAR(200) | 仅展示用溯源文案 |
| created_at / updated_at | DATETIME(3) | |

### 启动迁移

检测到 `server/data/requirement-analysis-store.json` 存在时:旧分析记录一次性导入为文件库文件(kind=mindmap,payload 含 tree/findings/sourceText/board),完成后原文件重命名加 `.migrated` 后缀。旧记录无会话上下文,放文件库是不丢数据的唯一去处。

## 4. 服务端 API

全部挂在 `/api/requirement-analysis/` 下,沿用 `{success, ...}` 信封与 SSE 风格。

### 会话与消息

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sessions` | 最近会话列表(updated_at 倒序,limit 50) |
| GET | `/sessions/:id` | 会话详情 + 全量消息(每条消息挂文件卡片) |
| PATCH | `/sessions/:id` | 重命名(title) |
| DELETE | `/sessions/:id` | 删除会话,级联删消息与会话文件;不影响文件库 |

### 对话流(核心)

`POST /chat`(SSE)。body:`{ sessionId?, agentTemplate, text, ai_config }`。

- 无 sessionId → 创建新会话,`session` 事件下发 { id, title }
- 事件序列:`session`(新建时)→ `stage` → `stream`(reasoning/content,90ms 合帧)→ `file`({ sessionFileId, kind, title })→ `message`(assistant 落库完成)→ `end{ok}`
- 失败:`error` + `end{ok:false}`
- 模板分发:mindmap 走现有 `analyzeRequirementText` 流式;其余四种走 board prompt 契约(`generateBoardChartDraft` 扩展 flowchart 契约)
- 上下文:首轮=用户提问文本;追问轮=会话历史摘要 + 已有文件标题 + 本轮文本

### 会话文件与文件库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/session-files/:id` | 取 payload(画布打开) |
| PATCH | `/session-files/:id` | 写回 board(会话内编辑,前端 1.5s 防抖) |
| POST | `/session-files/:id/save-to-library` | 幂等入库;返回 { libraryFileId, libraryCount } |
| GET | `/library/files` | 卡片列表(id/kind/title/updatedAt) |
| GET | `/library/files/:id` | payload(画布 from=library) |
| PATCH | `/library/files/:id` | 文件库画布编辑持久化 |
| DELETE | `/library/files/:id` | 删除(确认后,不可恢复) |
| GET | `/library/count` | 总数(边栏徽章) |

### 退役与保留

- 退役:旧 `POST /records`(前端不再直接建记录)、`GET /records` 列表(界面重构下线)
- 保留:`/records/:id/board/generate`(画板内插入图表仍用)、`/export/xmind`

## 5. 前端结构

### 路由

| 路由 | 页面 |
|---|---|
| `/requirement-analysis` | 新聊天首页 |
| `/requirement-analysis/chat/:sessionId` | 会话视图 |
| `/requirement-analysis/library` | 文件库 |
| `/requirement-analysis/board/:fileId` | 画布(`?from=library` 区分来源) |

整个模块隐藏主站 Navbar(复用 isBoardRoute 同款判定)。

### 组件(新目录 src/features/requirement-analysis/chat/)

```
chat/
├── ChatShell.tsx          # 工作台壳:左侧栏 + 主区
├── ChatSidebar.tsx        # Logo(回首页)/新聊天/文件库(徽章+1 动画)/最近会话列表
├── NewChatHome.tsx        # 问候 + 大输入框 + 模板 chips + 示例卡片
├── ChatComposer.tsx       # 输入框:模板联动、发送、流式禁用;大/小两形态
├── AgentTemplateChips.tsx # 5 模板 + "更多智能体"(弹模板中心)
├── ChatView.tsx           # 消息流 + 沉底小输入框;自动滚动到底
├── MessageBubble.tsx      # user/assistant 气泡;思考过程可折叠
├── FileCard.tsx           # 文件卡片:[打开画布][保存到文件库/已保存]
└── useChatStream.ts       # SSE 消费:事件分发、消息流 reducer、断流处理
library/
└── LibraryPage.tsx        # 卡片网格 + 页头计数 + 搜索
```

### 数据流

- `useChatStream` reducer:streaming 逐帧追加 reasoning/content;`file` 事件往当前 assistant 消息挂卡片;`message` 落定;卸载/断流 → error 态可重试
- 会话切换=路由切换,ChatView 按 :sessionId 自拉(直达语义,同画板页)
- 文件库徽章:save-to-library 响应带回新总数 → 先播 +1 动画再更新数字,免轮询
- 画布页:fileId + `?from=library` 决定调 session-files 还是 library 接口;持久化 hook 按来源切换 PATCH 目标
- 智能体模板定义抽共享常量(kind/名称/图标/描述/渐变色),chips/文件卡片/模板中心三处共用

### 旧物处置

- 删除:`RequirementAnalysisPage`(列表+弹窗表单)、`RequirementInput`、`AnalysisProgress`(被 ChatComposer/MessageBubble 取代)
- 保留并接通:模板中心弹窗("使用模板"在画板内真正插入;图表模板=画板 AI 生成入口)
- FindingsPanel 孤儿组件一并删除(此前遗留)

## 6. 视觉设计

- 命名空间:全部样式收 `.ra-chat` 作用域,不动全局 token,不做暗色
- 背景:近白底(#f7f8fc 级)+ 2-3 个弥散柔光斑(radial-gradient 淡紫/淡青,blur 80px 级,静态)
- 玻璃输入框:backdrop-blur(20px)+ rgba(255,255,255,0.55) + 1px 半透白边 + 24px 圆角;聚焦泛紫蓝渐变光晕
- 发送按钮:紫→蓝线性渐变(#8b5cf6 → #3b82f6)圆形,hover 微放大
- 模板 chips:玻璃胶囊,每模板双色渐变图标底(思维导图紫蓝/因果图橙粉/判定表青绿/正交表蓝靛/流程图紫粉);选中=渐变描边
- 消息:user 紫蓝渐变底白字靠右;assistant 无气泡底,思考过程灰玻璃折叠条
- 文件卡片:玻璃卡 + kind 渐变图标 + hover 浮起;"保存到文件库"渐变描边按钮
- 边栏:半透白玻璃 blur(24px);当前项紫蓝淡底;徽章=渐变数字胶囊
- +1 动画:徽章上方冒 "+1" 小胶囊上浮渐隐 0.6s → 数字缩放弹跳(1→1.25→1)
- 问候语:font-display 粗字重 + 紫蓝渐变文字(background-clip: text)
- 动效克制:只做 +1 徽章、卡片 hover、输入框聚焦光晕三处;不引入液态金属/3D 重特效

## 7. 错误处理与边界

- MySQL 连接失败:降级内存态 + 页面横幅"数据库不可用,本次会话内容不会持久保存";不阻断启动;重启恢复(日志写明语义)
- 断流:服务端 res.close 即 abort 上游,半截消息以 status=error 落库;前端显示"生成中断" + 重试按钮(同模板同文本新发一轮,不覆盖残骸)
- AI 产物校验失败:修复重试一次;仍失败 → 正文"生成失败"说明,不挂卡片,会话可继续
- save-to-library 幂等:已入库直接返回 200 + 当前总数;入库后源会话文件被级联删除不影响库副本
- 删除保护:删会话确认文案明示"文件库已存文件不受影响";文件库删除同样确认
- 并发边界:画布打开期间会话被删 → PATCH 404,提示"会话已删除"并引导回首页,编辑丢弃
- 上限:每会话消息 200 条;单轮文本 2 万字符;每会话文件 30 份;文件库 500 份(达到返回 409)
- 空态:最近会话"还没有会话";文件库空态插图 + 引导;新聊天示例卡片 4 张静态预置

## 8. 测试策略

- Repository:接口双实现(内存/MySQL)同一套契约测试;MySQL 实现需 `TEST_MYSQL=1` 才启用,默认跳过
- 路由:会话 CRUD、消息拉取、save-to-library 幂等、级联删除不碰文件库、count 一致性
- chat 流式:mock AI,断言 SSE 事件序列、断流 abort、error 落库
- 启动迁移:旧 JSON → 导入文件库 + 原文件改名
- 前端:useChatStream reducer 各事件形态;NewChatHome/ChatView/FileCard/ChatSidebar(徽章动画);画布双来源
- 旧 RequirementAnalysisPage 测试随删除移除,新页面测试补齐
- E2E 走查:①新聊天→流式→卡片→入库(+1)→画布编辑→刷新恢复;②最近会话→回看→追问→删会话→库文件仍在;③文件库→画布编辑→会话原件不变
- 覆盖率沿用 80% 目标,新模块 TDD

## 9. 风险

| 风险 | 缓解 |
|---|---|
| flowchart 为新图元种类,画板渲染/命中/命令需扩展 | 复用 cause-effect 节点-边模式,prompt 契约同构;单独任务兜底 |
| 追问上下文的会话历史摘要质量 | 一期用"已有文件标题 + 最近 N 条消息截断"朴素拼接,不引入向量检索 |
| 双副本语义被用户误解(改了会话件以为库件同步) | 入库按钮文案"保存副本到文件库";画布页 from=library 时标题栏带"文件库副本"徽标 |
| 内存降级态下数据丢失误解 | 横幅常驻明示;重启恢复后降级态数据丢弃(日志记录) |
