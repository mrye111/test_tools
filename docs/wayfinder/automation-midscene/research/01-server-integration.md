---
title: Midscene 服务端集成与实时画面方案调研结论
type: research
status: done
source_ticket: ../tickets/01-midscene-server-integration.md
date: 2026-09-21
verified_against: "@midscene/web 1.13.0 / @midscene/core 1.13.0（artifacts/midscene-poc/node_modules 实测源码）"
---

# Midscene 服务端集成与实时画面方案调研

## 结论先行（推荐架构一段话）

**每次执行新建一个轻量 PlaywrightAgent，但全局只维护一个（或少量）共享的 headless Chromium Browser 进程，并发隔离以 BrowserContext 为最小单元**——`PlaywrightAgent` 只是对已有 `Page` 的纯 JS 包装（构造成本亚毫秒级），`agent.destroy()` 只做报告收尾、**不关闭页面**，因此「Browser 复用、Context/Page/Agent 每执行新建」是最干净且几乎无性能代价的模型。进度直播用官方公开 API `agent.addProgressListener()`（aiAct 全生命周期事件：规划思考、thought、每个 action 的开始/结束/失败，且 `plan_thinking` 事件自带当前页面截图）+ `onDumpUpdate` 全量 dump 回调兜底；报告用 `reportFileName = 执行ID` 落到 `MIDSCENE_RUN_DIR/report/` 下，destroy 后从 `agent.reportFile` 取最终路径。中断用 `aiAct` 的 `abortSignal` 选项 + 外层总超时定时器。实时画面 MVP 推荐「步骤状态推送 + 进度事件自带截图」，需要真直播时直接用 CDP `Page.startScreencast`（midscene 源码内已有一份完整可参考/可直接调用的实现），不推荐定时 `page.screenshot` 轮询作为正式方案。

---

## 子问题 1：Agent 生命周期与并发

### 结论

- **Agent 每次执行新建**:`new PlaywrightAgent(page, opts)` 只是把 Playwright `Page` 包一层 `WebPage`(继承 `puppeteer/base-page.mjs` 的 `Page` 类），外加注册 popup 拦截等，构造成本可忽略（亚毫秒级，无任何浏览器 I/O)。
- **`agent.destroy()` 不关闭 page/browser**:`base-page.mjs` 中 `async destroy() {}` 是**空实现**;core `Agent.destroy()` 只做 observer 清理、`interface.destroy?.()`（空）、报告 flush/finalize。官方文档也明确「它通常不会关闭目标页面」。资源生命周期完全由调用方（我们的服务端）管理。
- **一个 Agent 实例同时只跑一个执行流**:Agent 内部持有单一 `TaskExecutor`、单一 dump、`ReportGenerator` 单写队列、单一 `progressBus`。在同一 agent 上并发调两个 `aiAct` 会交错污染报告 dump、进度事件和缓存匹配状态。**并发单位 = 1 agent**。
- **并发隔离的最小资源单元 = BrowserContext**：独立 cookie/localStorage/viewport。Browser 进程（`chromium.launch`）全局复用；Context 创建约 10–50ms、Page 约 20–100ms（经验值），每次执行各建一个完全可接受。
- **Page 可复用但不值得**:page 关掉再开很便宜；复用 page 意味着要清理导航状态/cookie，反而复杂。Agent 跨执行复用同样不值得（destroy 后禁止再用，官方文档明确「调用该方法后，请勿继续使用这个 Agent」)。

### 三种 Agent 形态（@midscene/web 1.13)

| 类 | 绑定 | 适用 |
|---|---|---|
| `PlaywrightAgent`(=`PlaywrightPageAgent`) | 单个 Page | **服务端批量执行首选**；默认 `forceSameTabNavigation: true`，把 `target="_blank"` 新标签页拦截回当前页 |
| `PlaywrightBrowserAgent` | 整个 BrowserContext，可 `autoFollowNewPage` 跟随新标签页 | 用例本身需要多标签页交互时 |
| `PuppeteerAgent` 系列 | Puppeteer Page/Browser | 本项目不用 |

### 依据

- `artifacts/midscene-poc/node_modules/@midscene/web/dist/es/playwright/page-agent.mjs`（构造仅 `new WebPage(page, opts)` + `super(...)`)
- `.../@midscene/web/dist/es/puppeteer/base-page.mjs` L769 `async destroy() {}`
- `.../@midscene/core/dist/es/agent/agent.mjs` `destroy()`(L739–761：等资源空闲 → 清理 observers → `interface.destroy?.()` → 报告 flush/finalize)
- 官方文档 zh/reference（构造器参数、destroy 行为）:`apps/site/docs/zh/reference/index.mdx`,在线 <https://midscenejs.com/zh/reference>
- 官方文档 zh/integrate-with-playwright「关于在新标签页打开」:`apps/site/docs/zh/integrate-with-playwright.mdx`
- 远程浏览器复用：官方支持 `chromium.connectOverCDP(cdpWsUrl)` 连接外部浏览器后照常 `new PlaywrightAgent(page)`（同文档「连接远程 Playwright 浏览器」节），为以后浏览器池化/外置浏览器服务留了路。

---

## 子问题 2：执行产物（报告路径 + 进度 hook)

### 报告输出路径控制

- 路径公式：**`<MIDSCENE_RUN_DIR>/report/<reportFileName>.html`**(`outputFormat: 'single-html'`，默认）。
- `reportFileName`:**只能是文件名，禁止含 `/`、`\` 和 `:*?"<>|`**,UTF-8 不超过 255 字节（`report-generator.mjs` `validateReportFileName`)。→ 直接用**执行 ID(runId)**作为 `reportFileName`，应用层维护 runId → 路径映射。
- 根目录：`MIDSCENE_RUN_DIR` 环境变量，默认 `midscene_run`（相对 `process.cwd()`；传绝对路径则 `path.resolve` 后不受 cwd 影响）；也可用编程 API `setMidsceneRunDir(dir)`(`@midscene/shared/common`，进程级单例）.**建议服务端启动时显式设为项目内固定目录**（如 `<repo>/runtime/midscene_run`)，避免依赖 cwd。
- 目录模式：`outputFormat: 'html-and-external-assets'` 时 `reportFileName` 当目录名，产 `<dir>/index.html` + `screenshots/*.png`（截图外置，文件小，但必须经 HTTP 访问，`file://` 打不开）。服务端用 Express 静态托管正好规避此限制，**大报告场景推荐**；MVP 用默认 single-html 即可。
- 拿到最终路径：`await agent.destroy()` 后读 `agent.reportFile`；中途可用 `await agent.flushReport()`(返回值即路径）。`persistExecutionDump: true` 还会在旁边写 `N.execution.json` 结构化 dump（调试好用，默认关）。
- 其他:`autoPrintReportMsg: false` 关控制台打印（或 `MIDSCENE_REPORT_QUIET=1`);`generateReport: false` 完全关报告；`testId`、`groupName`、`reportAttributes` 用于报告元信息。

依据：`@midscene/core/dist/es/report-generator.mjs` L40–55、L346–353;`@midscene/shared/dist/es/common.mjs`(`getMidsceneRunSubDir`/`setMidsceneRunDir`);`@midscene/core/dist/es/agent/report-file-name.mjs`（默认名 `<tag>-<时间戳>-<uuid8>`,`MIDSCENE_REPORT_TAG_NAME` 可改前缀）;zh/reference 构造器参数节。

### 进度回调 / hook（直播核心）

有**四层**，全部实测存在：

**① `agent.addProgressListener(listener)`（公开 API，推荐主通道）**
- 签名：`(event: AgentProgressEvent) => void | Promise<void>`,event = `{ scope, phase, sequence, data }`,`sequence` 单调递增。返回退订函数。listener 逐个被 await，抛错只记日志不阻断执行。
- 目前 `scope` 只有 `'aiAct'`(aiAct 是首个 producer，类型注释明说 queries/waits 后续会加）。`AiActProgressPhase` 全集：
  - `start` `{ prompt, planLimit }`
  - `plan_thinking` `{ planIndex, planLimit, screenshot }` —— **每轮规划都带当前页面截图(ScreenshotItem,base64)**，可直接当低频画面源
  - `plan_planned` `{ planIndex, planLimit, thought?, log? }` —— 模型 thought
  - `plan_action` / `action_running` `{ planIndex, planLimit, action }`
  - `action_done` / `action_failed` `{ ..., durationMs, error? }`
  - action 结构：`{ name, target?, point?: [x,y], bbox?: [l,t,r,b], param? }` —— 前端可直接画点击落点
  - `complete` `{ planIndex, planLimit, output?, log?, thought? }` / `failed` `{ planLimit, error, planIndex? }`
- 注意：`plan_thinking` 的 `data.screenshot` 是大 base64,WS 推送前应裁剪不需要的字段。

**② `agent.onDumpUpdate` / `addDumpUpdateListener((dumpString, executionDump))`**
- 每个 task 状态变化（append/start/finish/error/cancel,`task-runner.mjs` emitTaskEvent 全集）都会触发，**所有 API(aiTap/aiQuery/aiAssert/aiWaitFor/runYaml）都覆盖**——正好补 ① 只管 aiAct 的缺口。`dumpString` 是全量序列化报告 dump，可用于自建时间线或提取每步截图（`executionDump.tasks[].recorder`)。

**③ `onTaskStartTip: (tip: string) => void | Promise<void>`(Agent 选项)**
- 每个子任务开始前的一行可读提示，如 `"Planning - 点击登录按钮"`。轻量，适合日志流。

**④ `onLLMUsage: (usage) => void`(Agent 选项)**
- 每次 LLM 调用回调 token 用量（`AIUsageInfo`:intent、tokens、request_id 等），做成本直播/计量。

依据：
- `@midscene/core/dist/es/agent/progress/progress-bus.mjs`(`AgentProgressBus`)
- `@midscene/core/dist/es/agent/tasks.mjs`(`TaskExecutor.runAction` 中 `emitAiActProgress` 全调用点）
- `@midscene/core/dist/types/types.d.ts` L362–409(`AgentProgressEvent`/`AiActProgressPhase`/`AiActProgressData` 权威类型）
- `@midscene/core/dist/es/agent/agent.mjs` L722–730(`addProgressListener`)、L1007–1022(hooks 接线)、L292(`onLLMUsage`)
- `@midscene/core/dist/es/task-runner.mjs`(`emitTaskEvent` kinds: append/start/finish/error/cancel)

---

## 子问题 3：中断与超时

### 主动 abort

| API | abort 支持 | 说明 |
|---|---|---|
| `aiAct(prompt, { abortSignal })` | ✅ 原生 | 触发后停止规划循环，向报告写入一条 "Task aborted" 失败计划再抛错；缓存 YAML 重放路径同样走 signal(`enterYamlAction`) |
| `aiAssert(assertion, msg, { abortSignal })` | ✅ 原生 | `Insight.executionOptions(options, true)` 会传入 |
| `aiQuery/aiBoolean/aiNumber/aiString/aiAsk` | ❌ 本版本不透传 | 只能 `Promise.race` 外层兜底（底层 LLM 请求会跑到结束，浪费一次调用但不泄漏句柄） |
| `aiWaitFor(assertion, { timeoutMs, checkIntervalMs })` | ❌ 无 signal | 但自带超时（默认 15000/3000ms），循环每轮是一次独立 LLM 调用 |
| `agent.sleep(ms, { abortSignal })` | ✅ 原生 | |

→ 服务端为每次执行建一个 `AbortController` 存进 `runId → controller` 注册表，`POST /executions/:id/abort` 调 `controller.abort()`；同时挂 `setTimeout(整体超时).then(abort)`。

### 超时旋钮（默认值均来自源码）

| 层 | 配置 | 默认 |
|---|---|---|
| aiAct 步数上限 | agent opt `replanningCycleLimit` 或 `MIDSCENE_REPLANNING_CYCLE_LIMIT` | 标准规划 20 轮（UI-TARS 40 / AutoGLM 100) |
| 每动作后停顿 | agent opt `waitAfterAction` | 300ms |
| 导航等待 | web agent opt `waitForNavigationTimeout`（超时只警告继续跑） | 5000ms |
| 网络空闲等待 | `waitForNetworkIdleTimeout`(Puppeteer 有效；**Playwright 下直接跳过**，仅警告一次） | 2000ms |
| LLM 请求 | `MIDSCENE_MODEL_TIMEOUT` / `MIDSCENE_PLANNING_MODEL_TIMEOUT` / `MIDSCENE_INSIGHT_MODEL_TIMEOUT`(ms) | 未设 → OpenAI SDK 默认（约 10min) |
| LLM 重试 | `MIDSCENE_MODEL_RETRY_COUNT` / `..._RETRY_INTERVAL` | 1 次 / 2000ms |
| aiWaitFor | `{ timeoutMs, checkIntervalMs }` | 15000 / 3000ms |
| 截图 | 内部 `page.screenshot({ timeout: 10000 })`,Playwright 失败自动 CDP 兜底 | 10000ms |
| 单次 aiAct/整体执行 | 无内建 → **AbortController + 定时器自建** | — |

依据：`agent.mjs` L511–617(aiAct abortSignal 接线）、L674–684;`insight.mjs` L29–40、L66–104;`tasks.mjs` L185–244、L537–588(waitFor 实现）;`base-page.mjs` L91–123、L210;`@midscene/shared/dist/es/env/parse-model-config.mjs` L102–123(timeout/retry 解析）、`env/types.mjs`(env key 全集）;zh/integrate-with-playwright「自定义网络超时」节。

---

## 子问题 4：实时画面方案对比

| | (a) 定时 `page.screenshot` + SSE/WS | (b) CDP `Page.startScreencast` | (c) 只推步骤状态 |
|---|---|---|---|
| 实现复杂度 | 低（约 30 行：`setInterval` + `page.screenshot({type:'jpeg',quality:60})` + 推送） | 中（CDP session + 帧 ack 流控 + viewport 尺寸校验；**midscene 源码内已有一份生产级实现可参照**） | 极低（纯转发 progress 事件） |
| 帧率/体验 | 1–2fps，有轮询间隔感 | 画面变化才推帧，流畅近实时 | 无画面，只有文字状态 + 每轮规划一张截图 |
| 服务端开销 | 主动节流可控；每帧 ~100–300ms 截图耗时 + 50–150KB 带宽 | 浏览器侧编码推流，服务端只转发；帧需逐个 ack 否则停发 | ≈0 |
| 与 midscene 相互影响 | 无（midscene 自己也截图，互不干扰）；导航中截图可能触发 10s 超时（有 CDP fallback) | `activeMjpegStream` 是**单槽**：与 `agent.startObserving()` 的 frame source 互斥，同页同时只能一路 | 无 |
| 依赖 | 无 | Chromium only(Firefox/WebKit 无 CDP);headless Chromium 支持 | 无 |

### 关键发现：midscene 1.13 内建完整 screencast 实现

`@midscene/web/dist/es/puppeteer/base-page.mjs` 的 `Page.startMjpegStream({ signal, onFrame, onError })`(L366–493）已经实现了方案 (b) 的全部难点：

- Playwright:`page.context().newCDPSession(page)`(Puppeteer:`page.createCDPSession()`),`Page.enable` → `Emulation.setVisibleSize` → `Page.startScreencast({ format:'jpeg', quality:70, everyNthFrame:1, maxWidth, maxHeight })`
- `Page.screencastFrame` 监听 + JPEG 尺寸解析（SOF marker)+ viewport 宽高比校验（防导航过程尺寸错乱）
- 每帧 `Page.screencastFrameAck` 流控；screencast 断流时自动降级为定时截图兜底（`flushPendingVisualUpdate`)
- `AbortSignal` 或返回的 `stop()` 停止，`Page.stopScreencast` + `detach` 清理

调用路径：`agent.page`(即 WebPage 实例）`.startMjpegStream(...)`。**注意它是未文档化的内部 API**，版本升级可能变动；但它也是自实现的最佳参照（自实现约 80 行，全用 Playwright/CDP 公开能力，推荐自实现以摆脱内部 API 依赖）。Playwright CDPSession 官方文档：<https://playwright.dev/docs/api/class-cdpsession>(`browserContext.newCDPSession(page)`,Chromium 系）。

### 推荐

- **MVP = (c) + 免费截图**:`addProgressListener` 推步骤状态（thought/action/耗时），`plan_thinking` 事件天然带截图，直接转发给前端当「最近一帧」；实现成本几乎为零，对执行性能零影响。
- **需要真直播（交互执行台的卖点场景）= (b)**：执行期间开一路 screencast,WS 推 base64 JPEG 帧，前端 `<img>` 逐帧替换即可（等效 MJPEG)；执行结束即 `stop()`。不要与 `startObserving` 同开。
- **不推荐 (a) 作为正式方案**：截图轮询与执行抢页面主线程、导航期易超时，体验又不如 (b)；只作为 screencast 不可用时的降级路径（midscene 内部也是这么兜底的）。

---

## 子问题 5：执行缓存

### 机制（源码实测）

- **两类缓存**:
  - `plan` 缓存（aiAct)：键 = **prompt 字符串**（任务指令 + aiAct context 拼接，深比较），值 = 规划产出的 `yamlWorkflow`；命中后直接按 YAML 重放，失败自动回退重新规划**并清空该条 flow**（本次不回写，下次重新生成）。
  - `locate` 缓存（aiTap/aiLocate 等定位类）：键 = 定位 prompt，值 = **XPath 列表**（不含 URL!)；命中后用 xpath 复查元素 rect（文本/结构校验），失败回退 AI 定位并标记 stale、下次原位替换。
  - 查询类（aiQuery/aiAssert/aiBoolean/…)**永不缓存**。
- **配置**:`cache: { id: string, strategy?: 'read-only' | 'read-write'(默认) | 'write-only', cacheDir?: string }`。`cache: true` 在直接建 Agent 模式会报错（必须显式 id；仅 YAML/fixture 模式允许自动 id)。旧方式 `cacheId` + `MIDSCENE_CACHE=1` 仍兼容但已废弃。
- **落盘**:`<cacheDir || MIDSCENE_RUN_DIR/cache>/<safeCacheId>.cache.yaml`(`safeCacheId` = 非法字符替换；超 200 字节截断为 `前32字符-hash`,`MIDSCENE_CACHE_MAX_FILENAME_LENGTH` 可调）。`cacheDir` 相对路径基于 cwd。
- **写时机**:`read-write`/`write-only` 下每次新增/更新缓存记录**立即整文件 `writeFileSync` 重写**（非原子、无文件锁）;`read-only` 只读不写，需 `await agent.flushCache()` 手动落盘（可带 `{ cleanUnused: true }` 清未使用记录）。
- 文件头带 `midsceneVersion`,< 0.16.10 的旧缓存直接不可用；旧的 `.json` 缓存文件会被警告要求删除。

### 服务端多用例场景的推荐配置

1. **缓存 ID 维度 = 用例（或用例集）**:`cache: { id: caseId }`。因为 locate 缓存键不含 URL,plan 缓存键只是 prompt——跨用例共享 id 时，相同 prompt 在不同页面上下文会互相命中，虽有回退兜底不致错，但会放大「回退重规划」浪费。
2. **并发写竞态必须规避**：同一 cacheId 被两个并发执行以 read-write 打开时，各自内存加载、各自整文件覆盖写，**后写赢、先写丢**。规避方案三选一：
   - 同一 cacheId 的执行串行调度（任务队列按 id 分组）;
   - 生产跑 `read-only` 共享基线缓存，更新走离线「缓存构建任务」用 `write-only` 重建；
   - 每次执行独立 id(`runId`）收集缓存，事后离线合并（自行解析 YAML 合并，成本低）。
   - MVP 建议：**每用例一 id + 同 id 串行**,`read-write`。
3. `cacheDir` 指到项目固定目录（如 `<repo>/runtime/midscene-cache`)，与报告目录分离；缓存文件可提交/归档做 CI 预热。
4. 单条 API 可用 `{ cacheable: false }` 禁用（如登录等敏感/易变步骤）。

依据：`@midscene/core/dist/es/agent/task-cache.mjs`(`TaskCache` 全部逻辑）、`agent/cache-config.mjs`（输入校验）、`agent/agent.mjs` L893–921(`processCacheConfig`)、`agent/task-builder.mjs` L248–304(locate 缓存命中/写回）、官方文档 `apps/site/docs/zh/caching.mdx`(<https://midscenejs.com/zh/caching>)。

---

## 推荐的 MVP 服务端架构

### 模块划分

```
server/
├── midscene/
│   ├── browser-manager.ts      # 全局 Chromium 单例 + 并发信号量（如 maxConcurrent=3）
│   ├── execution-runner.ts     # 单次执行生命周期：context→page→agent→步骤→收尾
│   ├── live-channel.ts         # 每 runId 一条 WS 频道：progress 事件 + 截图帧转发
│   ├── abort-registry.ts       # runId → AbortController（+整体超时定时器）
│   └── report-store.ts         # midscene_run/report 静态托管 + runId→reportFile 映射入库
└── routes/
    └── executions.ts           # POST /executions 启动、POST /executions/:id/abort、WS /executions/:id/live
```

启动时：`setMidsceneRunDir(<repo>/runtime/midscene_run)`（或 env `MIDSCENE_RUN_DIR`)，显式设 `MIDSCENE_MODEL_TIMEOUT`（如 120000)。

### 关键调用序列（伪码）

```ts
// browser-manager.ts
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
// 进程退出钩子 browser.close()；信号量限制并发执行数

// execution-runner.ts（每次执行）
async function runExecution(run: Execution) {
  const ac = new AbortController();
  abortRegistry.set(run.id, ac);
  const overallTimer = setTimeout(() => ac.abort('overall timeout'), run.timeoutMs);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const agent = new PlaywrightAgent(page, {
    reportFileName: run.id,                 // → midscene_run/report/<runId>.html
    autoPrintReportMsg: false,
    groupName: run.caseName,
    cache: { id: run.caseId, strategy: 'read-write' },   // 同 caseId 串行调度
    onTaskStartTip: (tip) => live.push(run.id, { type: 'tip', tip }),
    onLLMUsage: (usage) => live.push(run.id, { type: 'usage', usage }),
  });

  // 进度直播主通道（注意裁剪 screenshot 字段按需转发）
  const unsubscribe = agent.addProgressListener((e) =>
    live.push(run.id, { type: 'progress', scope: e.scope, phase: e.phase, seq: e.sequence, data: e.data }));

  // 可选：真直播画面（方案 b，自实现 CDP screencast；与 startObserving 互斥）
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  cdp.on('Page.screencastFrame', async (f) => {
    live.pushFrame(run.id, f.data);                       // base64 JPEG → 前端 <img>
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });

  try {
    await page.goto(run.targetUrl, { waitUntil: 'domcontentloaded' });
    for (const step of run.steps) {
      ac.signal.throwIfAborted();
      switch (step.kind) {
        case 'act':    await agent.aiAct(step.prompt, { abortSignal: ac.signal }); break;
        case 'assert': await agent.aiAssert(step.prompt, undefined, { abortSignal: ac.signal }); break;
        case 'query':  run.results[step.key] = await agent.aiQuery(step.schema); break; // 无 signal，外层 race 兜底
        case 'waitFor':await agent.aiWaitFor(step.prompt, { timeoutMs: step.timeoutMs ?? 15000 }); break;
      }
    }
    run.status = 'passed';
  } catch (err) {
    run.status = ac.signal.aborted ? 'aborted' : 'failed';
    run.error = String(err);
  } finally {
    clearTimeout(overallTimer);
    unsubscribe();
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});
    await agent.destroy().catch(() => {});   // 报告 finalize；不关 page
    run.reportFile = agent.reportFile;       // 最终报告路径入库
    await context.close().catch(() => {});   // 由我们关闭 context/page
    abortRegistry.delete(run.id);
    live.close(run.id);
  }
}
```

### 前端消费

- WS 收 `progress`:`plan_planned.thought` 渲染思考流；`action_running/action_done` 带 `action.point/bbox` 在截图上画落点；`complete/failed` 收尾。
- WS 收 JPEG 帧 → `<img src>` 替换（或 Blob URL)。
- 报告：`/reports/<runId>.html` 静态托管直达（single-html 无需服务即可下载分享；html-and-external-assets 必须 HTTP，正好由静态路由服务）。

---

## 风险与未知项

1. **进度总线目前只有 aiAct 一个 producer**(1.13.0 实测；类型注释写明 queries/waits 预留扩展）:`aiQuery/aiAssert/aiWaitFor` 的执行中状态只能靠 `onDumpUpdate`(task start/finish/error）补齐，没有 thought 级事件。→ 直播 UI 对非 aiAct 步骤只显示"开始/结束"。
2. **`startMjpegStream` 是未公开内部 API**：直接用有升级漂移风险；建议照抄其逻辑自实现（全部基于 Playwright/CDP 公开能力），或与 `startObserving` 互斥使用并做版本锁定（当前锁 1.13.0)。
3. **同 cacheId 并发写竞态**:TaskCache 整文件覆盖写、无锁；多执行并发同 id 会丢缓存记录。调度层必须保证同 id 串行，或接受 read-only/write-only 分离模式。
4. **aiQuery 等查询类无 abortSignal**:abort 后底层 LLM 请求仍会跑到自然结束（一次调用的成本浪费）；整体超时只能靠外层 `Promise.race` + destroy agent 兜底，HTTP 连接随 client 回收。
5. **`MIDSCENE_RUN_DIR`/`setMidsceneRunDir` 是进程级全局**：同进程多租户只能共享一个根目录；报告只能按文件名区分（runId 命名），无法按子目录分流（reportFileName 禁路径分隔符）。需要更细粒度就得前置符号链接/后置搬运报告文件。
6. **模型请求超时默认依赖 OpenAI SDK（约 10 分钟）**：生产必须显式 `MIDSCENE_MODEL_TIMEOUT`，否则单步卡死会拖满整体超时。
7. **报告体积**:single-html 把全部截图 base64 内联，长用例单文件可达数十 MB；且报告是 append 式增长。长用例建议 `html-and-external-assets` + HTTP 托管。
8. **未实测项（建议 PoC 第二阶段验证）**：多并发 Context 下同 cacheId 串行调度的实际吞吐；screencast 在导航/弹窗场景帧尺寸校验的行为（源码有降级逻辑，预期安全）;Kimi K2.8 下 `MIDSCENE_MODEL_TIMEOUT` 与重试组合的真实耗时分布。
