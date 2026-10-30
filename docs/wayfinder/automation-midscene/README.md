# 地图：Midscene Web 自动化测试移植

`wayfinder:map` · local-markdown tracker · 创建于 2026-09-21

## Destination

把 Midscene 的 Web UI 自动化能力完整、健全地移植进 ai-test-tools-site 并适配现有体系：

- 新增「自动化测试」一级菜单：**交互执行台**（URL + 自然语言指令、实时画面、一键存为用例）+ **自动化用例管理**（新建/编辑/执行）+ **运行历史与报告查看**
- 「测试用例」页新增**执行按钮**：功能用例的步骤/预期直接编译为 AI 指令运行，不落地转换结果
- 执行位置：**服务端 headless Chromium**
- 资产模型：**自动化用例为独立资产**，与现有 项目⊃用例集⊃用例 体系并存
- 本期仅 **Web 端**（Android/桌面端后续单独移植）

路线清晰的标志：tickets/ 下所有决策票据关闭，随后按既定顺序进入搭建。

## Notes

- 技术栈：React+Vite 前端 / Express+TypeScript 服务端（ai-test-tools-site/server）/ MySQL 持久化
- 领域术语表：[ai-test-tools-site/CONTEXT.md](../../ai-test-tools-site/CONTEXT.md)——新资产「自动化用例/步骤/运行」等术语定稿后需扩充该表
- 已验证的模型配置（2026-09-21 PoC 通过）：`MIDSCENE_MODEL_BASE_URL=https://api.kimi.com/coding/v1`、`MIDSCENE_MODEL_NAME=kimi-for-coding`（K2.8）、`MIDSCENE_MODEL_FAMILY=kimi`；PoC 与验证脚本在 `artifacts/midscene-poc/`（已 gitignore，key 在其 .env 中）
- 关键接入点：导航 `src/components/Navbar.tsx`；首页工具矩阵 `src/data/tools.ts` + `ToolCard.tsx`；用例页 `src/pages/TestCasePage.tsx`；报告页 `src/pages/TestReportPage.tsx`；MCP 任务制模式参考 `server/src/features/requirement-v2/` 与 `server/src/mcp-runtime.ts`
- 相关 skills：research（研究票）、prototype（原型票）、grilling / domain-modeling（问答票）
- **Tracker 约定（local-markdown）**：frontier = `tickets/` 下 `status: open` 且 `blocked_by` 全部已关闭且 `assignee` 为空的票据；认领 = 把 `assignee` 改为自己；解决 = 填写票据 `## Resolution`、`status: closed`，并在下方 Decisions so far 追加一行（标题链接 + 一句话 gist）

## Decisions so far

<!-- 每关闭一张票据追加一行 -->

- [功能用例→AI 指令编译策略调研](tickets/02-functional-case-compile-strategy.md) — LLM 预编译为主（原子指令 + manualItems 标注 + 溯源 + 按文本 hash 缓存），逐条直映作降级；实测 115 条真实用例：38% 含非 UI 操作须如实标 manual，入口 URL 须外部注入
- [Midscene 服务端集成与实时画面方案调研](tickets/01-midscene-server-integration.md) — 共享 Browser + 每执行新建 Context 隔离；`addProgressListener` 为进度直播主通道；MVP 实时画面=步骤状态+事件截图（CDP screencast 后置）；报告/缓存/中断 API 均经源码核实
- [Kimi K2.8 延迟成本与执行缓存调研](tickets/03-cache-and-latency-strategy.md) — `family=kimi` 默认已禁思考（4–19s 主因疑为 prompt 体积）；extraBody 可注入思考档位；端点自带 prompt 缓存；执行缓存每用例集一 id、CI 用 read-only；节流并发 3–5 + 指数退避
- [登录态与账号凭据策略](tickets/05-auth-credentials-strategy.md) — 登录形态=账号密码/SSO扫码/免登录token 三种并存无验证码；凭据 `${变量}` 占位只存服务端配置；MVP 每次前置登录，storageState 复用为增强；SSO/扫码需人工介入一次
- [运行报告与现有报告体系的关系](tickets/06-report-system-relationship.md) — 菜单内自含（TestReportPage 不动，汇总另行立项）；Midscene 原生 HTML 报告 iframe 嵌入不重绘
- [极速执行引擎（DOM 动作表 + 决策模型）可选集成](tickets/09-fast-execution-engine.md) — 决策后端可插拔三选（Jev API / Laya / 开源兼容 API）；TS 重写回路；排在视觉引擎 MVP 后，act 走极速、assert 走视觉、BLOCKED 自动降级
- [自动化测试菜单信息架构与交互原型](tickets/04-menu-ia-and-editor-prototype.md) — 原型两轮迭代后用户通过：三主区（用例管理/交互执行台/运行历史）+ 编辑器（步骤色条+溯源+深色编译面板+人工项警示）+ 用例页执行集成；设计随宿主浅色蓝调、执行按钮绿色语义、全 SVG 图标
- [服务端 Playwright 运行环境落位](tickets/07-server-playwright-runtime.md) — 依赖装 ai-test-tools-site 根（server 无独立 package.json，ESM）：@midscene/web 1.13.0 + playwright 1.63.0；验证脚本 server/scripts/verify-midscene.mjs 双路径 PASS；server:build + 133 用例 + tsc 全过；坑：PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1、MIDSCENE_RUN_DIR 传绝对路径
- [建立定位评测集并冒烟验证思考档位配置](tickets/08-locating-eval-set.md) — 24 任务×48 样本/档：三档命中率同 100%，disabled P50 2.2s 仅为 max 档 40% → 定位采用 family=kimi 默认零配置；low 档须 REASONING_ENABLED+extraBody 双设（修正票 03）；屏外目标零幻觉、同名诱饵需 prompt 消歧；附启动冒烟+自动回退 low 方案（locating-smoke.ts）
- [存量功能用例批量预编译与可自动化率统计](tickets/10-batch-precompile-stats.md) — 百度搜索集 34 条：full 56% / partial 44% / manual 0%，编译零失败零降级；manual 三模式（API 调用发起→API 动作通道值得做、系统/网络构造→留人工、不可视觉判定断言）；用例集即天然套件分组
- [批量执行与套件编排](tickets/11-suite-batch-execution.md) — 自动化用例引入用例集层级（三级模型对齐）；失败继续；逐例 read-write 缓存；手动触发（定时/CI 留雾区）；batchId 贯穿成员运行聚合视图
- [凭据与模型配置的界面化管理](tickets/12-credentials-settings-ui.md) — automation.config.json（gitignored）+ .env 兜底，保存热生效；配置入口在自动化菜单「配置」主区（模型四件套+冒烟自检/执行参数稳定引用/凭据只回掩码）；编辑器 varDefs 接凭据 datalist
- [Laya 微调：Web 导航决策后端](tickets/14-laya-finetune-backend.md) — 阶段 A 完成：收割管线（快照+动作映射+共享问题构建器，冒烟 4 记录）、FastAPI sidecar 接入为第三后端（健康探测如实报不可用）、31 项 fast 测试全绿；训练与上线拆至票据 15
- [AI 从需求文档生成自动化用例](tickets/16-requirement-to-automation.md) — 两段式贯通（留功能用例资产），入口在需求分析页勾选条件、直接落库+可自动化率汇总；只做编排不新建生成能力，需求侧 RTM 零改动；否决"直达式一步生成"（要推倒确定性校验层）

## Not yet specified

- 执行器 API 动作通道：把"发起调用/触发结算"类 manual 步骤映射为可配置 HTTP 动作（超出 Midscene 能力范围的中期扩展，可显著降低 partial 率；是否值得做看票据 10 的 manual 原因分布）
- 定时任务 / CI 触发回归（从票据 11 拆出，本期手动触发先行）
- 平台移植下一棒：Android / 桌面端（用户明确"一个个移植"，届时另起地图）

## Out of scope

- Android / iOS / HarmonyOS / 桌面端移植——本期目的地仅 Web 端，后续单独立项
- 接口 / 性能测试执行体系——已有 JMeter / Apifox 链路，不在本图
- [MCP 工具化：聊天端触发自动化执行](tickets/13-mcp-tools.md)——用户判定不需要聊天端入口（2026-09-21）；Web 端闭环已满足使用场景，未来需要时可用 REST 接口或另立新票
