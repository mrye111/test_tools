# TestSprite AI Chat：上下文、动作审批与会话契约

- 日期：2026-11-04
- 票据：[#45 调研：AI Chat 上下文、动作审批与会话契约](https://github.com/mrye111/test_tools/issues/45)
- 地图：[#32 Wayfinder 地图：独立 TestSprite 全流程复刻](https://github.com/mrye111/test_tools/issues/32)
- 目标阶段：P3 完整 AI Chat 复刻

> 本报告使用 TestSprite 第一方公开文档，以及本地图其他研究分支已提交的只读 UI 观察。此次没有打开参考产品执行新操作，没有发送消息、上传文件、批准动作或运行测试。文档中的能力概述不等于逐项实测，也不构成公开 API/schema。

## 1. 结论摘要

1. **会话归属于 Workspace，上下文一次聚焦一个 Project。**从项目页打开 Chat 会继承该项目；也可通过自然语言或 composer 的项目选择器切换。每个 turn 都重新读取聚焦项目，因此外部修改会进入下一次回答。[DOC-CHAT]
2. **读取与变更分两条路径。**列测试、查运行、搜索 Sources 等读取直接发生；创建、编辑、删除、运行等状态变更必须先出现提案卡，未 Resolve 前不得执行。[DOC-APPROVAL]
3. **提案不是摘要，而是完整执行载荷。**卡片展示将使用的精确值；部分动作允许批准前修正。Approve 按展示值执行且只执行一次；Reject 不执行；直接输入修正会生成修订提案，不等于拒绝。[DOC-APPROVAL]
4. **消息附件与 Project Source 必须分开。**图片/文件可随消息发送，但官方只承诺在发送所在 turn 读取；没有证据表明消息附件会自动成为持久 Project Source。Chat 另可提议上传 Documents/Test Files、连接 GitHub、添加 Figma/Linear/Jira 等 Sources。[DOC-CHAT] [DOC-SOURCES]
5. **Chat 是同一业务对象模型上的另一操作面。**它横跨 Projects、Sources、Cases、Runs、Test Lists、Test Schedules；Run 是冻结历史，Case 状态反映最近一次 Run。List 可跨项目，这与“一次聚焦一个项目”的上下文组合方式未被公开说明。[DOC-CHAT] [DOC-LISTS]
6. **审批不等于授权。**Workspace 角色仍决定可读/可写边界：Viewer 只读，Member 可创建/编辑/运行/删除测试和项目，Admin/Owner 增加管理权限；没有项目级权限。Chat 专属的角色检查和已打开提案在角色变化后的处理没有公开细节。[DOC-ROLES] [DOC-SHARING]
7. **流式响应、取消与错误恢复不能伪造成已知事实。**官方 AI Chat 页面没有定义 token streaming、停止生成、重连/续传、批准后取消、retry/rollback 或部分成功协议；只明确“动作失败会在会话中报告”。既有 UI 观察也没有发送消息，故没有响应流证据。[DOC-APPROVAL] [UI-SHELL]

## 2. 证据口径

| 标记 | 含义 |
| --- | --- |
| **【文档】** | TestSprite 官方公开文档明确陈述；本次读取日期均为 2026-11-04。 |
| **【现场】** | 本地图既有研究文档中的只读 UI/DOM/CSS 观察；不代表本次重新访问。 |
| **【推断】** | 由已列事实得到的复刻约束或归纳，不冒充官方承诺。 |
| **【未知】** | 文档和只读观察均未回答；需要可写沙盒、网络协议取证或自行做产品决策。 |

官方 `llms.txt` 的 Web Portal AI Chat 专页只有 Overview 与 Approving Actions。索引中的 `stream` 条目指测试生成/执行画面，`Cancelling a Run` 属于 CLI；二者都不能当作 Chat 响应流或 Chat 取消契约。[DOC-INDEX] [DOC-CLI-CANCEL]

既有现场证据固定到以下提交，避免后续分支变化改变引用含义：

- [UI-SHELL]：`d83a087e2604fec825830b0ec97b15509669d3e8`，Chat 面板、composer、建议项与动效。
- [UI-AUX]：`bd86734ff38d1dcf7ed8d68bf4f87ac4384ed374`，全局入口、Sources/Lists/Schedules 样本边界。
- [UI-PROJECT]：`20313d40d17beb9285148a96a2b8186fb51fb37b`，Sources 菜单与计划编辑观察。
- [UI-CASES]：`c7f060477654412026ad39800ec0db2da5636791`，项目页和计划编辑器内的 Chats 面板。
- [UI-RUNS]：`74d3e9cabf79ad7b92bd51da792715bd7a88f2fc`，Run/Result/Report 的只读证据及 Web Portal 取消边界。

## 3. 会话、项目选择与上下文

### 3.1 入口和面板形态

**【现场】**Workspace 全局栏的 `Chats` 是打开面板的 button，不是导航 anchor；项目页也有 `Open chat`。桌面端面板从右侧以 overlay 滑入，支持 `Chat settings`、`Maximize panel` / `Exit full screen`、`Collapse panel`；展开/收起使用 260ms translate 过渡。它不改变主页面路由。[UI-SHELL]

**【现场】**Test Cases 列表和全页计划编辑器中均可见 Chats / AI 辅助面板；既有研究没有发送提示词。[UI-CASES]

**【未知】**Chat settings 的完整字段、快捷键、面板展开状态是否持久化，以及 conversation 是否拥有可分享的独立 URL，均没有公开契约。[UI-SHELL] [DOC-CHAT]

### 3.2 Workspace 与 Project focus

**【文档】**[DOC-CHAT]

- 每个 conversation 归属于其创建时所在的 Workspace。
- 一个 conversation 一次聚焦一个 Project；从项目页打开时，该项目成为 focus。
- 可说“let's work on the Amazon project”切换；历史中出现 `Switched focus to Amazon.` 形式的 divider。
- composer 的 project selector 始终显示当前 focus，可点击搜索并切换。
- 每个 turn 重新读取 focus project，其他入口做出的变更会反映在下一次回答中。

**【现场】**空白/欢迎面板的 composer 有 `Ask a question...`、附件夹、`Select Project` 和发送按钮；这与项目选择入口一致，但没有实际切换项目。[UI-SHELL] [UI-AUX]

**【推断】**Workspace 是归属与权限边界，Project focus 是本轮读取/操作的默认目标；二者不能合并为一个字段。Workspace 级入口允许尚未选择项目时出现 `Select Project`，因此复刻可能需要“尚无 focus”的初始态，但官方没有明确 nullable 语义。

**【未知】**切换 Workspace 是否新建/保留 conversation、selector 是否只列当前 Workspace 项目、focus 切换后历史消息的上下文解释、同时打开多个会话时的隔离方式，均未公开。

### 3.3 Conversation 生命周期

**【文档】**标题由第一条消息生成；可在 conversation list 重命名或删除会话。[DOC-CHAT]

**【未知】**以下均没有文档或现场证据：conversation ID/schema、消息保存与保留期、刷新后的草稿/进行态恢复、跨设备同步、历史消息截断、上下文窗口、模型选择、并发消息、归档、删除会话是否影响业务对象。删除会话不得被默认解释为撤销已执行业务动作。

## 4. Prompts、附件与 Sources

### 4.1 Prompt 输入与建议

**【文档】**官方给出的三条可直接粘贴示例为：[DOC-CHAT]

```text
Create a frontend project for https://app.example.com — I'll upload the PRD next.
```

```text
Add test cases covering checkout and payments.
```

```text
Why did TC-012 fail in the last run?
```

**【现场】**欢迎文案为 `Hello, {name}. What can I help you test?`，辅助说明为 `Drop a web URL and I'll explore it, plan the tests, and run them end to end.`。还观察到三个建议项的可见词干：`Test the frontend UI on...`、`Re-run last week's...`、`Generate backend API...`；既有记录没有保留三项的完整文本，不能省略号部分自行补齐。[UI-SHELL]

**【未知】**建议项是否随项目/历史动态生成、点击后是填入还是直接发送、prompt 长度限制、slash command、富文本/Markdown 能力、空消息与重复发送规则均未确定。

### 4.2 消息附件

**【文档】**可向一条消息附加图片和文件；附件在发送它的 turn 被读取。若之后还要使用，官方建议在后继消息中引用相关部分。[DOC-CHAT]

这意味着**不能把附件默认当成后续 turn 自动可用的持久上下文**；但文档也没有说文件立即删除或绝对不可再读取，不应把“turn-scoped”扩写成存储生命周期承诺。

**【现场】**只观察到 composer 的 clip / `Upload file` 控件，没有选择或上传文件。[UI-SHELL] [UI-AUX]

**【未知】**文件类型、大小/数量、上传进度、病毒扫描、存储位置、保留期、预览/删除、失败重试，以及附件是否可在后续 turn 重新检索，均未公开。

### 4.3 消息附件不等于 Project Source

| 路径 | 已证实语义 | 边界 |
| --- | --- | --- |
| Message attachment | 随一条消息提供图片/文件，并在该 turn 读取。[DOC-CHAT] | 没有“自动保存为 Source”的文档承诺。 |
| Project Source | 作为项目输入，供探索、feature/use-case map、计划和用例生成使用；可在创建时或 `Setup → Sources → Add Source` 添加。[DOC-SOURCES] | 与一次性消息输入是不同业务路径。 |
| Chat 中的 Source 操作 | Chat 能力表列出上传 Documents/Test Files、连接 GitHub、添加 Figma/Linear/Jira tickets、重新探索、爬页。[DOC-CHAT] | 没有逐项 payload、卡片或结果协议。 |

**【文档】**Source 类型有项目类型差异：PRD 可用于两类项目，API Doc 仅 Backend；Agent Web Exploration 属于 Frontend；Test Files 是 Beta fixture，供测试遇到上传字段时使用，不是 PRD 的同义词。[DOC-SOURCES]

**【现场】**一个 Frontend 参考项目的 `Add Source` 菜单只实测到 `Upload File`，未选择文件；不能把 Chat 文档列出的所有来源类型直接投射成该菜单的实测项。[UI-PROJECT]

**【推断】**按“所有状态变更先提案”的总规则，真正新增/修改 Project Source 应走提案路径；但官方没有展示 Source 上传专用卡，因此卡片字段和上传发生时机仍是未知项。

## 5. 可读数据范围与流式响应

### 5.1 已明确的读取范围

| 场景 | 官方明确的输入 | 来源 |
| --- | --- | --- |
| 普通项目问答 | focus project 的 live data，每个 turn 重新读取 | [DOC-CHAT] |
| 读取动作 | 列 tests、检查 run、搜索 Sources 直接执行 | [DOC-APPROVAL] |
| 失败问答 | run、per-test result、实际执行的 steps | [DOC-CHAT] |
| 从单个测试旁打开 Chats | test steps、run recording、failure trace | [DOC-MANAGE] |

**【文档】**单测试 Chat 默认看不到应用源码或 PRD；不能用“AI 能回答失败原因”反推它自动读取整个仓库或所有 Sources。[DOC-MANAGE]

**【文档】**`Test coverage` 指当前 live test cases 及其 current status；`Test run` 是一次执行和冻结历史，Case 状态反映 latest run。因此“为什么这次失败”与“这个用例现在什么状态”不是同一只读查询。[DOC-CHAT]

**【未知】**完整可读资源枚举、历史消息是否加入每轮上下文、附件的后续可见性、跨 Project List/Schedule 的读取范围、 Secrets 的检索边界、读取失败时的降级方式均未公开。密码字段的不可回读规则是明确的，但不能据此推导其他敏感字段。[DOC-APPROVAL]

### 5.2 Streaming：未证实

**【未知】**AI Chat 专页没有描述逐 token/逐块响应、思考事件、工具调用事件、cursor、停止生成、重新生成、断线重连或响应续传；既有只读研究未发送消息，因而没有网络或 UI 响应流证据。[DOC-CHAT] [DOC-APPROVAL] [UI-SHELL]

**【现场】**欢迎问候存在逐字母 `chat-enter` 动画。这只是静态欢迎文案的入场效果，不能当作 assistant response streaming 证据。[UI-SHELL]

**【文档】**Run 页面另有实时计数、步骤、快照和视频帧流；这是执行结果页面的动态行为，不等于 Chat 消息流式协议。[DOC-RUNS]

## 6. 提案、审批与问题卡契约

### 6.1 读取与状态变更的分界

**【文档】**[DOC-APPROVAL]

- Reading：listing tests、checking a run、searching sources，立即发生，不需要额外批准。
- Changing state：creating、editing、deleting、running，先由 Chat 发出卡片；在用户 Resolve 前什么都不会执行。
- 这里的 `no permission needed` 位于“读取不需要提案审批”的上下文，不是绕过 Workspace role authorization；角色边界见第 8 节。

### 6.2 提案卡内容

**【文档】**卡片包含 action 与 full payload，即实际使用的精确值而非摘要。例如 Run 卡会指明 Environment；Delete 卡会说明被销毁的数据，示例为 `project X, its 43 test cases, and their run history`。动作支持时，预填字段可在批准前修正。[DOC-APPROVAL]

**【未知】**没有公开统一 action type、payload JSON schema、卡片 ID、过期时间、payload 在批准前被外部修改后的 stale 检查、多个提案的依赖/顺序或并发规则。

### 6.3 三种 Resolve 方式

| 用户行为 | 文档化结果 | 来源 |
| --- | --- | --- |
| Approve | 按卡片显示的 payload 执行；只执行一次；失败会报告到 conversation | [DOC-APPROVAL] |
| Reject | 不执行任何动作，Chat 继续 | [DOC-APPROVAL] |
| Just type / correction | 例如 `use staging instead` 会以新值重新提案；修正不是 Reject | [DOC-APPROVAL] |
| 用普通文字回答问题卡 | 不点击卡片也可 settle 问题 | [DOC-APPROVAL] |
| 一句话回答多个开放项 | 可同时 settle 多个 open things，不必逐字段逐卡操作 | [DOC-APPROVAL] |

**【推断】**“修正后重新提案”意味着复刻应保留“原提案已被新提案取代”的清晰状态，防止新旧 payload 都能批准；但 `superseded` 是本报告建议的状态名，不是官方字段。

### 6.4 Question cards 与 Secrets

**【文档】**无法推断必要信息时，Chat 用 question card 询问 URL、选项或 credential。控件包括 single-select、multi-select、free text、password；多问题以 `1 of 3` 形式的 stepper 呈现，适合自定义答案时 select 可含 `Other`。[DOC-APPROVAL]

**【文档】**Secrets 必须经 password field 收集：掩码显示、不回显到 conversation、保存后也不可读回，界面只显示 `password set`；前后空格保留，因为可能是 secret 的一部分。[DOC-APPROVAL]

**【未知】**问题卡是否可跳过、必填校验、凭证验证失败、凭证保存位置/期限、开放问题在刷新后的恢复、同一句话匹配多个问题的消歧规则均未公开。

## 7. 执行结果与反馈

### 7.1 Chat 内已明确的保证

**【文档】**Approve 后动作执行；approval 只运行一次。若动作失败，failure 会报告在 conversation 中。[DOC-APPROVAL]

**【未知】**官方没有定义成功卡、进度消息、结果 payload、返回的 object/run ID 或链接、部分成功、重复点击的传输层去重、超时后查询、错误码、retry 按钮或补偿/rollback。`only runs once` 是可观察行为承诺，不足以反推具体 idempotency-key 实现。

### 7.2 Run 动作的下游结果

**【文档】**Chat 可运行 Project 或 Test List，也可修改测试步骤并重跑。Run 本身是冻结历史；Case latest status 独立更新。[DOC-CHAT]

**【文档】**通用 Run 页面提供 Running、Queued、Passed、Failed、Blocked、Total 等实时计数；完成后有报告、AI summary、按根因聚合的 Issues 和修复提示。该页面契约适用于 Run/Report，并未承诺 Chat 内显示同样的卡片或进度。[DOC-RUNS]

**【现场】**既有 Run 研究确认运行详情与历史结果只读快照、Report 和 Copy Fix Prompt 等页面；没有从 Chat 批准或执行任何 Run。[UI-RUNS]

## 8. 权限与可见性

### 8.1 文档化角色边界

**【文档】**角色按 Workspace 生效，同一用户可在不同 Workspace 拥有不同角色：[DOC-ROLES]

| 角色 | 与本复刻相关的能力 |
| --- | --- |
| Viewer | 可打开 Projects、Reports、Recordings；只读，不能创建/编辑/运行/删除测试或项目。 |
| Member | Viewer 能力，加上创建项目、生成/编辑/运行/删除测试和项目；无人员、账单或集成管理。 |
| Admin | Member 能力，加上成员、角色和 Workspace integrations 等管理。 |
| Owner | Admin 能力，加上 plan、ownership transfer 和删除 Workspace。 |

**【文档】**没有 per-project permissions。Share 实质是把人加入该 Project 所在 Workspace，对方可访问其中所有项目；要隔离项目需使用不同 Workspace。[DOC-SHARING]

**【推断】**Chat 读取与审批应受同一 Workspace role 约束：Viewer 可读取不代表可 Approve 写操作，Member 可测试也不因此获得 Admin 的 integration 管理权限。官方没有单独发布 Chat permission matrix，因此具体按钮隐藏、禁用或服务端拒绝的表现不能标成已实测。

### 8.2 Chat 专属权限未知项

- Viewer 是否能打开 Chat、发起只读问答，官方 Chat 页未直接说明。
- 各角色能看到哪些 action cards、谁能 Resolve 同一会话中的卡片，未说明。
- 角色在提案打开期间被降级、用户被移出 Workspace、项目被删除后的处理未说明。
- 会话是否仅创建者可见、Workspace 成员是否共享 conversation list，未说明。
- GitHub/Figma/Linear/Jira 等来源操作还需哪些集成权限或 Admin 前置条件，Chat 页没有逐项映射。

以上不能从 Owner 视角的既有现场样本推断；该样本没有 Viewer/Member/Admin 复验。[UI-AUX]

## 9. 与 Projects / Cases / Runs / Sources / Lists / Schedules 的关系

| 对象 | Chat 已明确的操作/读取 | 对象契约及边界 |
| --- | --- | --- |
| **Project** | 从 URL + PRD 创建、切换 focus、删除；从项目页打开会继承 focus。[DOC-CHAT] | 删除提案需明确级联内容；官方示例包括 Cases 与 Run history。[DOC-APPROVAL] |
| **Sources** | 上传 Documents/Test Files、连接 repo/design/ticket、重新探索、爬页、搜索 Sources。[DOC-CHAT] [DOC-APPROVAL] | Sources 是 Project 上游输入；消息附件不自动等于 Source。具体来源受项目类型/套餐/集成约束。[DOC-SOURCES] |
| **Test Cases / Use cases** | 生成 use cases、按 feature 批量增加、手工 authoring、编辑/删除、检查计划质量。[DOC-CHAT] | Test coverage 是 live cases + current status；单测试 Chat 默认读取 steps/recording/failure trace，不默认读取源码/PRD。[DOC-MANAGE] |
| **Runs / Results** | 运行 Project 或 Test List、修改步骤并重跑、读取 Run/Result/实际执行 steps 解释失败。[DOC-CHAT] | Run 是一次冻结执行；Case status 指向 latest run。通用 Run/Report 页面承载实时与最终结果。[DOC-RUNS] |
| **Test Lists** | Chat 能力表明确可运行 Test List，并在 Setup 中列出 Test Lists。[DOC-CHAT] | List 是可复用 Frontend/Backend case 集合，可来自一个或多个项目，作为一个单元运行、追踪历史并被 Schedule 使用。[DOC-LISTS] |
| **Test Schedules** | Chat 能力表在 Setup 中列出 monitoring schedules。[DOC-CHAT] | Schedule 指向一个 List 或一个 Project；target 创建后固定。Project schedule 自动纳入后来新增的 tests，List schedule 只运行列表内 tests；Schedule 产生可查看的 Runs。[DOC-SCHEDULES] |

### 9.1 Lists 与 Schedules 的补充边界

**【文档】**Schedule 可配置 cadence、time window、timezone、recipients，并有 Active/Paused、编辑、暂停/恢复和删除；删除 Schedule 会永久删除其 trigger 与 run history。[DOC-SCHEDULES]

**【未知】**Chat 是否支持创建/编辑/删除 List 或 Schedule 的完整动作矩阵、每种卡片的 payload、是否支持 Pause/Resume、是否在执行结果中返回 List/Schedule/Run 链接，均未逐项公开。Overview 的“anything you can do by clicking through the dashboard”是总能力描述，不能替代逐动作契约。[DOC-CHAT]

**【未知】**一个跨项目 Test List 或其 Schedule 在 single-project focus 下如何选取上下文、如何展示跨项目读取范围、需要哪些逐项目权限，官方没有解释。不能静默把 List 强行归属到当前 focus project。

**【现场】**参考样本没有既有 Test Lists/Schedules，创建器、详情、历史、删除级联和自动暂停均只有文档证据。[UI-AUX]

## 10. 取消、错误与恢复边界

| 层级 | 已证实 | 未证实 |
| --- | --- | --- |
| 生成回答 | 无 | 停止生成、重新生成、断线续传、超时与草稿恢复。[DOC-CHAT] |
| 提案执行前 | Reject 不执行；文字修正会重新提案；问题可用文字回答。[DOC-APPROVAL] | 卡片过期、撤销未执行提案、并发 Resolve。 |
| 提案批准后 | 只执行一次；失败在 conversation 报告。[DOC-APPROVAL] | 取消 executing action、retry、rollback、部分成功、刷新后恢复、重复请求处理。 |
| 由 Chat 触发的 Run | Run 有通用实时/结果页面。[DOC-RUNS] | Chat 是否能停止该 Run、停止后的 Chat 反馈、credits/refund、取消后的重跑。 |
| CLI Run | CLI 有独立 `testsprite test cancel`、detach、退出码与退款契约。[DOC-CLI-CANCEL] | 这些规则不能移植成 Web Portal Chat 能力。 |

**【推断】**Reject 只是执行前决策，不是 executing action 的取消；关闭/删除 conversation 也不能默认取消已批准动作或正在运行的 Run。复刻若需要这些能力，必须作为独立产品决策和真实执行生命周期实现，而不是只加一个 UI 按钮。

## 11. 可实施的最低契约与待决策项

### 11.1 有依据的最低复刻约束

以下为**【推断】**的落地归纳，不是官方 API 字段：

1. Conversation 至少表达 Workspace 归属、当前 Project focus、消息/附件、提案/问题卡及其 Resolve 状态；每个 turn 以最新 Project 数据重建读取上下文。
2. 将 read 与 write intent 分开；write intent 在执行前生成包含精确 payload 的持久提案，不允许模型直接写业务数据。
3. Approve、Reject、Correct、Answer question 都是一等输入；文字修正产生新提案，批准后确保同一提案不会执行两次。
4. 问题卡支持文档列出的四类控件；secret 使用专用密码路径，掩码、不回显、不可从保存配置读回，且保留前后空格。
5. Message attachment 与 Project Source 分表/分流程建模；除非另有产品决定，不宣称附件长期可检索或自动进入 Sources。
6. Projects/Cases/Runs/Sources/Lists/Schedules 使用本独立模块自己的业务对象与权限检查；Chat 只是另一操作面，不复制一套脱离主生命周期的数据。
7. 对没有证据的 streaming、cancel、retry、跨项目 List 上下文提供显式设计决策，不用欢迎动画或 Run 页面实时刷新冒充 Chat 协议。

### 11.2 仍需决策或补充取证

1. **响应协议**：是否逐 token/事件流式输出，包含哪些阶段，停止/重发/重连/刷新恢复如何实现。
2. **附件协议**：类型、大小、数量、保留与后续 turn 可见性，及何时成为持久 Source。
3. **动作矩阵**：每类 Project/Source/Case/Run/List/Schedule 动作的 payload、可编辑字段、结果卡与失败码。
4. **执行一致性**：stale payload、并发审批、重复点击、超时未知结果、部分成功与补偿策略。
5. **授权细节**：Viewer Chat 可用性、共享会话可见性、角色变更/成员移除后的开放提案。
6. **取消恢复**：回答、已批准动作及派生 Run 的取消语义；错误后的 retry/resume；是否有 credits/refund 反馈。
7. **跨项目编排**：single-project focus 与跨项目 Test List/Schedule 的读取、展示和权限语义。

这些未知项不阻碍按第 11.1 节建立基础交互模型，但阻碍宣称“完整真实行为已复刻”。若要求逐项一致，需要获授权的可写沙盒和只读网络协议取证；当前票据没有执行这些操作。

## 12. 来源索引

### 第一方公开文档

- [TestSprite Documentation Index][DOC-INDEX]
- [AI Chat — Overview][DOC-CHAT]
- [AI Chat — Approving Actions][DOC-APPROVAL]
- [Managing Test Cases][DOC-MANAGE]
- [Project Sources][DOC-SOURCES]
- [Test Runs & Reports][DOC-RUNS]
- [Test Lists][DOC-LISTS]
- [Test Schedules][DOC-SCHEDULES]
- [Members & Roles][DOC-ROLES]
- [Sharing a Project][DOC-SHARING]
- [CLI — Cancelling a Run][DOC-CLI-CANCEL]（只用于说明边界，不作为 Chat 能力证据）

### 本地图既有只读研究

- [应用壳层与 Chat Panel，`d83a087`][UI-SHELL]
- [辅助模块与 Chats 入口，`bd86734`][UI-AUX]
- [项目创建与 Sources，`20313d4`][UI-PROJECT]
- [Test Cases 与详情/编辑器，`c7f0604`][UI-CASES]
- [Test Runs 执行与结果，`74d3e9c`][UI-RUNS]

[DOC-INDEX]: https://docs.testsprite.com/llms.txt
[DOC-CHAT]: https://docs.testsprite.com/web-portal/ai-chat/overview.md
[DOC-APPROVAL]: https://docs.testsprite.com/web-portal/ai-chat/approving-actions.md
[DOC-MANAGE]: https://docs.testsprite.com/web-portal/core/working-with-test/managing-test-cases.md
[DOC-SOURCES]: https://docs.testsprite.com/web-portal/setup/project-sources.md
[DOC-RUNS]: https://docs.testsprite.com/web-portal/results/test-report.md
[DOC-LISTS]: https://docs.testsprite.com/web-portal/maintenance/test-lists.md
[DOC-SCHEDULES]: https://docs.testsprite.com/web-portal/maintenance/monitoring.md
[DOC-ROLES]: https://docs.testsprite.com/web-portal/admin/members-and-roles.md
[DOC-SHARING]: https://docs.testsprite.com/web-portal/admin/sharing.md
[DOC-CLI-CANCEL]: https://docs.testsprite.com/cli/core/cancelling-runs.md
[UI-SHELL]: https://github.com/mrye111/test_tools/blob/d83a087e2604fec825830b0ec97b15509669d3e8/docs/research/2026-11-04-testsprite-shell-motion.md
[UI-AUX]: https://github.com/mrye111/test_tools/blob/bd86734ff38d1dcf7ed8d68bf4f87ac4384ed374/docs/research/2026-11-04-testsprite-auxiliary-modules.md
[UI-PROJECT]: https://github.com/mrye111/test_tools/blob/20313d40d17beb9285148a96a2b8186fb51fb37b/docs/research/2026-11-04-testsprite-project-generation.md
[UI-CASES]: https://github.com/mrye111/test_tools/blob/c7f060477654412026ad39800ec0db2da5636791/docs/research/2026-11-04-testsprite-test-cases.md
[UI-RUNS]: https://github.com/mrye111/test_tools/blob/74d3e9cabf79ad7b92bd51da792715bd7a88f2fc/docs/research/2026-11-04-testsprite-test-runs.md
