---
title: Midscene 服务端集成与实时画面方案调研
type: research
status: closed
assignee: agent-research-01
blocked_by: []
---

## Question

调研 @midscene/web 在 Express 服务端嵌入的工程细节，以及「交互执行台」向 Web 前端实时推流浏览器画面的方案，给出推荐架构。子问题：

1. **Agent 生命周期**：每次执行是否新建 Browser/PlaywrightAgent？Browser、Context、Agent 的复用策略与并发隔离模型（两个执行同时进行时互不干扰的最小资源单元）？
2. **执行产物**：报告 HTML 的输出路径如何控制？每步截图、日志有没有结构化回调（进度直播需要的 hook，如任务开始/结束、thought、action 事件）？
3. **中断与超时**：如何主动 abort 一次执行、设置单步与整体超时？
4. **实时画面方案对比**：(a) 定时 page.screenshot + SSE/WebSocket 推送（1–2fps）；(b) CDP Page.startScreencast；(c) 不推画面只推步骤状态。比较实现复杂度与体验，推荐 MVP 方案。
5. **执行缓存**：1.x 缓存（读写模式、cacheId 旧方式）在服务端多用例场景的配置方式与落盘位置。

资料：midscene 仓库 `apps/site/docs/zh/`（integrate-with-playwright、api-reference、caching、model-debugging-observability 等）、`packages/core` 与 `packages/web-integration` 源码、artifacts/midscene-poc 已装好的 node_modules 可直接读源码。

## Resolution

**推荐架构**：全局共享一个 headless Chromium Browser；每次执行新建 Context+Page+PlaywrightAgent（Agent 只是 Page 的纯包装，构造亚毫秒级，`destroy()` 不关页面、只做报告收尾）；**并发隔离单元 = BrowserContext**；一个 Agent 同时只跑一个执行流。

定稿要点（全部经 1.13.0 dist 源码核实）：

- **进度直播主通道 = 公开 API `agent.addProgressListener`**：aiAct 全生命周期事件（`plan_thinking` 自带当前页面截图、模型 thought、每个 action 的起止且含 point/bbox 坐标可直接画落点）；`onDumpUpdate` 覆盖 aiQuery/aiAssert/aiWaitFor 等全部 API 补齐缺口；`onTaskStartTip` 轻量日志；`onLLMUsage` 做 token 成本计量
- **报告**：`<MIDSCENE_RUN_DIR>/report/<reportFileName>.html`，reportFileName 禁路径符 → 用 runId；`await agent.destroy()` 后读 `agent.reportFile`；服务端启动时显式 `setMidsceneRunDir` 固定目录；大报告用 `html-and-external-assets` + Express 静态托管（file:// 打不开外置资源）
- **中断/超时**：`aiAct`/`aiAssert` 原生支持 `abortSignal`；`aiQuery`/`aiWaitFor` 不支持，外层 Promise.race 兜底；`MIDSCENE_MODEL_TIMEOUT` 必须显式设置（SDK 默认约 10 分钟）；整体超时自建 AbortController+定时器
- **实时画面**：MVP = 步骤状态推送 + `plan_thinking` 事件自带截图；真直播用 CDP `Page.startScreencast`（midscene 源码内有完整可参考实现，注意与其 observer 互斥）；**不推荐** screenshot 轮询
- **缓存**：`cache:{id,strategy,cacheDir}`，落盘 `midscene_run/cache/<id>.cache.yaml`，缓存键=prompt（不含 URL）；推荐**每用例一个 id + 同 id 串行**（整文件覆盖写存在并发竞态）；生产环境可 read-only 共享基线
- **遗留风险**：进度事件目前只有 aiAct 一个 producer（queries/waits 官方后续版本才加）；`startMjpegStream` 为未公开内部 API，建议自实现；aiQuery 无 abortSignal；RUN_DIR 是进程级全局；single-html 报告内联截图体积大

模块划分与关键 API 调用序列伪码、全部源码行号依据见 [research/01-server-integration.md](../research/01-server-integration.md)。
