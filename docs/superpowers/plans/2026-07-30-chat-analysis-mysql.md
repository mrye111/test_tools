# 对话式需求分析工作台 + MySQL 持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 需求分析模块重构为 ChatGPT 式对话工作台（新聊天/会话视图/文件库/画布双来源），存储从 JSON 文件迁移到 MySQL（仅需求分析域）。

**Architecture:** 服务端新增 `chat` 域（db 连接池 + 双实现 Repository + SSE 对话流），前端新增 `chat/` 组件树（ChatShell/Sidebar/NewChatHome/ChatView/Composer/FileCard），画布页改为按 `?from=library` 双来源取数；旧 RequirementAnalysisPage 退役。

**Tech Stack:** React 19 + Vite 8 + Tailwind 4 / Express 5 + TypeScript / mysql2（原生驱动，无 ORM）/ Vitest（前端 jsdom + 服务端 node）

**Spec:** `docs/superpowers/specs/2026-07-30-chat-analysis-mysql-design.md`

## Global Constraints

- 不硬编码 MySQL 凭据：连接走环境变量，`.env` 进 `.gitignore`，提交 `.env.example`（值填 `127.0.0.1/3306/root/123456/ai_test_tools` 作为本地默认示例）
- MySQL 8.0，原生 `mysql2/promise`，无 ORM；库名 `ai_test_tools`，表前缀 `ra_`
- 只迁需求分析域；testcase/datafactory/jmeter 等 store 与路由一律不动
- 数据库不可用时降级内存实现继续服务，不阻断启动
- 流式沿用现有 SSE 管线：`sendSseEvent` + 90ms 合帧（`createStreamEmitter`），事件命名保持 `stage/stream/file/message/error/end` 风格
- 会话与文件库彻底解耦：入库 = 深拷贝快照；删会话不删库；会话内编辑永不自动入库
- 视觉改动全部收在 `.ra-chat` 命名空间新样式文件，不动全局 design token，不做暗色
- 智能体模板一期 5 个：mindmap（默认）/cause-effect/decision-table/orthogonal/flowchart
- 上限：每会话消息 200 条；单轮提问 2 万字符；每会话文件 30 份；文件库 500 份
- 测试沿用 Vitest；Repository 契约测试对内存/MySQL 双实现各跑一遍，MySQL 用例需 `TEST_MYSQL=1` 环境变量才启用，默认跳过
- 全程中文注释与提交信息；conventional commits 无 attribution
- lint 基线：既存 48 错误不新增（本计划完成后 `npm run lint` 错误数 ≤ 48）

## 文件结构

**服务端新增**（`ai-test-tools-site/server/src/features/requirement/`）：
- `db/pool.ts` — 连接池单例 + `initSchema()`（CREATE DATABASE/TABLE IF NOT EXISTS）+ 可用性探测
- `db/config.ts` — 从 `process.env` 读连接配置 + `.env` 加载（不引 dotenv 依赖，手写解析）
- `chat/types.ts` — ChatSession/ChatMessage/SessionFile/LibraryFile 类型 + AgentTemplate 枚举
- `chat/repository.ts` — 接口 `ChatRepository`（会话/消息/会话文件/文件库全部方法）+ 内存实现 `MemoryChatRepository`
- `chat/mysql-repository.ts` — MySQL 实现 `MysqlChatRepository`（同一接口）
- `chat/repository-contract.test.ts` — 双实现共享契约测试
- `chat/service.ts` — 对话流编排（模板分发：mindmap 走 analyzeRequirementText，图表走 generateBoardChartDraft 扩展 flowchart）
- `chat/routes.ts` — `/sessions`、`/chat`(SSE)、`/session-files`、`/library` 路由
- `chat/migrate.ts` — 旧 `requirement-analysis-store.json` 一次性导入文件库 + `.migrated` 改名

**服务端修改**：
- `board-prompts.ts` / `board-ai.ts` — 扩展 `flowchart` chartKind 契约
- `express-app.ts` — 注册 chat 路由 + 启动时 initSchema + 迁移
- `routes.ts`（requirement）— 删除 `POST /records`、`GET /records` 列表（界面下线）；保留 `/records/:id/board/generate`、`/export/xmind`

**前端新增**（`ai-test-tools-site/src/features/requirement-analysis/`）：
- `chat/agent-templates.ts` — 5 个模板共享常量（kind/名称/图标/描述/渐变色）
- `chat/chat-api.ts` — 会话域 fetch 封装（复用 `buildUrl` + SSE reader 模式）
- `chat/useChatStream.ts` — SSE 消费 hook + 消息流 reducer
- `chat/ChatShell.tsx`、`chat/ChatSidebar.tsx`、`chat/NewChatHome.tsx`、`chat/ChatComposer.tsx`、`chat/AgentTemplateChips.tsx`、`chat/ChatView.tsx`、`chat/MessageBubble.tsx`、`chat/FileCard.tsx`
- `library/LibraryPage.tsx`
- `chat/chat-glass.css` — `.ra-chat` 作用域全部玻璃拟态/渐变样式

**前端修改**：
- `board/types.ts` + `board/persistence.ts` — ElementKind 增加 `flowchart`
- `board/elements/flowchart.ts` + `renderer.ts` — 流程图绘制
- `board/ai.ts` — flowchart draftToElement 分支
- `pages/AnalysisBoardPage.tsx` — 双来源取数（session-file / library file）
- `App.tsx` — 新路由；`Navbar.tsx` — `/requirement-analysis` 整个前缀隐藏
- `TemplateCenterModal.tsx` + `templates.ts` — 收编测试设计图表，"使用模板"真实插入
- 删除：`pages/RequirementAnalysisPage.tsx`、`features/requirement-analysis/RequirementInput.tsx`、`AnalysisProgress.tsx`、`useAnalysisProcessStream.ts`、`FindingsPanel.tsx`

---

### Task 1: 环境配置与 DB 连接池 + Schema 初始化

**Files:**
- Create: `server/src/features/requirement/db/config.ts`
- Create: `server/src/features/requirement/db/pool.ts`
- Create: `server/.env.example`
- Modify: `server/src/features/requirement/db/.gitkeep` → 无（新目录）
- Test: `server/src/features/requirement/db/pool.test.ts`
- 根 `.gitignore` 追加 `.env`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `loadDbConfig(env: NodeJS.ProcessEnv): DbConfig`、`createChatPool(config): Pool | null`（连接失败返回 null）、`initSchema(pool: Pool): Promise<void>`、`ChatDbHandle { pool: Pool | null; mode: 'mysql' | 'memory' }`、`resolveChatDb(): Promise<ChatDbHandle>`

**说明**：不引 dotenv，手写 6 行解析；pool 用 `mysql2/promise` 的 `createPool`。先装依赖。

- [ ] **Step 1: 安装依赖 + 写 .env.example 与 .gitignore**

```bash
cd ai-test-tools-site && npm install mysql2
```

`server/.env.example`:
```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=123456
MYSQL_DATABASE=ai_test_tools
```

根 `.gitignore` 追加一行：`.env`

- [ ] **Step 2: 写失败测试 — config 解析与 pool 降级**

`server/src/features/requirement/db/pool.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { loadDbConfig } from "./config.js";

describe("loadDbConfig", () => {
  it("从环境变量读取并给出默认值", () => {
    const config = loadDbConfig({ MYSQL_USER: "root", MYSQL_PASSWORD: "x" } as NodeJS.ProcessEnv);
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3306);
    expect(config.database).toBe("ai_test_tools");
  });
});
```

- [ ] **Step 3: 实现 config.ts + pool.ts**

`config.ts`：读 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`，默认值如上；`loadDotEnv()` 手写解析 `server/.env`（`KEY=VALUE` 行，跳过注释与空行，不覆盖已有 env）。

`pool.ts`：
```typescript
import { createPool, type Pool } from "mysql2/promise";
import { loadDbConfig, loadDotEnv } from "./config.js";

const SCHEMA_STATEMENTS = [
  `CREATE DATABASE IF NOT EXISTS ai_test_tools CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  // ra_sessions / ra_messages / ra_session_files / ra_library_files 四张建表语句
];

export async function resolveChatDb(): Promise<ChatDbHandle> {
  loadDotEnv();
  const config = loadDbConfig(process.env);
  try {
    const pool = createPool({ ...config, waitForConnections: true, connectionLimit: 5 });
    await initSchema(pool);
    return { pool, mode: "mysql" };
  } catch {
    return { pool: null, mode: "memory" };
  }
}
```
建表语句按 spec §3 四张表（id VARCHAR(36) PK、各字段、FK ON DELETE CASCADE、JSON 列、DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)）。

- [ ] **Step 4: 跑测试确认通过 + lint**

Run: `cd ai-test-tools-site && npx vitest run server/src/features/requirement/db --reporter=verbose`
Expected: PASS（config 默认值用例）；无 TEST_MYSQL 时跳过真实连接用例。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 聊天域 MySQL 连接池与 schema 初始化"
```

---

### Task 2: Chat 类型与 Repository 接口 + 内存实现

**Files:**
- Create: `server/src/features/requirement/chat/types.ts`
- Create: `server/src/features/requirement/chat/repository.ts`
- Test: `server/src/features/requirement/chat/repository-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ChatDbHandle`
- Produces: `AgentTemplate = 'mindmap'|'cause-effect'|'decision-table'|'orthogonal'|'flowchart'`、`ChatSession`、`ChatMessage`、`SessionFile`、`LibraryFile`、`ChatRepository`（方法：`listSessions/getSession/createSession/renameSession/deleteSession`、`listMessages/createMessage/updateMessageStatus`、`getSessionFile/createSessionFile/updateSessionFileBoard/countSessionFiles`、`listLibraryFiles/getLibraryFile/createLibraryFile/deleteLibraryFile/countLibraryFiles/markSavedToLibrary`）、`MemoryChatRepository implements ChatRepository`

**说明**：接口先定，内存实现先过全部契约测试；MySQL 实现在 Task 3。

- [ ] **Step 1: 写契约测试骨架（对内存实现跑）**

`repository-contract.test.ts` 导出一个 `runContractTests(name, factory)` 函数，内含用例：
- createSession/listSessions 按 updated_at 倒序
- createMessage 追加与 listMessages 按 created_at 升序
- deleteSession 级联删消息与文件、不删文件库
- saveToLibrary 语义：createLibraryFile 从 sessionFile 快照 + markSavedToLibrary 幂等
- countLibraryFiles 一致性

先用 `MemoryChatRepository` 跑。

- [ ] **Step 2: 跑测试确认失败（接口未实现）**

Expected: FAIL，"MemoryChatRepository is not defined"

- [ ] **Step 3: 实现 types.ts + repository.ts（内存）**

`types.ts` 按 spec §3 字段；`MemoryChatRepository` 用 `Map` 存四组实体，`deleteSession` 手动级联；`createLibraryFile(source: SessionFile)` 深拷贝 payload。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run server/src/features/requirement/chat/repository-contract.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 聊天域 Repository 接口与内存实现"
```

---

### Task 3: MySQL Repository 实现

**Files:**
- Create: `server/src/features/requirement/chat/mysql-repository.ts`
- Test: 复用 `repository-contract.test.ts`（加 MySQL 分支）

**Interfaces:**
- Consumes: Task 1 `Pool`、Task 2 `ChatRepository` 接口与契约测试
- Produces: `MysqlChatRepository implements ChatRepository`（构造接收 `Pool`）

**说明**：同一套契约测试对两个实现各跑一遍；MySQL 分支 `it.skipIf(!process.env.TEST_MYSQL)`。

- [ ] **Step 1: 契约测试加 MySQL 分支**

```typescript
const runMysql = !!process.env.TEST_MYSQL;
(runMysql ? describe : describe.skip)("MysqlChatRepository 契约", async () => {
  const { resolveChatDb } = await import("../db/pool.js");
  const handle = await resolveChatDb();
  runContractTests("mysql", () => new MysqlChatRepository(handle.pool!));
});
```

- [ ] **Step 2: 实现 MysqlChatRepository**

手写 SQL；JSON 列 `JSON.stringify/parse`；`updateSessionFileBoard` 只更新 `payload` 内 board 字段所在 JSON（整 payload 覆盖写）；`deleteSession` 依赖 FK CASCADE。

- [ ] **Step 3: 本地 MySQL 跑契约（TEST_MYSQL=1）+ 默认跳过确认**

Run: `TEST_MYSQL=1 npx vitest run server/src/features/requirement/chat/repository-contract.test.ts`（用户本地有 MySQL 8.0）
Expected: 双实现全绿；不带环境变量时 MySQL describe 被 skip。

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: 聊天域 MySQL Repository 实现"
```

---

### Task 4: flowchart 图表契约扩展（board-prompts + board-ai）

**Files:**
- Modify: `server/src/features/requirement/board-prompts.ts`
- Modify: `server/src/features/requirement/board-ai.ts`
- Test: `server/src/features/requirement/board-ai.test.ts`（追加）

**Interfaces:**
- Consumes: 现有 `generateBoardChartDraft`
- Produces: `BoardChartKind` 增加 `'flowchart'`；`buildFlowchartMessages`（nodes: `{id,text,kind:'process'|'decision'|'start'|'end',x,y}`，edges: `{from,to,label?}`）

**说明**：与因果图同构（节点-边），prompt 契约同形态，draftToElement 前端在 Task 10 处理。

- [ ] **Step 1: 写失败测试 — flowchart prompt 结构与解析**

断言 `buildBoardChartMessages({chartKind:'flowchart'})` 产出含 nodes/edges 契约的 system prompt；`generateBoardChartDraft` 对合法 flowchart JSON 返回解析对象。

- [ ] **Step 2: 跑测试确认失败**

Expected: flowchart 不在 BoardChartKind 联合类型 → 类型错误/运行时白名单拒绝

- [ ] **Step 3: 实现 flowchart 契约**

`BoardChartKind` 加 `'flowchart'`；`SYSTEM_PROMPTS` 加 `FLOWCHART_SYSTEM_PROMPT`（节点 kind 枚举 + x/y 布局建议 + 文本 ≤200 + 节点 ≤60 + 只输出 JSON）。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 白板图表契约扩展流程图"
```

---

### Task 5: chat/service.ts — 对话流编排

**Files:**
- Create: `server/src/features/requirement/chat/service.ts`
- Test: `server/src/features/requirement/chat/service.test.ts`

**Interfaces:**
- Consumes: `ChatRepository`、`analyzeRequirementText`、`generateBoardChartDraft`、`parseAiRequestConfig`
- Produces: `runChatTurn(opts: { repo, sessionId | null, agentTemplate, text, aiConfig, emit, signal }): Promise<{ sessionId, messageId, file? }>`；模板分发逻辑；追问上下文拼接（已有文件标题 + 最近 20 条消息截断）

**说明**：mock AI 与 repo，断言事件序列与产物落库，不起真服务。

- [ ] **Step 1: 写失败测试 — 首轮 mindmap 事件序列 + 追问图表**

用例：
1. 无 sessionId + mindmap → 依次 `session`→`stage`→`stream`(若干)→`file`→`message`→`end`，repo 中会话/消息/文件各一条
2. 有 sessionId + cause-effect 追问 → 不发 `session`，`file` 事件 kind=cause-effect，消息关联 session
3. AI 抛错 → `error` + `end{ok:false}`，assistant 消息 status=error

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 service.ts**

`runChatTurn`：缺 session 则创建（title=text 前 20 字）；写 user 消息；按模板分发；mindmap 流式转发 reasoning/content 并累积，结束构造 SessionFile payload（tree/findings/sourceText + 空 board）；图表模板调用 generateBoardChartDraft，payload 为 `{ draft }` 包装（前端 draftToElement 在画布/卡片打开时转）；写 assistant 消息（status=done）+ 发 `file`/`message`；catch 写 error 消息 + rethrow 给路由发 error 事件。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 对话流编排与模板分发"
```

---

### Task 6: chat/routes.ts + 启动接线（initSchema + 迁移 + 路由注册）

**Files:**
- Create: `server/src/features/requirement/chat/routes.ts`
- Create: `server/src/features/requirement/chat/migrate.ts`
- Modify: `server/src/express-app.ts`
- Test: `server/src/features/requirement/chat/routes.test.ts`（supertest 风格，内存 repo 注入）

**Interfaces:**
- Consumes: Task 1 `resolveChatDb`、Task 2/3 repo、Task 5 `runChatTurn`
- Produces: `registerChatRoutes(app, repo)`；全部 REST 端点（spec §4）；`migrateLegacyStore(pool | null)`；`bootstrapChat(): Promise<ChatRepository>`（resolveChatDb → 选实现 → initSchema → migrate → 返回 repo）

**说明**：路由层用可注入 repo 的工厂，测试用内存实现；真实启动用 bootstrapChat。

- [ ] **Step 1: 写失败测试 — 关键端点行为**

supertest 用例：GET /sessions 倒序；POST /chat 无 sessionId 返回 SSE 流含 session 事件；GET /session-files/:id 取 payload；POST save-to-library 幂等（二次 200 + count 不变）；DELETE /sessions/:id 后 GET /library/files 仍在。

- [ ] **Step 2: 跑测试确认失败（路由未注册）**

- [ ] **Step 3: 实现 routes.ts + migrate.ts + express-app 接线**

routes.ts 按 spec §4 端点表；`/chat` 走 SSE（beginSse/emit/endSse 复用 requirement/routes.ts 同款，抽到 chat/sse.ts 或直接复用）；migrate.ts 读旧 JSON → createLibraryFile(kind=mindmap) → renameSync 加 `.migrated`；express-app.ts 在 `registerRequirementRoutes` 前 `const chatRepo = await bootstrapChat(); registerChatRoutes(app, chatRepo);`（express-app 工厂改 async）。

- [ ] **Step 4: 跑测试确认通过 + 服务端构建**

Run: `npm run server:build` + `npx vitest run server/src/features/requirement/chat/routes.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 聊天域 REST/SSE 路由与启动迁移"
```

---

### Task 7: 退役旧记录路由 + 前端 chat-api 封装

**Files:**
- Modify: `server/src/features/requirement/routes.ts`（删 POST /records、GET /records 列表）
- Create: `src/features/requirement-analysis/chat/chat-api.ts`
- Create: `src/features/requirement-analysis/chat/agent-templates.ts`
- Test: `src/features/requirement-analysis/chat/chat-api.test.ts`

**Interfaces:**
- Consumes: 服务端 REST/SSE 端点；现有 `buildUrl`、`parseJson`、SSE reader 模式
- Produces: `listSessions/getSession/renameSession/deleteSession`、`getSessionFile/updateSessionFileBoard/saveToLibrary`、`listLibraryFiles/getLibraryFile/updateLibraryFileBoard/deleteLibraryFile/getLibraryCount`、`chatStream(body, onEvent): Promise<ChatTurnResult>`；`AGENT_TEMPLATES: AgentTemplateMeta[]`（kind/label/icon/desc/gradient）

**说明**：chat-api 的 SSE reader 参照 `analyzeRequirement` 的 reader 循环（140-178 行），事件类型换成 chat 域（session/stage/stream/file/message/error）。

- [ ] **Step 1: 写失败测试 — agent-templates 常量与 chatStream 事件分发**

mock fetch 返回 SSE 文本流，断言 onEvent 收到 session/stream/file/message 序列；AGENT_TEMPLATES 长度 5 且首项 mindmap。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 chat-api.ts + agent-templates.ts + 服务端路由裁剪**

chat-api 用 buildUrl + fetch reader；agent-templates 五项（图标从 lucide-react 选：ListTree/GitGraph/Table2/Binary/Workflow）；routes.ts 删除 POST /records 与 GET /records 列表及 toAnalysisRecordSummary 引用。

- [ ] **Step 4: 跑测试确认通过 + 前端类型检查**

Run: `npx vitest run src/features/requirement-analysis/chat && npx tsc -b --noEmit`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 前端聊天 API 封装与智能体模板常量;退役旧记录路由"
```

---

### Task 8: useChatStream hook + 消息流 reducer

**Files:**
- Create: `src/features/requirement-analysis/chat/useChatStream.ts`
- Test: `src/features/requirement-analysis/chat/useChatStream.test.ts`

**Interfaces:**
- Consumes: Task 7 `chatStream`
- Produces: `useChatStream(sessionId)` 返回 `{ messages, streaming, send(text, template), retry(messageId), error }`；reducer 处理 session/stream(追加 reasoning/content)/file(挂卡片)/message(落定)/error(标 error 态)

**说明**：纯 hook 逻辑，用 `@testing-library/react` 的 `renderHook` + mock chatStream。

- [ ] **Step 1: 写失败测试 — 流式追加与断流 error 态**

用例：send 后 messages 出现 user + 流式 assistant；逐 stream 事件 content 累积；file 事件挂到该 assistant 消息 files 数组；end 后 streaming=false；error 事件→该消息 status=error 且 retry 可用。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 useChatStream.ts**

reducer + useReducer；send 时先乐观插 user 消息与占位的 streaming assistant 消息；retry=同 text+template 重新 send。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 聊天流式 hook 与消息流 reducer"
```

---

### Task 9: ChatShell + ChatSidebar + 路由接线（含 Navbar 隐藏）

**Files:**
- Create: `src/features/requirement-analysis/chat/ChatShell.tsx`
- Create: `src/features/requirement-analysis/chat/ChatSidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Navbar.tsx`
- Test: `src/features/requirement-analysis/chat/ChatSidebar.test.tsx`

**Interfaces:**
- Consumes: Task 7 `listSessions/getLibraryCount`；现有 `Tooltip`、lucide 图标
- Produces: `ChatShell`（左侧栏 + Outlet 主区）；`ChatSidebar`（Logo 回首页/新聊天/文件库徽章/+1 动画/最近会话列表）；路由 `/requirement-analysis`(新聊天)、`/requirement-analysis/chat/:sessionId`、`/requirement-analysis/library`、`/requirement-analysis/board/:fileId?from=library`；Navbar 对 `/requirement-analysis` 前缀返回 null

**说明**：+1 动画通过 `save-to-library` 响应带回 count 触发：sidebar 暴露自定义事件或简单模块级 store（先用 `window.dispatchEvent(new CustomEvent('ra-library-count', {detail}))`，最小实现）。

- [ ] **Step 1: 写失败测试 — 边栏渲染与 +1 动画触发**

断言 Logo/新聊天/文件库/最近列表存在；dispatch `ra-library-count` 事件后徽章出现 `is-bumping` 类与 count 更新。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 ChatShell/ChatSidebar + 路由 + Navbar**

App.tsx 加嵌套路由（ChatShell 包裹三个子路由）；Navbar `isBoardRoute` 改为 `location.pathname.startsWith('/requirement-analysis')`；ChatSidebar 监听自定义事件播动画。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 聊天工作台壳与左侧栏及路由接线"
```

---

### Task 10: 画板 flowchart 图元（types + persistence + renderer + ai）

**Files:**
- Modify: `src/features/requirement-analysis/board/types.ts`
- Modify: `src/features/requirement-analysis/board/persistence.ts`
- Create: `src/features/requirement-analysis/board/elements/flowchart.ts`
- Modify: `src/features/requirement-analysis/board/renderer.ts`
- Modify: `src/features/requirement-analysis/board/ai.ts`
- Modify: `src/features/requirement-analysis/board/hit-test.ts`
- Test: `src/features/requirement-analysis/board/flowchart.test.ts`

**Interfaces:**
- Consumes: 现有 cause-effect 绘制/命中/命令模式；Task 4 flowchart draft 契约
- Produces: `FlowchartElement`（nodes: `{id,text,kind,x,y}`，edges: `{from,to,label?}`）；`drawFlowchart`；draftToElement flowchart 分支；hit-test flowchart 分支

**说明**：与 cause-effect 同构，最大限度复用；节点形状按 kind（start/end 圆角胶囊、decision 菱形、process 矩形）。

- [ ] **Step 1: 写失败测试 — 序列化/反序列化 + draftToElement flowchart**

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 flowchart 全链路**

types 加 FlowchartElement；persistence 加 parse 分支；elements/flowchart.ts 仿 cause-effect.ts；renderer 注册；ai.ts draftToElement 分支；hit-test 节点命中分支。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 画板流程图图元渲染与草稿转换"
```

---

### Task 11: NewChatHome + ChatComposer + AgentTemplateChips

**Files:**
- Create: `src/features/requirement-analysis/chat/NewChatHome.tsx`
- Create: `src/features/requirement-analysis/chat/ChatComposer.tsx`
- Create: `src/features/requirement-analysis/chat/AgentTemplateChips.tsx`
- Test: `src/features/requirement-analysis/chat/NewChatHome.test.tsx`

**Interfaces:**
- Consumes: Task 7 `AGENT_TEMPLATES`、Task 8 `useChatStream`、TemplateCenterModal
- Produces: 新聊天首页（问候 + 大输入框 + chips + 示例卡片）；Composer 受控组件（value/template/disabled/onSubmit，大小两形态）；chips 选中联动 + "更多智能体"弹模板中心

- [ ] **Step 1: 写失败测试 — 模板选择与提交**

渲染 NewChatHome；点击"因果图"chip → composer 显示该模板；输入文本提交 → 调 send(text,'cause-effect')；点"更多智能体"→ 模板中心弹窗出现。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现三组件**

NewChatHome 组装；ChatComposer 受控 + Enter 发送/Shift+Enter 换行；AgentTemplateChips 五项 + 更多按钮。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 新聊天首页与输入框及模板选择"
```

---

### Task 12: ChatView + MessageBubble + FileCard

**Files:**
- Create: `src/features/requirement-analysis/chat/ChatView.tsx`
- Create: `src/features/requirement-analysis/chat/MessageBubble.tsx`
- Create: `src/features/requirement-analysis/chat/FileCard.tsx`
- Test: `src/features/requirement-analysis/chat/ChatView.test.tsx`

**Interfaces:**
- Consumes: Task 8 `useChatStream`、Task 7 `saveToLibrary`、Task 11 `ChatComposer`(小形态)
- Produces: 会话视图（消息流 + 沉底小输入框 + 自动滚动）；MessageBubble（user 渐变气泡 / assistant 正文 + 折叠 reasoning）；FileCard（kind 渐变图标 + 标题 + [打开画布][保存到文件库/已保存]）

- [ ] **Step 1: 写失败测试 — 消息渲染与文件卡片行为**

mock 会话含一条带 file 的 assistant 消息；断言卡片标题；点"保存到文件库"→ 调 saveToLibrary → 按钮变"已保存"且 dispatch 徽章事件；点"打开画布"→ navigate `/requirement-analysis/board/:fileId`。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现三组件**

ChatView 按 :sessionId getSession 拉历史 + useChatStream；FileCard 两按钮 + saved 态；MessageBubble 折叠 reasoning（details/summary 或受控展开）。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 会话视图与消息气泡及文件卡片"
```

---

### Task 13: LibraryPage + AnalysisBoardPage 双来源改造

**Files:**
- Create: `src/features/requirement-analysis/library/LibraryPage.tsx`
- Modify: `src/pages/AnalysisBoardPage.tsx`
- Test: `src/features/requirement-analysis/library/LibraryPage.test.tsx`
- Test: `src/pages/AnalysisBoardPage.test.tsx`（追加 from=library 用例）

**Interfaces:**
- Consumes: Task 7 library API、`getSessionFile/updateSessionFileBoard`
- Produces: 文件库卡片网格页；画布页按 `?from=library` 切换数据源（getLibraryFile/getSessionFile）与持久化目标（updateLibraryFileBoard/updateSessionFileBoard）；`from=library` 时标题带"文件库副本"徽标

- [ ] **Step 1: 写失败测试 — 文件库列表渲染 + 画布双来源**

LibraryPage 渲染卡片（kind 徽章 + 时间），点击 → navigate board 带 `?from=library`；AnalysisBoardPage 带 from=library 时调 getLibraryFile 而非 getSessionFile。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 LibraryPage + 画布改造**

AnalysisBoardPage 用 `useSearchParams` 读 from；数据源与 useBoardPersistence 的 PATCH 目标按来源切换；标题栏条件渲染徽标。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 文件库页与画板双来源打开"
```

---

### Task 14: 模板中心收编 + 旧页面退役 + chat-glass.css 视觉收尾

**Files:**
- Modify: `src/features/requirement-analysis/TemplateCenterModal.tsx`
- Modify: `src/features/requirement-analysis/templates.ts`
- Create: `src/features/requirement-analysis/chat/chat-glass.css`
- Delete: `src/pages/RequirementAnalysisPage.tsx`、`RequirementInput.tsx`、`AnalysisProgress.tsx`、`useAnalysisProcessStream.ts`、`FindingsPanel.tsx`
- Modify: `src/index.css`（引入 chat-glass.css）
- Test: 删除对应旧测试；`TemplateCenterModal.test.tsx`（更新）

**Interfaces:**
- Consumes: Task 7 `AGENT_TEMPLATES`、画板插入能力（AnalysisBoard 的 handleInsertChart）
- Produces: 模板中心"使用模板"在画板内真实插入（测试设计图表 → AI 生成插入；静态模板 → 占位提示）；`.ra-chat` 全部视觉样式；旧页面组件清理

- [ ] **Step 1: 更新/写失败测试 — 模板中心图表模板插入**

断言测试设计分类含因果图/判定表/正交表/流程图/思维导图；画板内点"使用模板"→ 触发对应 handleInsertChart。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现模板中心接通 + 视觉样式 + 删除旧页面**

templates.ts 增加"测试设计"分类（复用 AGENT_TEMPLATES 五项）；TemplateCenterModal "使用模板"按 kind 回调插入；chat-glass.css 按 spec §6 全部样式（背景光斑/玻璃输入框/渐变发送键/chips/气泡/文件卡片/边栏/徽章动画）；删除旧页面与组件及其测试；index.css 引入新样式文件；App.tsx 移除旧 RequirementAnalysisPage 引用。

- [ ] **Step 4: 全量验证**

Run: `npm run test`（全绿）、`npx tsc -b --noEmit`、`npm run lint`（错误数 ≤ 48）、`npm run build`
浏览器走查（preview）：①新聊天→流式→卡片→入库(+1 动画)→画布编辑→刷新恢复；②最近会话→回看→追问→删会话→库文件仍在；③文件库→画布编辑→会话原件不变。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 模板中心收编测试设计图表与旧分析页退役;聊天工作台视觉收尾"
```

---

## Self-Review

**Spec coverage:**
- §3 数据模型/迁移 → Task 1/2/3/6 ✓
- §4 API（会话/消息/chat SSE/会话文件/文件库/退役保留）→ Task 5/6/7 ✓
- §5 前端路由与组件（ChatShell/Sidebar/NewChatHome/Composer/Chips/ChatView/Bubble/FileCard/useChatStream/LibraryPage/旧物处置）→ Task 7-14 ✓
- §6 视觉 → Task 14 chat-glass.css ✓
- §7 错误处理（降级/断流/校验失败/幂等/删除保护/上限/空态）→ Task 2（上限计数）、5（error 落库）、6（幂等/级联）、1（降级）、12（重试）✓
- §8 测试策略 → 每任务 TDD + Task 14 全量验证 ✓
- flowchart 全链路 → Task 4（契约）+ Task 10（画板）✓

**Placeholder scan:** 各任务均含具体代码/接口/命令；Task 1 建表语句以注释占位四张表名但 spec §3 已给出全部字段（实现者照抄），其余无 TBD/TODO。

**Type consistency:** AgentTemplate 五值在 Task 2/7/11/14 一致；`ChatDbHandle`、`runChatTurn`、`bootstrapChat`、`registerChatRoutes` 命名跨任务一致；SSE 事件名（session/stage/stream/file/message/error/end）前后端一致。
