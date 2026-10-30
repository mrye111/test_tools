---
title: P2 探源引擎与 Sources 页
type: task
status: done
assignee: main-session
blocked_by: [p1-project-shell]
---

## Question

TestSprite Sources 页：agent 自动爬站并捕获页面（截图+AI 摘要+元素清单），探索过程有直播画面与 Live log。

实现：`server/src/features/automation/explore/`——BFS 爬站（同域、上限 50 页、登录态先入）、每页截图 + AI 摘要（视觉模型）+ 元素清单（复用 fast/snapshot.ts）、CDP screencast 帧推 SSE 直播；编排照抄 import-manager 模式；落 `at_sources` + `at_captured_pages` 两表。

前端 Sources 页：进度步进条（登录→探索→规划）、直播画面（帧刷新）、Live log（逐页摘要）、捕获页面网格 + 站点概览。

## Resolution

2026-10-23 完成并实测通过（saucedemo 真站全链路）。

**落地内容**

- 爬站器 [crawler.ts](../../../ai-test-tools-site/server/src/features/automation/explore/crawler.ts)：同域 BFS（host 过滤 + 二进制后缀跳过 + 去重）、上限 1–50 页、逐页容错；每页取 DOM 快照（复用 fast/snapshot.ts 元素清单，裁剪为 CapturedElement）+ JPEG 截图落盘 `artifacts/automation-explore/<sourceId>/<n>.jpg` + AI 视觉摘要（截图 + 正文摘录入 prompt，240 字封顶，失败仅告警不影响捕获）；同源 `<a[href]>` 链接入队。
- 登录态先入 `loginScript`：单脚本表单登录——密码框定位 + 同表单启发式找用户名框 + 原生 setter 赋值（React 受控表单兼容）+ 提交；**登录后直接捕获当前页，不回访入口 URL**（SPA 的入口往往永远渲染登录视图，回访会把登录态冲掉——实测踩坑修正）。
- 直播 [live-frames.ts](../../../ai-test-tools-site/server/src/features/automation/explore/live-frames.ts)：CDP `Page.startScreencast`（jpeg q55、长边 1280）推帧，ack 后转发；假页面/无 CDP 静默降级无直播。
- 编排 [explore-manager.ts](../../../ai-test-tools-site/server/src/features/automation/explore/explore-manager.ts)：照 import-manager 模式——内存任务 + 事件缓冲回放（帧只留最新一帧、2fps 尾沿节流）+ TTL 30min 逐出 + abort 中止（状态 aborted）；凭据解析：请求显式覆盖 > 默认环境 `auth.usernameKey/passwordKey` → `process.env`（与 resolveVarDefs 同源）；无 AI 配置降级跳过摘要。
- 数据：`at_sources` / `at_captured_pages` 两表（mysql + memory 双仓储，deleteSource 级联删页并回收截图文件名）。
- 路由：POST/GET/DELETE `/api/automation/explore/sources`、`.../sources/:id/pages`、`.../pages/:id/screenshot`（jpeg，文件名白名单 `^\d+\.jpg$`）、`.../sources/:id/events`（SSE `explore-event`，结束发 end）、`.../sources/:id/abort`；服务重启遗留 running 源自动改判失败（防僵尸进行中徽章）。
- 前端 [SourcesView.tsx](../../../ai-test-tools-site/src/features/automation/SourcesView.tsx)：发起卡（地址 + 上限 + 开始/停止）→ 步进条（登录→探索→规划 P3）→ 直播画面 + Live log 双栏 → 捕获页面网格（截图缩略 + 标题/URL/AI 摘要/元素数/深度）→ 历史探源表（查看/删除）；断线重连自动接入在跑任务。

**实测记录**（预览面板 preview-check，saucedemo + standard_user）

1. 向导建项目（凭据登录）→ 探源页 → 开始探源：Live log 出「尝试表单登录… / 已提交登录表单」，CDP 直播帧渲染。
2. 捕获页为**登录后的 inventory 页**（`/inventory.html`、21 个可交互元素、商品截图完整）——表单登录 + 登录态捕获全链路验证（修复前捕获的是空登录表单页：登录后回访入口把登录态冲掉了）。
3. 无 AI 配置时优雅降级（Live log 提示跳过摘要，捕获照常）。
4. `tsc` 前后端干净；`npm test` 763 过 / 1 失败为既有无关项（testcase-reference-parse 文案）；新增 9 个探索引擎测试（BFS/上限/登录/摘要容错/中止/失败/仓储级联）。

**实测中修复的缺陷**

1. **爬站流程**：登录后 BFS 回访入口 URL → SPA 重新渲染空登录页被截获。改为登录后直接捕获当前页。
2. **SourcesView 入口地址初值**：组件挂载早于项目数据加载，`useState(systemUrl)` 恒为空。改为 systemUrl 到位后回填。
3. **全局密钥启动顺序**（连带修复，P1 时期潜伏）：`bootstrapAuth` 在 `loadDotEnv` 之前跑 `ensureSecretMasterKey`，env 里没有主密钥就重新生成并追加 server/.env——每次启动换钥，`automation_config` 信封（凭据/模型 Key）全解不开、会话全部失效。修：`bootstrapAuth` 先 `loadDotEnv`（[auth/migrate.ts](../../../ai-test-tools-site/server/src/features/auth/migrate.ts)），并清理了 .env 里堆积的 11 组重复 SECRET_MASTER_KEY/SESSION_SECRET（保留首行，与 loadDotEnv first-wins 一致）。修复后凭据写入/回读验证通过。
