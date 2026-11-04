# TestSprite 项目创建、Sources 与测试计划生成全流程

- 日期：2026-11-04
- 研究票：[mrye111/test_tools#33](https://github.com/mrye111/test_tools/issues/33)
- 父地图：[mrye111/test_tools#32](https://github.com/mrye111/test_tools/issues/32)
- 范围：All Projects / New Project、Sources、测试计划生成与审阅/编辑、首批测试用例生成。
- 安全边界：全程只读；未创建、提交或修改项目，未上传文件，未保存计划，未生成或执行测试。

## 1. 证据口径

本文使用三种明确标记：

- **【实测】**：2026-11-04 在 ego-browser TaskSpace `1`（`testsprite-test-cases-readonly`）中，由本会话新建的 Page `p5` 观察参考实例。未操作 `p1` 或其他代理的 Page，未结束 TaskSpace。
- **【文档】**：只来自 TestSprite 官方公开文档及其第一方截图；不代表本次在参考实例中重新走通。
- **【推断】**：由已列证据组合出的复刻流程或状态解释，仍需后续验证。

实测入口：

- 项目列表：[LIVE-LIST]
- 新建项目：[LIVE-CREATE]
- 参考项目 Sources：[LIVE-SOURCES]
- 参考项目 Test Cases：[LIVE-CASES]
- 参考项目计划编辑：[LIVE-PLAN-EDIT]

参考实例是一个已有 37 条用例的 Frontend 项目。它能直接证明列表、Sources 完成态、用例结果列表和既有计划编辑器的形态，但不能证明新项目初次生成时的实时过程。

## 2. 全流程结论

**【推断】综合实测与官方文档，UI 项目主链路为：**

```text
All Projects
  → New Project
  → 1 Basics
  → 2 Access details
  → 3 Extra Context / Test Sources
  → Create project
  → Agent 探索站点 + 读取 Sources
  → Test Coverage / feature-use-case map
  → 选择功能并 Plan Tests
  → Review proposed tests（选择、编辑、增删、调优先级）
  → Run all / Run N tests（确认计划快照）
  → 并行生成 Playwright 代码并执行
  → Test Cases 按 use case 展示首批用例与最新状态
```

其中 `All Projects → New Project → Basics`、既有项目的 Sources 完成态、Test Cases 和 Edit Test Plan 为**【实测】**；`Create project` 之后的初次探索、计划生成和代码生成时序为**【文档】**。官方文档没有发布一份统一、正式的跨页面状态机，上述箭头是对分散文档步骤的综合，而不是官方状态机原文。[DOC-UI-QUICKSTART] [DOC-UI-PLAN] [DOC-UI-GEN]

Backend API 项目复用三段式创建骨架，但 Access details 改为 API 文档/端点发现，首批代码为 Python `requests`；详见第 8 节。[DOC-API-QUICKSTART] [DOC-API-DISCOVERY] [DOC-API-PLAN] [DOC-API-TESTS]

## 3. All Projects 与新建项目

### 3.1 All Projects：页面结构与控件

**【实测】**[LIVE-LIST]

- 保留左侧全局图标导航；顶部 breadcrumb 为 `All Projects`。
- 标题 `All Projects`，副文案 `Every project in this workspace, with its latest results.`。
- 工具区有 `Search`、过滤器图标、排序图标，右侧主按钮 `New Project`。
- 来源页签：`All / Web Portal / CLI / MCP`。
- 表格列：`Project Name / Latest Results / Last Activity / Created At / Source / Type / Creator`，最右还有行级更多操作图标。
- `Project Name`、`Last Activity`、`Created At`、`Source`、`Type` 的列标题也是按钮；`Latest Results` 与 `Creator` 为纯文本列头。
- 底部为 `25 Rows`、Previous、页码、Next。

过滤器菜单首先提供 `Type`、`Creator`；`Type` 子菜单是单选项 `Frontend / Backend`。排序菜单包含：

- `Sort By`：`Last Activity / Created At / Project Name / Type`。
- `Order`：`Ascending / Descending`。
- 本次参考列表的选中标记位于 `Created At` 与 `Descending`。

**加载态【实测】**：首次进入时，表头和六个空白表格行先出现，行内没有项目文本；随后才替换为项目数据。这是骨架行式加载反馈。此次未出现空项目或请求错误。[LIVE-LIST]

**完成态【实测】**：参考工作区只有一行项目，显示项目名、最近结果的三个图形计数、相对活动时间、创建时间、`Web Portal`、`Frontend` 和创建者。`Latest Results` 的计数为 29、3、5，但列表本身没有可读状态文字；它与项目内 29 Passed、3 Blocked、5 Failed 数量吻合，具体图标到状态的映射仍属**【推断】**。[LIVE-LIST] [LIVE-CASES]

**【文档】**项目可见性随当前 workspace 变化；官方概览同样描述 All Projects 按类型组织并展示运行状态。[DOC-PORTAL-OVERVIEW] [DOC-WORKSPACES]

### 3.2 New Project：不是弹窗，而是独立页面

**【实测】**点击 `New Project` 导航到 `/create-test/new-project`，不是 modal。页面保留全局左栏，breadcrumb 为 `All Projects > New Project`，可通过 breadcrumb 返回列表。[LIVE-CREATE]

页面标题 `Create a project`。主表单在左，`Other Ways to Start` 在右。三步进度条为：

1. `Basics`
2. `Access details`
3. `Extra Context`

第一步卡片标题为 `What to test`，副文案 `Where the AI agent will run your tests.`。右侧另有 `Start with the CLI`、`Start with AI chat`，以及 `MCP client` 入口；本次未进入这些分流。[LIVE-CREATE]

### 3.3 Basics：Frontend UI

**【实测】**[LIVE-CREATE]

| 控件 | 实测表现 |
|---|---|
| `Test Type *` | 分段页签 `Frontend UI / Backend API`；初始选中 Frontend UI。 |
| `URL *` | `input[name="endpoint"]`，placeholder `e.g. www.example.com`。 |
| URL 帮助 | `The URL we’ll test. It must be publicly accessible.` |
| `Project Name *` | `input[name="name"]`，placeholder `My project`。 |
| 状态提示 | 空表单显示 `Enter your app’s URL to continue.`。 |
| 下一步 | `Continue ↵`，空表单时原生 `disabled=true`。 |

两个文本框均没有 HTML `required`、`minLength`、`maxLength` 或 `pattern` 属性；星号与禁用按钮说明校验由应用逻辑承担，不能只复刻原生 required 校验。此次没有填写内容，因此 URL 语法、项目名长度/唯一性、错误文案和项目名称是否单独阻塞 Continue 均未验证。[LIVE-CREATE]

### 3.4 Basics：Backend API 变体

**【实测】**切换到 `Backend API` 只改变本地表单，没有创建数据：[LIVE-CREATE]

- `URL *` 改为 `Base Endpoint *`。
- placeholder 改为 `e.g. https://api.example.com`。
- 帮助文案改为 `The host we’ll send requests to. It must be publicly accessible.`。
- 状态提示改为 `Enter your API’s base endpoint to continue.`。
- `Project Name *` 与禁用的 `Continue ↵` 保留。

### 3.5 创建向导后续步骤

**【文档】Frontend UI：**

- Access details 提供 `No sign-in` / `Sign-in required`。登录方式包括测试账号用户名/密码、OTP（Email / Phone / Email + Phone）和 SSO。[DOC-UI-AUTH]
- 用户名/密码方式检查两者均已填写；OTP 在创建时固定验证渠道。SSO 会打开实时浏览器，出现 `Opening a live browser…`，人工登录后以 `I’ve finished logging in` 完成，成功显示 `Login captured ✓`；`Skip for now` 仍可创建项目，但后续运行处于未登录状态。[DOC-UI-AUTH]
- 第三步在文档中有 `Extra Context` 与 `Test Sources` 两种称呼。可选择 `I have a PRD / I don’t have a PRD`，上传 PRD 和补充探索/计划提示；PRD 被强烈推荐但不是必填。`Create project` 保存并开始探索。[DOC-UI-QUICKSTART] [DOC-UI-PLAN]

**【文档】Backend API：**Access details 提供 `Upload API docs` 或无文档时 `Add Endpoints Manually`；Extra Context 可上传 PRD、填写 `Extra Instructions`，截图还显示 `Advanced Context (Optional)` 下的 `Test Files — BETA / Add Files`。最后点击 `Create project`。[DOC-API-QUICKSTART]

**未实测边界：**没有填写 Basics，因而没有 live 进入第 2、3 步；上述后续字段、Back/Continue 和 Create project 行为均不得标成参考实例实测。

## 4. Sources

### 4.1 既有项目页面结构

**【实测】**[LIVE-SOURCES]

- 项目左栏分组为 `Setup`、`Workspace`、`Analytics`、`Activity`、`Project Settings`；Sources 位于 Setup，并带数量徽标 `1`。
- 顶部为 `Back`、项目类型、breadcrumb、`Share` 和复制链接按钮。
- 标题 `Sources`，副文案 `What the agent reads to understand your app. Better sources make better tests.`。
- 工具行有 `Search Sources` 与 `Add Source`。
- 首次渲染时先出现标题和工具行，来源卡片暂时为空；约 4 秒后出现完整内容。未观察到有语义文本的 spinner 或错误提示。

### 4.2 Explore your site：Ready 完成态

**【实测】**参考项目显示：[LIVE-SOURCES]

- 卡片标题 `Explore your site`，数量 `1`，状态 `Ready`。
- 文案明确 agent 浏览默认环境 URL，并把发现保存为 captured pages，供生成测试读取。
- 操作 `Re-Explore`；本次未点击，因为它会启动新的探索。
- `Site Overview` 预览卡包含 video；DOM 另有 `Open Site Overview` 和 `Remove Site Overview` 控件，本次均未执行。
- `Captured pages 26` 表示探索保存了 26 页；文案为 `Pages the agent saved while exploring. Test generation reads them.`。
- 下方为六张页面缩略图和 `View All 26`。

### 4.3 Documents 空态与新增来源

**【实测】**Documents 区域文案为 `Product docs the agent reads, like PRDs and specs.`；空态为 `No documents connected yet`，操作是 `Upload Document`。[LIVE-SOURCES]

点击 `Add Source` 只展开一个菜单，菜单项为 `Upload File`；没有选择文件或上传。该菜单计算样式为 `animation-name: enter`、`animation-duration: 0.15s`，是本次唯一直接量到的入场动效。[LIVE-SOURCES]

**【文档】**官方将来源归为：[DOC-PROJECT-SOURCES] [DOC-API-DISCOVERY]

| 来源 | 官方说明 |
|---|---|
| PRD Upload | Frontend/Backend 均可；用于功能、use case 和覆盖规划。 |
| API Doc Upload | Backend；支持 OpenAPI、Swagger、Postman，以及自由格式 Markdown/PDF/文本端点资料。GraphQL 为 best-effort，纯 RPC 不受支持。 |
| Agent Web Exploration | Frontend；创建后自动浏览，可重新探索。 |
| Test Files / Fixtures | Beta、受套餐限制；供测试遇到上传字段时使用。 |

AI Chat 文档还列出 GitHub、Figma、Linear/Jira、爬页等能力，但不能据此认定它们都存在于创建向导或本项目的 `Add Source` 菜单；本次 Frontend 参考实例的菜单实测只有 `Upload File`。[DOC-AI-CHAT] [LIVE-SOURCES]

### 4.4 探索过程与状态

**【文档】**[DOC-FEATURE-EXPLORATION]

- 创建后立即开始读取来源和探索；通常约 3 分钟，多功能并行探索，离开后可恢复，部分探索也可继续规划。
- Sources 可出现 `AI agent exploring your app` / `AI agents exploring your app`、实时浏览器预览、`2/4 agents finished` 形式的计数，以及单 agent 的 `Starting → Logging in → Exploring → Done / Failed`。
- `Explore your site` 的状态集合为 `Processing / Ready / Failed`；本次只实测到 `Ready`。
- 每次探索保留 recording 和 captured pages。环境修正入口为 `Project Settings → Test Execution → Environment`，随后 `Re-explore`。

## 5. Test Cases：首批用例的落点

### 5.1 结果列表结构

**【实测】**[LIVE-CASES]

- 标题副文案：`Every test in this project, grouped by use case, with its latest result.`。
- 工具区：`Search Tests`、过滤器图标、`Edit Test Plan`、`Add More Tests`、`Run All 37`。
- 状态页签及本次计数：`All 37 / Planned 0 / Generated 0 / Running 0 / Passed 29 / Failed 5 / Blocked 3`。
- 表头：`ID / Latest Status / Test Name / Priority`；有全选、分组选择、行选择和可点击排序标题。
- 用例按 use case 分组，组名带数量；行内显示 ID、最新状态、相对运行时间、标题和优先级。
- 底部为 `50 Rows` 与分页控件。
- `Add More Tests` 菜单有两项：`Add Tests with AI`、`Add Test Manually`。本次没有进入生成或新增表单。
- 未点击 `Run All 37`，未执行任何测试。

**重要差异：**参考实例有 `Generated` 状态页签，且没有独立的 `Queued` 页签；官方生成文档常列 `Queued / Running / Passed / Failed / Blocked`，quickstart 还提到 `Planned`。复刻时应以实测页签为当前 UI 证据，同时把 Queued 是否为内部状态列为未决，不要擅自合并。[LIVE-CASES] [DOC-UI-GEN] [DOC-UI-QUICKSTART]

### 5.2 Edit Test Plan：进入与退出

**【实测】**点击 `Edit Test Plan` 后 URL 增加 `?edit=plan`，breadcrumb 变为 `项目 > Test Cases > Edit Test Plan`。这是项目工作区内的独立编辑状态，不是弹窗。[LIVE-PLAN-EDIT]

页面说明直接给出保存边界：

> Add use cases and tests, or change any test’s priority, title, goal and steps. Nothing is saved until you press Save Changes.

顶部有 `Form / YAML` 两个编辑模式、`No changes yet`、`Done`、`Save Changes`。干净状态下 Done 可用，Save Changes 为原生 disabled。点击 Done 在无修改时返回 Test Cases，并移除 `?edit=plan`；本次没有产生或保存任何修改。[LIVE-PLAN-EDIT]

### 5.3 Form 编辑器

**【实测】**[LIVE-PLAN-EDIT]

- 每个 use case 是可折叠组，显示名称和 `N tests`，右侧有组级 actions 菜单。
- 每条测试显示 ID、Priority、Title 和 `N steps`。
- 每组底部有 `Add Test`，全部组底部有 `Add Use Case`。
- 点击测试标题在该行下方展开内联编辑器，而非导航离开计划页。
- 编辑器字段：`Priority` 下拉、`Title`、`Goal`。Goal 帮助为 `What must be true for this test to pass.`。
- Steps 是有序列表。每一步有 action/assertion 类型切换按钮、步骤 textarea、删除按钮；非末尾步骤还有 `Add a step after step N`，列表末尾另有 `Add Step`。
- 参考步骤的辅助 placeholder 会随类型变化；assertion 示例为 `What should be true at this point?`。

本次只展开既有用例，没有切换步骤类型、编辑字段、添加/删除步骤或改变优先级。因此 dirty 状态、字段校验、删除确认和保存错误仍未实测。

### 5.4 YAML 编辑器

**【实测】**YAML 模式使用带行号的 Monaco 编辑器。页面内置注释明确支持：[LIVE-PLAN-EDIT]

- 修改 `name / description / priority / steps`。
- 新增测试时省略 `id` 或使用新 ID。
- 把测试放到另一个 use case 下来移动它。
- 用新的 `useCase` 块新增分组，`slug` 可省略。
- 删除测试或整个 use case 块来移除对象。
- 普通步骤行是 action，`assert: ...` 是断言。
- 最后保存应用修改。

实测数据结构为 `useCases[] → { useCase, slug, testCases[] }`，测试项含 `{ id, priority, name, description, steps[] }`。这为复刻提供了直接的数据形状证据，但 YAML 语法错误、schema 校验和保存冲突没有触发测试。

## 6. 初次测试计划生成与审阅

以下均为**【文档】**，不是本次 live 初次生成实测。

### 6.1 从 Sources 到计划

- UI 创建后，Test Coverage 展示从探索与来源得到的功能/use case；选择功能并点击 `Plan Tests`，官方建议首轮 `Select All`。[DOC-UI-QUICKSTART]
- 规划输入包括 feature map、PRD/附加上下文；UI 还使用观察到的流程与登录信息，API 使用发现的端点与响应结构。[DOC-UI-PLAN] [DOC-API-PLAN]
- UI 计划阶段不会执行浏览器动作，API 计划阶段不会发送 API HTTP 请求。[DOC-UI-PLAN] [DOC-API-PLAN]
- 未探索功能仍可基于规格 best-effort 生成计划，但其证据弱于已观察流程。[DOC-UI-PLAN]

### 6.2 Review proposed tests

**UI 文档形态：**[DOC-UI-PLAN]

- 按 use case 分组；行字段为 `checkbox · No. · Priority · Test Name · Test Description`。
- `Show flow` 展开可编辑的 Action / Assertion 步骤。
- 支持逐行选择、表头 `Select All`、内联标题/描述编辑、Priority 下拉（文档称默认 Medium）和 `+ More Test Case` 添加空自定义行。
- 较高优先级会更早运行。
- `Chats` 可增加或改写候选用例，变更可审阅或撤销，然后再 `Run all`。

**API 文档形态：**[DOC-API-PLAN]

- `Review proposed tests` 按 use case 分组，并有左侧 use case 选择器。
- 行由标题/简述展开，包含预期行为与优先级；支持逐行选择、组内 Select All、内联编辑、优先级调整和 `+ More Test Case for <use case>`。

**确认边界：**`Run all` 或 `Run N tests` 把选中项加入项目并开始生成/执行；被确认计划成为生成快照并锁定，之后变更需要重新生成。[DOC-UI-PLAN] [DOC-API-PLAN]

**不要混淆两个界面：**上述是首次确认前的 `Review proposed tests`；第 5 节实测的是项目已有用例后的 `Edit Test Plan`。二者都允许编辑，但字段、选择语义、按钮和保存/确认边界不同，不应合并成一个页面规格。

## 7. 首批可运行用例生成

以下时序均为**【文档】**；本次没有启动生成或执行。

### 7.1 Frontend UI

- 每条已批准计划生成 Python + Playwright 测试；生成并行执行且带验证，完成的项目逐步流入列表。[DOC-UI-GEN]
- 20 条测试的典型生成时间为 1–3 分钟。文档列出的过程/结果状态包括 Planned、Queued、Running、Passed、Failed、Blocked。[DOC-UI-GEN] [DOC-UI-QUICKSTART]
- 生成失败会成为 Failed；某一行暂时停留在 Running 不妨碍其他行完成，随后可转为 Failed，而不是让整个套件停住。[DOC-UI-GEN]
- Test Runs 提供实时 pass rate、Running/Passed/Failed/Blocked 计数和每个测试的 Agent Actions View 记录。[DOC-UI-QUICKSTART]

### 7.2 Backend API

- 每条计划生成 Python `requests` 测试；验证包括结构完整、端点正确和存在真实断言。[DOC-API-TESTS]
- 验证失败可标为 Failed，甚至可能发生在任何 HTTP 调用之前；恢复操作为 `Regenerate`。[DOC-API-TESTS]
- 并行生成并逐行出现；Running 同时覆盖生成与执行。官方典型值为每测试生成 5–20 秒、执行 1–5 秒。[DOC-API-TESTS]

### 7.3 首批生成后的稳定页面

**【文档 + 实测交叉确认】**官方称 Test Cases 按 use case 分组，行包含标题、优先级、最新状态和最后运行时间，并提供 Add More Tests、Edit Test 与运行控件；API 项目还区分 Endpoint Tests / Integration Tests。[DOC-TEST-DETAIL] 本次 Frontend 参考项目实测到的分组、字段和主要控件与此一致，但实测按钮名是 `Edit Test Plan`，不是单数 `Edit Test`。[LIVE-CASES]

## 8. Backend 创建与来源的额外分支

以下全部为**【文档】**，用于避免把 Frontend 参考实例误当成所有项目类型的完整规格。[DOC-API-QUICKSTART] [DOC-API-DISCOVERY]

1. Basics 输入 Base Endpoint 与 Project Name。
2. Access details 上传 API 文档，或手工添加端点。
3. 上传后立即开始发现；toast 报告找到的 API/端点数，通常 30 秒–3 分钟。
4. `Set Up Your Tests` 按资源族分组展示端点；每项含 method、path、请求/响应结构和认证要求。
5. 可删除端点、修正 path、选择 `Authentication Type → Basic / Bearer / API-key / None`、用 `Customize Header` 批量配置认证、`Add API`，最后 `Save N endpoints`。
6. 以上传更好规格并确认 `Re-extract Endpoints` 会替换整个端点列表，包括手工修改；项目创建后端点列表锁定，根本性变更需要新项目。
7. Extra Context 后创建项目，再进入覆盖与计划审阅。

官方 Project Sources 有一处称 Backend 端点只来自上传 API 文档，而 API Discovery / Quickstart 明确支持手工端点；本文采用更具体的 Discovery 流程，并保留该文档冲突。[DOC-PROJECT-SOURCES] [DOC-API-DISCOVERY]

## 9. 状态、反馈与动效汇总

| 阶段 | 已证实状态/反馈 | 证据 |
|---|---|---|
| All Projects | 六个骨架行 → 项目数据；有搜索、过滤、排序、分页 | 【实测】[LIVE-LIST] |
| Basics | 空表单提示 + Continue disabled；类型切换即时替换字段 | 【实测】[LIVE-CREATE] |
| Access / Extra Context | SSO 实时浏览器、登录捕获成功；文档上传 | 【文档】[DOC-UI-AUTH] [DOC-UI-QUICKSTART] |
| UI 探索 | Processing / Ready / Failed；agent 计数与实时浏览器 | Ready 为【实测】，其余【文档】[LIVE-SOURCES] [DOC-FEATURE-EXPLORATION] |
| Documents | `No documents connected yet` + Upload Document | 【实测】[LIVE-SOURCES] |
| API 发现 | toast 数量反馈，30 秒–3 分钟；端点审阅 | 【文档】[DOC-API-DISCOVERY] |
| 初次计划 | Review proposed tests，确认后锁定生成快照 | 【文档】[DOC-UI-PLAN] [DOC-API-PLAN] |
| 既有计划编辑 | `No changes yet`，Save Changes disabled；Done 返回 | 【实测】[LIVE-PLAN-EDIT] |
| 首批生成 | 并行、逐行流入；典型耗时与失败状态 | 【文档】[DOC-UI-GEN] [DOC-API-TESTS] |
| 菜单动效 | Add Source 菜单 `enter` 150ms | 【实测】[LIVE-SOURCES] |

**动效限制：**本次只量到 Add Source 菜单的 150ms 入场；没有测到向导步骤、路由、计划编辑展开或状态页签的可靠时长/缓动。创建页稳定后 `document.getAnimations()` 为空，但这不能证明进入页面时没有动画。官方还描述实时浏览器流、列表流式更新和 Coverage Map 运行节点/连线点亮，这些属于动态反馈，不等于已给出 motion 规格。[DOC-FEATURE-EXPLORATION] [DOC-UI-GEN] [DOC-COVERAGE-MAP]

## 10. 未决问题与不可推断项

### 项目列表与创建

- 项目列表的真正空态、网络错误、重试、搜索匹配规则、分页边界和响应式布局未观察。
- 项目名长度/唯一性、URL 语法与可达性校验、确切错误文案未知；星号不是完整校验规格。
- 创建向导第 2/3 步未 live 验证；Back、breadcrumb 退出、刷新、草稿保存、未保存提醒和 Create project 失败恢复未知。
- 第三步名称存在文档冲突：`Extra Context` vs `Test Sources`；参考实例实测第一步只证明进度条使用 `Extra Context`。

### Sources

- PRD/测试文件扩展名、大小、数量限制，上传进度、失败、重试、删除确认和搜索行为未知。
- 本次只观察 Frontend 既有项目的 `Add Source → Upload File`；不能推广为所有项目类型的菜单。
- Processing、Failed、上传中空态和 Re-Explore 确认/覆盖语义未实测；不得从 Ready 页面反推动画或错误恢复。

### 计划生成与首批用例

- Plan Tests 的 spinner、百分比、预计时长、取消/重试/ fatal error、零选择行为未公开也未实测。
- 自定义候选行的必填校验、Review proposed tests 的返回/取消、聊天撤销细节未实测。
- 计划确认、代码生成和初次运行没有启动；排队、流式新增、单行失败和恢复只有文档证据。
- Live UI 有 `Generated` 页签而生成文档没有一致列出；`Queued` 是否只是内部状态待确认。
- Form/YAML dirty 状态、校验错误、保存成功/失败、并发冲突、删除确认和快捷键未验证。
- 菜单以外的过渡时长、缓动、skeleton 细节、键盘操作、reduced-motion 与移动端行为均未形成可实施规格。

## 11. 来源索引

### 只读参考实例

[LIVE-LIST]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects
[LIVE-CREATE]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/create-test/new-project
[LIVE-SOURCES]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/settings/source
[LIVE-CASES]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/test-cases
[LIVE-PLAN-EDIT]: https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/test-cases?edit=plan

### TestSprite 官方文档

[DOC-PORTAL-OVERVIEW]: https://docs.testsprite.com/web-portal/getting-started/overview
[DOC-WORKSPACES]: https://docs.testsprite.com/web-portal/admin/workspaces
[DOC-UI-QUICKSTART]: https://docs.testsprite.com/web-portal/core/ui/quickstart
[DOC-UI-AUTH]: https://docs.testsprite.com/web-portal/core/ui/ui-authentication
[DOC-PROJECT-SOURCES]: https://docs.testsprite.com/web-portal/setup/project-sources
[DOC-FEATURE-EXPLORATION]: https://docs.testsprite.com/web-portal/core/ui/feature-exploration
[DOC-UI-PLAN]: https://docs.testsprite.com/web-portal/core/ui/ui-plan-gen
[DOC-UI-GEN]: https://docs.testsprite.com/web-portal/core/ui/ui-test-gen
[DOC-TEST-DETAIL]: https://docs.testsprite.com/web-portal/core/working-with-test/test-detail
[DOC-COVERAGE-MAP]: https://docs.testsprite.com/web-portal/core/working-with-test/coverage-map
[DOC-API-QUICKSTART]: https://docs.testsprite.com/web-portal/core/api/quickstart
[DOC-API-DISCOVERY]: https://docs.testsprite.com/web-portal/core/api/api-discovery
[DOC-API-PLAN]: https://docs.testsprite.com/web-portal/core/api/api-plan-gen
[DOC-API-TESTS]: https://docs.testsprite.com/web-portal/core/api/endpoint-tests
[DOC-AI-CHAT]: https://docs.testsprite.com/web-portal/ai-chat/overview
