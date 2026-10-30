---
title: 服务端 Playwright 运行环境落位
type: task
status: closed
assignee: null
blocked_by: []
---

## Question

无决策，纯环境准备（AFK 可做）：让 ai-test-tools-site/server 具备驱动 headless Chromium 的运行能力，为实施阶段铺路。

1. server 增加依赖：`@midscene/web`、`playwright`、`@playwright/test`（版本与 PoC 对齐：@midscene/web 1.13.0）；
2. 浏览器二进制的安装与路径策略（`npx playwright install chromium` 纳入 README/安装脚本；确认 server 进程能找到浏览器，必要时配 `PLAYWRIGHT_BROWSERS_PATH`）；
3. 写一个最小验证脚本（server 侧启动 Express 上下文里 new 一个 headless Chromium + PlaywrightAgent，对任意页面执行一次 aiAct 并落盘报告）跑通即完成；
4. 把事实记录进 Resolution：依赖版本、安装命令、验证结果、发现的坑。

模型配置用 PoC 已验证的那套（artifacts/midscene-poc/.env），正式配置链路不在本票范围（属实施阶段的设置页改造）。

## Resolution

已完成（2026-09-21）。

**依赖**（装在 `ai-test-tools-site` 根 package.json 的 dependencies；server 无独立 package.json，与前端共用一个 `"type": "module"` 的 ESM 包，编译走 `tsc -p server/tsconfig.json`（module NodeNext））：

- `@midscene/web` ^1.13.0（实际 1.13.0，与 PoC 一致）
- `playwright` ^1.63.0（实际 1.63.0）
- `@playwright/test` ^1.63.0（实际 1.63.0）

安装命令：`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install @midscene/web@^1.13.0 playwright@^1.63.0 @playwright/test@^1.63.0`（跳过 playwright postinstall 的全浏览器下载，随后单独装 chromium）。peer 依赖（@playwright/test、playwright ^1.45.0）全部满足，无冲突；`puppeteer` peer 缺失不影响 playwright 入口（PoC 同样未装）。

**浏览器二进制**：`npx playwright install chromium`（在 ai-test-tools-site 下执行，exit 0），复用默认位置 `%LOCALAPPDATA%\ms-playwright`（PoC 已装，含 1.63 所需修订），server 进程默认可发现，无需配 `PLAYWRIGHT_BROWSERS_PATH`；如需固定路径，设该变量后重装并保持运行时同值。安装说明已补进 `ai-test-tools-site/server/README.md`。

**验证脚本**：`ai-test-tools-site/server/scripts/verify-midscene.mjs`（独立脚本，不接入 Express，未改动任何现有源码）。流程：读 `artifacts/midscene-poc/.env` 注入模型配置（已有环境变量优先，key 不落任何文件）→ 设 `MIDSCENE_RUN_DIR=<repo>/artifacts/midscene-server-verify`（绝对路径，报告不进仓库跟踪区，artifacts/ 在根 .gitignore）→ headless Chromium → `PlaywrightAgent` → 一次 aiAct（点击「立即开始」）+ 一次 aiAssert → 输出报告路径。目标页默认 http://localhost:5199（可用 TARGET_URL 覆盖），不可达时退化为内联静态页。

**验证结果**（两次均通过）：

- 站点路径（5199 已在服务）：aiAct 12.1s + aiAssert 3.6s，总 18.8s，报告 `artifacts/midscene-server-verify/report/playwright-2026-09-21_12-04-13-c6c9e9b2.html`。
- 内联 fallback 路径（TARGET_URL 指向死端口）：总 14.9s，同样通过。

**回归**：`npm run server:build` 通过；`npx vitest run server/tests/` 12 文件 133 用例全过；`npx tsc -b`（前端侧）通过。

**坑 / 备注**：

1. server 没有独立 package.json —— 依赖必须装在 `ai-test-tools-site` 根；ESM 体系下 `@midscene/web/playwright` 的 `import` 出口（dist/es/*.mjs）工作正常。
2. `playwright` 包 postinstall 默认下载全部浏览器（chromium/firefox/webkit）；用 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 避免，再单独 `npx playwright install chromium`。
3. Midscene 报告目录由 `MIDSCENE_RUN_DIR` 控制，按 `path.resolve(process.cwd(), MIDSCENE_RUN_DIR)` 解析 —— 传绝对路径可摆脱 cwd 依赖。
4. 运行时有一条无害告警：`waitForNetworkIdle is skipped for Playwright`（Playwright 无对应底层能力），不影响 aiAct/aiAssert 结果。
