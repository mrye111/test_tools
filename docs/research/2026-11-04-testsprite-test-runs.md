# TestSprite Test Runs：执行、进度、结果与失败处理

日期：2026-11-04
对应票据：[mrye111/test_tools#35](https://github.com/mrye111/test_tools/issues/35)；父图：[mrye111/test_tools#32](https://github.com/mrye111/test_tools/issues/32)
范围：TestSprite 第一方公开文档 + 既有项目的只读 UI 观察。未启动、取消或重跑测试，未提交 AI 修复；仅在 Test Cases 临时勾选一条用例以观察选择入口，随后清除选择。

> **证据等级**：第一至五节均为 **docs-only（官方文档陈述）**，不是实测结论；第七节才是 **observed（当前只读 UI）**。文档中的状态大多是“单个测试在一次运行中的状态”，不能直接当作整个 Test Run 的状态机。既有样本只有一次 2026-10-20 的 Manual 运行（37 tests），没有可观察的活动/排队运行。

## 结论摘要

1. **执行入口**覆盖项目 `Run all`、选中用例运行、单用例 `Run test` / `Save & Run`；项目级配置包含目标环境、视口、登录复用、并发数和计划步骤策略。[Test Detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail) · [Run Behavior](https://docs.testsprite.com/web-portal/setup/execution-settings)
2. **执行闭环**是排队/运行/终态、运行页实时查看、单测试步骤与证据、运行报告、重跑及复制 AI 修复提示；旧运行保留，单个测试后来的重跑不会改写旧运行视图。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report) · [Agent Actions](https://docs.testsprite.com/web-portal/core/ui/agent-actions)
3. **并发有明确配置，Web Portal 取消没有同等依据**：并发可设为 10/25/50/75/100/Unlimited，默认 50；取消只在 CLI 文档中找到明确契约，不能移植成页面能力。[Run Behavior](https://docs.testsprite.com/web-portal/setup/execution-settings) · [CLI Cancelling a Run](https://docs.testsprite.com/cli/core/cancelling-runs)
4. **Passed/Failed/Blocked 是用例终态**。API 对三者有明确判定，尤其 Blocked 表示因上游失败而未执行；UI 文档还表明“所有步骤均通过”不必然等于整例 Passed。[Endpoint Tests](https://docs.testsprite.com/web-portal/core/api/endpoint-tests) · [Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step)

## 一、文档证据：执行入口与运行配置

### 1. 执行入口

| 入口 | 官方文档明确说明 |
| --- | --- |
| 全量运行 | UI 的 `Test Cases` 工具栏 `Run all` 会将项目内每个测试排队；API 同名入口会重新执行项目内全部测试。[UI Edit & Rerun](https://docs.testsprite.com/web-portal/core/ui/ui-rerun) · [API Rerun](https://docs.testsprite.com/web-portal/core/api/api-rerun) |
| 选中用例 | `Test Cases` 支持选中多行后运行，也可批量删除或加入 Test List；文档未给出该场景运行按钮的精确文案。[Test Detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail) |
| 单用例 | 测试详情页的 `Run test` 立即按已保存脚本重跑；有未保存修改时按钮为 `Save & Run`，保存后立即运行。[UI Edit & Rerun](https://docs.testsprite.com/web-portal/core/ui/ui-rerun) |
| 既有运行记录 | 项目 `Test Runs` 列出每次执行；点击一条运行可进入其实时/结果页面。单个测试详情的 `Test runs` 面板另列出该用例的历史状态和日期。[Test Detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail) · [Agent Actions](https://docs.testsprite.com/web-portal/core/ui/agent-actions) |

### 2. 配置项

- **目标环境**：环境封装 URL、认证和自定义变量；Portal 的临时运行使用当前 `Active` 环境，变量在每次运行前重新解析。Test Cases 文档另说明：配置环境后，运行按钮兼作环境选择器；它是否直接改变 Active 状态，文档未说明。[Environments](https://docs.testsprite.com/web-portal/setup/environments) · [Test Detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail)
- **`Project Settings → Test Execution → Run Behavior`**：[Run Behavior](https://docs.testsprite.com/web-portal/setup/execution-settings)

| 设置 | 文档契约 |
| --- | --- |
| `Viewport` | Frontend-only；桌面/平板/手机预设，默认示例为 `1920×1080`；手机预设只缩窄页面，不模拟触摸或移动浏览器。 |
| `Log in once per run` | Frontend-only；一次登录并在本次运行的用例间共享会话；OTP 认证时强制开启且锁定。 |
| `Max tests per run` | 实际指同时运行的用例数，超出部分排队；选项 `10 / 25 / 50 / 75 / 100 / Unlimited`，默认 `50`。 |
| `Always use planned steps` | 默认关闭；开启后强制按编写计划执行。关闭时，未编辑用例重放上次运行记录的步骤，可能逐渐偏离计划。 |

## 二、文档证据：生命周期、实时进度、并发与取消

### 1. 状态与完成

- UI 用例状态为 `Planned`（尚未生成和运行）→ `Queued`（等待空闲槽位）→ `Running`（云端沙箱执行）→ `Passed / Failed / Blocked` 终态。[UI Test Generation & Execution](https://docs.testsprite.com/web-portal/core/ui/ui-test-gen)
- API 同样使用 `Queued / Running / Passed / Failed / Blocked`；初次生成阶段，`Running` 可同时涵盖生成与执行。[Endpoint Tests](https://docs.testsprite.com/web-portal/core/api/endpoint-tests)
- 文档描述的是**单测试终态**，没有在所查 Web Portal 页面中给出整个 Run 的 `Completed` 状态枚举。运行结束后会自动进行 AI 结果分析，分析未完成时报告显示 `Analyzing your results`。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report)

### 2. 运行页与实时进度

- 每次运行有独立页面；顶部 `Run Report` 显示通过率和 `Running / Queued / Passed / Failed / Blocked / Total` 实时计数。数据属于**这一次运行**，不是各测试的最新状态。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report)
- `Agent Actions View` 是 UI 默认视图：每个已开始测试一个视频块，录制开始后标记 `LIVE`，结束后进入 Passed/Failed/Blocked 分组；Queued 测试开始时才会进入该画廊。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report) · [Agent Actions](https://docs.testsprite.com/web-portal/core/ui/agent-actions)
- `List View` 是 API 默认视图，也可用于 UI：按 feature 分组展示本次运行全部测试，状态芯片由 Queued → Running → 终态；支持按 Run Status 排序、标题搜索和状态过滤。运行中即可过滤 Failed 并先行排查。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report)
- 实时预览约每秒刷新一帧；计数、步骤和快照约每 2–3 秒刷新；可拖动回放的视频在测试结束后生成。打开测试后，步骤随执行逐条出现，点击步骤可查看当时的 HTML 快照。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report)

### 3. 并发、禁用与取消边界

- 除全局并发槽位外，API 的独立测试可并行；依赖其他测试产出值的测试会等待，上游失败则下游 Blocked。[Run Behavior](https://docs.testsprite.com/web-portal/setup/execution-settings) · [Dependency Chains](https://docs.testsprite.com/web-portal/core/api/dependency-chains)
- 当前运行未结束时，运行页 `Re-run all` 和 `Re-run failed` 均禁用；UI 项目有其他项目级操作（包括活动运行）时 `Run all` 也会禁用，项目空闲后恢复。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report) · [UI Edit & Rerun](https://docs.testsprite.com/web-portal/core/ui/ui-rerun)
- API 单测试仍 Queued/Running 时，文档说明重跑按钮通常禁用，需等待终态。[API Rerun](https://docs.testsprite.com/web-portal/core/api/api-rerun)
- **未找到 Web Portal 取消入口的官方说明**。CLI 另有 `testsprite test cancel <run-id>`；普通 CLI 等待过程中的 Ctrl-C 只脱离观察，不取消服务端运行。这是 CLI 契约，不应据此推断页面行为。[官方文档索引](https://docs.testsprite.com/llms.txt) · [CLI Cancelling a Run](https://docs.testsprite.com/cli/core/cancelling-runs)

## 三、文档证据：Test Runs、运行详情与结果证据

### 1. 列表、详情和报告

- 项目 `Test Runs` 是每次执行的入口，可观看进行中运行或打开结果与报告；报告不负责展示执行时间，时间应查 Test Runs 历史。[Test Detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail) · [Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report)
- `Agent Actions` 与 `List View` 是同一次运行的两种视图。若某测试之后单独重跑，较新的结果在该测试页面，旧运行视频块仍表示旧运行结果。[Agent Actions](https://docs.testsprite.com/web-portal/core/ui/agent-actions)
- `View Report` 打开该次运行报告：统计卡、Passed/Failed/Blocked 分布、AI Test Summary、按根因聚合的 Issues found、改进项、建议和修复提示；报告还链接到各测试。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report) · [UI Quickstart](https://docs.testsprite.com/web-portal/core/ui/quickstart)
- 详细报告通过浏览器打印为 PDF。报告本身无固定过期时间，每次打开时由运行数据重新渲染；内嵌截图链接约一周后过期。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report)

### 2. 单测试步骤、截图与日志

| 类型 | 文档明确的证据与阅读方式 |
| --- | --- |
| UI | 左侧 Steps 列出实际执行的 action/assertion；顶部 Test Result 可为 `PASSED / FAILED / BLOCKED / RUNNING`。步骤状态为绿（通过）、红（失败）或中性（无断言）。点击步骤在右侧查看 HTML 快照；`Preview` 为完整视频，`Code` 为测试代码。[Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step) |
| UI 失败 | 失败步骤高亮；`Error` 给出失败断言或 AI judge 未通过原因，`Cause` 为 AI 根因诊断，`Fix` 为标记为 AI 生成的只读建议。UI 不显示 Trace 标签。[Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step) |
| API | 详情包含生成代码和终端输出；`Stdout` 包含运行输出及 API 返回，`Error / Trace` 显示断言行、文件/行号和 Python traceback，另有 `Cause / Fix`。重跑会保存请求、响应、headers、body、状态码和延迟。[Test Detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail) · [Endpoint Tests](https://docs.testsprite.com/web-portal/core/api/endpoint-tests) |
| 证据缺失 | 视频缺失不代表步骤和快照也缺失；失败测试若没有视频块，结果仍在 List View。空白快照通常表示捕获时页面尚未稳定。[Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step) · [Agent Actions](https://docs.testsprite.com/web-portal/core/ui/agent-actions) |

注意：测试详情默认 Steps 展示该测试**最近一次**运行；查看较旧步骤需从 `Test Runs` 进入旧运行。[Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step)

## 四、文档证据：Passed / Failed / Blocked 与失败处理

- **API Passed**：全部断言成立；**Failed**：至少一个断言失败，详情展示失败行及 actual vs expected；**Blocked**：因上游依赖失败等原因未能端到端执行，trace 中为 `TEST BLOCKED`。Blocked 不是 Failed，也不能说明被阻塞接口本身是否通过。[Endpoint Tests](https://docs.testsprite.com/web-portal/core/api/endpoint-tests)
- API 依赖链中，上游失败后，需要其产出值的下游从未执行并标为 Blocked；对应清理步骤可为 Skipped。修复后重跑会覆盖失败上游及被阻塞下游。[Dependency Chains](https://docs.testsprite.com/web-portal/core/api/dependency-chains)
- **UI Passed/Failed**：执行文档称由断言决定；编辑文档同时明确整例按 `What counts as a pass` 判定，而非仅按步骤。Error 可能来自失败断言，也可能来自 AI judge。[UI Test Generation & Execution](https://docs.testsprite.com/web-portal/core/ui/ui-test-gen) · [UI Edit & Rerun](https://docs.testsprite.com/web-portal/core/ui/ui-rerun) · [Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step)
- 即使所有步骤看似通过，整例仍可能因步骤列表之外的最终断言、整体隐藏超时或运行后校验而 Failed；此时错误显示在 Preview/Code 下方的 Error/Cause/Fix，而非某个步骤行。[Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step)

## 五、文档证据：重跑、AI 修复入口与跨页闭环

### 1. 重跑入口

| 位置 | 入口与范围 |
| --- | --- |
| 运行页 | `Re-run all`、`Re-run failed`；当前运行未结束时禁用。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report) |
| 测试详情 | `Run test` 原样重跑；`Save & Run` 保存修改后重跑；UI `Edit Steps & Rerun` 可修改步骤和通过标准，`Save & Re-Run` 产生新版本并运行。[UI Edit & Rerun](https://docs.testsprite.com/web-portal/core/ui/ui-rerun) |
| Insights | `Issues to Fix` 按根因聚合最新失败/阻塞；行内 `Re-run` 可重跑该组全部受影响测试，顶部在适用时提供 `Re-run all tests`。[Insights](https://docs.testsprite.com/web-portal/results/project-overview) |
| API 依赖链 | 重跑 producer 会先取得新值并级联重跑消费者；旧运行保留在 Test Runs 中供比较。[API Rerun](https://docs.testsprite.com/web-portal/core/api/api-rerun) |

运行页步骤是只读历史，需沿链接回到测试用例编辑；编辑重跑不可用于运行中、历史版本或只读角色等场景。[UI Edit & Rerun](https://docs.testsprite.com/web-portal/core/ui/ui-rerun)

### 2. AI 修复入口（不是自动改代码）

- 单个失败测试：失败面板 `Copy fix prompt`；整次运行：报告 `Fix prompt for your coding agent` / `Copy prompt`；跨多个最新失败：Insights 的 `Copy Fix Prompt`。这些入口生成供 Claude Code、Cursor 等编码代理使用的可复制的仓库导向提示。[Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step) · [Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report) · [Insights](https://docs.testsprite.com/web-portal/results/project-overview)
- 测试旁的 `Chats` 可解释失败并提出修改，修改以待批准卡片出现；文档所述 Fix 建议本身是只读指导，由用户自行应用。[Managing Test Cases](https://docs.testsprite.com/web-portal/core/working-with-test/managing-test-cases) · [Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step)
- Insights 队列由最新结果派生，没有手动 dismiss；相关测试重跑通过后，对应根因行消失。[Insights](https://docs.testsprite.com/web-portal/results/project-overview)

### 3. 页面链接与已文档化的动态行为

主链路可据文档串成：

`Test Cases（全量/选中/单例）→ Test Runs → Run 详情（Agent Actions / List）→ 单测试 Steps、Preview、Error/Cause/Fix`；Run 详情另经 `View Report` 进入报告，报告可链接回各测试；重跑后再回到最新结果或保留的旧运行。[Test Runs & Reports](https://docs.testsprite.com/web-portal/results/test-report) · [UI Quickstart](https://docs.testsprite.com/web-portal/core/ui/quickstart)

文档明确的动态行为只有功能性变化：状态芯片迁移、LIVE 视频块移入终态分组、步骤实时追加、点击步骤切换快照、点击 Test Result 返回视频；测试用例可从列表上的 drawer 展开为完整页面。**没有查到页面转场时长、easing、进出场动画或 reduced-motion 规范。**[Agent Actions](https://docs.testsprite.com/web-portal/core/ui/agent-actions) · [Step-by-Step Replay](https://docs.testsprite.com/web-portal/core/ui/ui-step-by-step) · [Test Detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail)

## 六、未知项与证据边界

1. **Run 级状态机**：整个运行是否有独立的 Queued/Running/Completed/Cancelled 枚举、部分失败时整体状态如何命名仍不明确；现有文档主要描述单测试状态。当前 UI 的 Status 过滤器也不是完整生命周期枚举（见下节）。
2. **Web Portal 取消**：未找到官方页面说明，也没有活动运行可供只读观察；取消按钮、权限、确认交互、部分结果和计费影响均未知。CLI 的 cancelled/refund 规则不能代替页面证据。
3. **历史列表其余规格**：默认排序、跨页搜索/过滤、空/错状态、保留期仍未建立；本次只有一个 Run，无法验证多页或多种 Run type 的实际呈现。
4. **选中运行细节**：跨分组/分页选择、执行顺序、点击运行后的确认/错误流程未验证；未点击任何运行按钮。运行按钮的 environment picker 与 Active 环境之间的具体交互也未操作。
5. **UI Blocked 完整规则**：当前样本证明缺少上传文件/测试数据可导致 Blocked，但不能据此列出全部触发条件或与 Failed 的统一判定优先级。
6. **日志界面边界**：当前 UI Run log 是 action/assertion 记录；独立 console/network 日志查看器、字段与保留期未建立。API 文档明确的是 Stdout/Trace 与 HTTP 证据。[Testing Lifecycle](https://docs.testsprite.com/web-portal/concepts/testing-lifecycle)
7. **重跑记录语义**：`Re-run failed` 是否包含 Blocked、是否总是创建新 Run、确认/错误提示为何，未通过文档或点击验证。
8. **精确动效与可访问性**：页面转场时长、easing、reduced-motion、键盘导航与响应式细节未测量；观察到的 drawer/replay 行为不能替代动画参数规格。
9. **文档与当前 UI 的版本差异**：文档所述 Agent Actions 视频画廊与当前 Agent Action View 路径图并不相同；需后续版本/发布说明确认各自适用版本。
10. **报告数字一致性**：当前报告的统计卡为 29 Passed，但 AI Test Summary 写 22 Passed；原因、刷新/再生成机制及哪个字段应作为契约均未知。

## 七、只读 UI 观察（observed）

### 1. 样本与执行入口

样本项目有 37 条 UI 用例、1 次既有 Manual Run。以下全部来自当前页面，只读观察日期为 2026-11-04。

- **Test Cases**：顶部为 `Run All 37`；状态页签为 `All 37 / Planned 0 / Generated 0 / Running 0 / Passed 29 / Failed 5 / Blocked 3`，每行显示 ID、Latest Status、相对时间、标题和 Priority。这里明确是“latest result”，不是某个历史 Run 的快照。[UI-TestCases]
- **选中用例**：临时勾选一例后，顶部按钮变为 `Run 1 Selected`，底部出现 `Selected tests` 工具栏：`1 selected / Clear / Delete / Add to Test List / Run 1 Selected`。清除选择后恢复；未点击运行。[UI-TestCases]
- **Run Behavior**：当前项目页面显示 `Log in once per run`、`Viewport = 1920 × 1080 Full HD — Default`、`Tests at the same time = 50`，并明确“其余用例等待空槽位，Unlimited 会同时分发全部用例”。`Save Changes` 在未修改时禁用。当前页面未显示文档所述 `Always use planned steps`，不能据此断言其他版本/项目也没有。[UI-RunBehavior]

### 2. Test Runs 历史列表

- 页面文案为 `Past runs. Open one to view results or re-run.`，有 `Search Runs`、过滤菜单、`25 Rows` 和分页。`Run / Status / Execution Date` 是带箭头的列按钮；Environment 为普通列标题。[UI-TestRuns]
- 过滤菜单含 `Status` 与 `Run type`。Status 子选项实测为 `Passed / Blocked / Failed / Running / Not Run`；**没有 Queued 或 Completed 选项**，因此不能把该菜单当成 Run 状态机定义。[UI-TestRuns]
- 唯一样本行显示 `2w ago / Manual / Latest`、环境 `default`、三个状态计数 `29 / 3 / 5`、`29 of 37 passed`、执行时间 `2026-10-20 13:14`，行内直接提供 `Re-Run Failed` 与 `Re-Run All`。未点击这两个按钮。[UI-TestRuns]

### 3. Run 详情、三种视图与跨页链接

- 顶部为 `Run: 2026-10-20 13:14` 和 `78% Pass Rate / 29 Passed / 5 Failed / 3 Blocked / 37 Total`；另有失败/阻塞摘要、AI 根因段落、`Re-run`、`Copy Fix Prompt`、`Connect GitHub CI/CD`、`View Report`。页面明确提示：`The list below shows results from this run, not each test's latest.`[UI-Run]
- 面包屑为项目 → `Test Runs` → Run UUID；`Edit tests` / `View Test Cases` 回到 Test Cases，CI/CD 链接到 GitHub Action 设置。目标站点与环境显示为 `37 tests on drcwj.chinathinktanks.org.cn · default`。[UI-Run]
- **List View**：按 use case 分组，每行显示本次 Run Status、Test、Priority；支持 Search Tests，25 行分页。点击一行会打开该次运行的单测试结果，而非最新结果。[UI-Run]
- **Agent Action View**：当前 UI 是页面/路径图，不是文档描述的视频画廊。节点显示路径、到达测试数和 touches（例如 `/` 为 37 tests / 111 touches），节点可标 `blocked here`；右侧按分组列测试。页面提供 `Hover a test to trace its path. Click to replay it.` 以及 Zoom out / Zoom in / Fit the map。还观察到 `Reading page snapshots · 25/36`，再次进入时出现 `Charting this run…`，说明图形有异步构建状态。[UI-Run]
- **Browsers**：顶部 `Didn't pass 8` 汇总 5 Failed + 3 Blocked，并列根因摘要；下方写 `37 browsers, one test each`，按用例展示 Passed 或失败说明。该样本已完成，未观察到 LIVE/Queued 卡片。[UI-Run]

### 4. 单测试结果、步骤、截图与日志

- 点击结果行会在当前 Run URL 上追加 `?test=<result-id>` 并打开 `Test result details` drawer；关闭后 query 消失。drawer 有 Share、Copy link、Expand、Close、`Re-Run`、`Manage Test Case`。`Manage Test Case` 链到 `/test-cases/<test-case-id>`，而 drawer 明确写 `The test as this run executed it. Read-only here.`[UI-Failed]
- drawer 同时保留本次执行的 Basics、Priority、Test Description (Goal)、Steps 和 Run Settings；样本为 `Step Timeout = Default`、`Viewport = Inherit from project (1920 × 1080)`。这构成历史执行快照与可编辑测试详情之间的边界。[UI-Failed]
- **Failed 样本**：计划有 7 步，但 Run log 有 9 条实际 action/assertion；第 #9 断言失败，日志标 `Test Result · Failed at #9`，各步可 `Show more`。Preview 显示页面快照，提供 Previous / Pause / Next、`#n · n/9`、速度 `1×`、`Replay / Screen Recording` 和 `View Run Log`。右侧 Error 给出 TEST FAILURE 与 OBSERVATIONS，Cause 是根因分析，Fix 是只读修复建议，另有 `Copy Fix Prompt`。[UI-Failed]
- **Passed 样本**：Run log 有 8 条，仍可使用逐步 Replay / Screen Recording；结果显示 `Test successful. No errors detected.`，没有出现 Failed 样本的 Error/Cause/Fix 面板。[UI-Passed]
- **Blocked 样本**：显示 `TEST BLOCKED`，原因是未提供有效 Excel/CSV 上传文件，OBSERVATIONS 说明无法完成及验证导入；仍有 Re-Run / Manage Test Case / Error / Cause / Fix / Copy Fix Prompt，但此样本没有 Run log 数量或 Replay 控件。Test Cases 另两条 Blocked 的摘要分别是缺少 system message、缺少 data-alert，支持“测试数据/前置条件缺失也可阻塞 UI 用例”这一观察，而非只有 API 上游依赖失败。[UI-Blocked] · [UI-TestCases]

### 5. 报告与 AI 修复入口

- `View Report` 在同一 Page 导航到 `/report?executionId=<run-id>`；面包屑增加 Report，侧栏 Test Cases/Test Runs 链接携带 executionId。报告含 use-case 分布、总计及 `Passed 29 / 78%`、`Failed 5 / 14%`、`Blocked 3 / 8%`。[UI-Report]
- `Detailed Test Report` 是指向 `/pdf/v3/<project-id>?executionId=...&orgId=...` 的链接；未打开或下载。页面另有 AI Test Summary、`Fix prompt for your coding agent` / `Copy Prompt`、完整修复提示、Issues found、What could be better、Recommendations。[UI-Report]
- Issues found 将 5 Failed 按根因聚为 5 个 issue，Blocked 单独分组；文案明确相同根因共享一行。每个测试链接在同一 report URL 上追加 `&test=<result-id>`。[UI-Report]
- **观察到的数据不一致**：同一报告统计卡是 29 Passed / 37 Total，AI Test Summary 却写 `22 tests passed` 和 `22/27`。复刻时应将结构化计数与 AI 文本分开建模，不应让摘要反向覆盖运行计数；本票据不判断该差异的根因。[UI-Report]
- 当前 AI 修复闭环的可证实入口是 Copy Fix Prompt / Copy Prompt、Fix 只读建议及测试管理/重跑链接；未提交聊天或修复，也未观察到自动改代码的提交动作。

### 6. 状态变化与动态行为

- 选择用例会即时改变顶部按钮并出现底部 toolbar；List / Agent Action / Browsers 通过 tab 切换内容，Run URL 不变。结果 drawer 则把 `test` 写入 URL，可直接分享/刷新定位。[UI-TestCases] · [UI-Run] · [UI-Failed]
- Failed 样本加载后 Replay 自动从 #1 推进到 #7、#9，控件由播放状态变为可 Pause；这是实际观察到的步骤播放，不是仅文档推断。未测量帧率或转场参数。[UI-Failed]
- drawer 关闭时先变为空内容/`aria-hidden=true`，随后列表恢复交互；可确认有过渡过程，但不能据一次自动化点击推导准确时长或 easing。[UI-Run]
- 本次没有活动 Run，故 queued/running 的实时迁移、LIVE 标记、取消和运行中禁用状态均只保留为 docs-only 或未知项。

### UI 证据 URL

[UI-TestCases]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/test-cases
[UI-TestRuns]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/execution
[UI-Run]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/execution/f2110576-be2c-4d28-934f-2055c3de4a1c
[UI-Failed]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/execution/f2110576-be2c-4d28-934f-2055c3de4a1c?test=27c1ac4b-1ccb-4843-890d-b93afd9709b2
[UI-Passed]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/execution/f2110576-be2c-4d28-934f-2055c3de4a1c?test=daede6be-8983-412d-b115-4f22ebbc88ac
[UI-Blocked]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/execution/f2110576-be2c-4d28-934f-2055c3de4a1c?test=79eef4d5-c34e-466f-a88a-a798d15d5beb
[UI-Report]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/report?executionId=f2110576-be2c-4d28-934f-2055c3de4a1c
[UI-RunBehavior]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/execution-settings
