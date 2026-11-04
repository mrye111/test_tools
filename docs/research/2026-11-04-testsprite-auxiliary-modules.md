# TestSprite 辅助模块与完整产品功能清单

- 日期：2026-11-04
- 票据：[#37 调研：辅助模块与完整产品功能清单](https://github.com/mrye111/test_tools/issues/37)
- 地图：[#32 Wayfinder 地图：独立 TestSprite 全流程复刻](https://github.com/mrye111/test_tools/issues/32)

> 本文只提供事实清单，不决定复刻范围或分期。核心生命周期简写为 **project → cases → runs**。所有线上操作均为只读：未创建/编辑/删除数据，未执行测试，未连接第三方服务，未购买或发送任何内容。

## 1. 取证口径

### 现场来源

- 参考项目：[Test Cases](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/test-cases)。
- Workspace 根路径：`https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11`。
- Project 根路径：上述 Workspace 根路径 + `/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba`。
- 浏览器：ego-browser TaskSpace 1，专用 Page `p4`；样本是一个 Frontend 项目。下文“现场”均指 2026-11-04 对该样本的静态页面、导航或菜单观察。

### 验证级别

- **双证**：现场看到静态页面/控件，官方文档也描述该模块；不代表创建、保存、授权或执行流程已实测。
- **部分现场**：现场只看到入口、空态、未连接态或部分页面；其余流程明确标为“文档”。
- **文档**：只有官方文档支持，现场内容未得到确认。
- **现场**：只确认当前 UI；未找到对应的专门官方文档页。

### 一句话结构

辅助功能并非一层平铺菜单，而是四类依赖：

1. **上游输入/执行配置**：Sources、Environment、Run Behavior、Test Files。
2. **编排与触发**：Test Lists、Test Schedules、GitHub Action。
3. **结果派生与外发**：Insights、Activity Log、Notifications & Ticketing。
4. **Workspace 管理外壳**：General、Members、Connections、Billing、Share、Profile、Documentation。

## 2. 当前可见导航全量

**Workspace 全局导航**：Get Started、Overview、Chats、All Projects；Automation 下有 Test Lists、Test Schedules；Workspace Settings 下有 General、Members、Billing → Plan/Usage、Connections → Integrations/API Keys；另有 Documentation、Workspace 切换菜单和账户菜单。

**Project 导航**：Setup → Sources、GitHub Action；Workspace → Test Cases、Test Runs；Analytics → Insights；Activity → Activity Log；Project Settings → General、Test Execution（Environment、Run Behavior、Test Files）、Notifications & Ticketing。项目页还可见 Share、Copy link、Onboarding Checklist 和 Open chat。

现场导航证据：[参考项目](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/test-cases)。文档导航对照：[Test Detail Page](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail.md)、[Workspaces](https://docs.testsprite.com/web-portal/admin/workspaces.md)。

## 3. 逐项功能清单

### 3.1 Test Lists

- **用途**：把一个或多个项目中的 Frontend/Backend cases 组成可复用集合，作为 smoke、regression 或 release gate 一起运行、追踪和调度。
- **主要页面/流程（现场）**：`/testlist` 显示标题、“Tests picked from across your projects, so they can run together.”、Search 和 New List；样本中没有列表。Overview 也有 My Test Lists 摘要和创建入口。
- **主要页面/流程（文档）**：New List → 从现有项目挑选 cases → 命名；列表展示上次执行、总/前端/后端数量和最近状态（Passed/Warning/Failed/Blocked/In Progress），支持搜索、状态过滤、计数/时间排序，以及 Add Tests、Run Test List、Delete Test List。CLI 还支持按项目固定环境、运行整个列表或指定 case、`--wait`。
- **核心依赖**：**直接依赖 cases，下游产生 runs/history，并作为 Schedule 的 target**。不是独立于项目的另一套用例数据。
- **验证级别**：**部分现场**（空列表页 + 文档）；未打开创建器、列表详情或执行历史。
- **来源**：[Test Lists](https://docs.testsprite.com/web-portal/maintenance/test-lists.md)、[CLI Test Lists & Schedules](https://docs.testsprite.com/cli/integrations/test-lists-and-schedules.md)、[现场 `/testlist`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/testlist)。

### 3.2 Test Schedules / Monitoring

- **用途**：按小时、日、周或月自动运行一个 Test List 或整个 Project，形成持续监控和运行历史；当前 UI 名称是 Test Schedules，路由仍为 `/monitoring`。
- **主要页面/流程（现场）**：列表页有 Search、New Schedule，以及 Schedule、Runs、When、Next Run、Last 5 Runs、Status 等列；样本为空。Overview 有 Recent Schedules 摘要和 `/monitoring/schedule/add` 创建入口。
- **主要页面/流程（文档）**：New Schedule → 在 Test Lists/Projects 两组中选 target → 配置 cadence、日期时间、时区、有效时间窗和邮件 recipients；Project target 另选执行环境。target 创建后不可改。详情含 Test Execution Trend、Test Execution Breakdown、Previous Executions，可进入完整 run report；支持 Edit、Pause/Resume、Delete。删除会连同 schedule run history 一起删除。
- **结果与保护流程（文档）**：邮件是完成后的结果报告，不是 failure-only 告警；Slack 由项目设置另行发送。连续 10 次没有任何 passing test 会自动暂停；套餐不再包含调度时会暂停，余额不足/支付未过则跳过该次而非自动暂停。
- **核心依赖**：**强依赖现有 project 或 list，持续创建 runs 并消费其历史**。Project schedule 自动纳入以后新增的 cases；List schedule 只运行列表成员。
- **验证级别**：**部分现场**（空列表页 + 文档）；未创建、暂停或删除 schedule。
- **来源**：[Test Schedules](https://docs.testsprite.com/web-portal/maintenance/monitoring.md)、[CLI Test Lists & Schedules](https://docs.testsprite.com/cli/integrations/test-lists-and-schedules.md)、[现场 `/monitoring`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/monitoring)。

### 3.3 Insights / Analytics

- **用途**：项目健康、失败归因、质量趋势和覆盖缺口的派生视图。
- **主要页面/流程（文档）**：
  - Next step：生成 tests、重跑失败或无需操作。
  - Issues to Fix：最新 failed/blocked cases 按 root cause 聚合；New/Flaky/N tests 标记、Suggested fix、affected tests drawer、组级 Re-run、Copy Fix Prompt；没有手工 dismiss。
  - Trends：按最近最多 50 次 runs 展示 Pass rate、Issues caught、Fixed by agent、Regressions。
  - Use Case Coverage：Covered/Planned/Gap、suite pass rate，以及 Generate tests/Run tests 快捷入口。
- **现场限制**：确认 Analytics → Insights 入口和项目 header，但多次等待后正文仍为空；上述面板未在现场复验。
- **核心依赖**：**完全由 project 结构、cases 最新 verdict 和 runs 历史派生**；可发起生成/重跑，但自身不是执行记录存储。
- **验证级别**：**文档**（仅入口现场可见）。
- **来源**：[Insights](https://docs.testsprite.com/web-portal/results/project-overview.md)、[现场 Project 根路径](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba)。

### 3.4 Activity Log 与 Workspace Activity

- **Project Activity Log 用途**：项目审计流，记录谁、何时、对哪个实体做了什么。
- **Project 页面（现场）**：`/activity` 标题为 Activity，副文案“All project activity, newest first.”；有 Search activity、All time、Users、All actions，以及 User/Action/Date & time 表格。样本可见一条“Triggered a run”，含 scope 和 test count。
- **Project 行为（文档）**：编辑事件可含 before → after；覆盖 cases、use cases、runs、schedules、environments、sources、members/roles、GitHub triggers、Slack/email notifications；支持用户、事件类型和 24 小时/7 天/30 天/全部时间过滤。
- **Workspace Activity（现场）**：Workspace 菜单另有 `/activity`，标题为 Workspace activity，副文案明确覆盖“Members, API keys, projects and integrations — newest first.”；同样有搜索、时间、用户和动作过滤。样本显示 No activity yet。它与项目 Activity Log 是两个路由和作用域。
- **核心依赖**：**观察并审计核心生命周期及配置，不自行产生 cases/runs**；Workspace Activity 更偏向管理事件。
- **验证级别**：Project 为**双证**（静态页面和一条 run 事件）；Workspace Activity 为**现场 + 文档中的菜单间接证据**。事件完整枚举、保留期和更多详情未验证。
- **来源**：[Insights → Project Activity Log](https://docs.testsprite.com/web-portal/results/project-overview.md#project-activity-log)、[Workspaces → Switching Workspaces](https://docs.testsprite.com/web-portal/admin/workspaces.md#switching-workspaces)、[现场 Project Activity](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/activity)、[现场 Workspace Activity](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/activity)。

### 3.5 Project Settings → General

- **用途**：项目身份、生成约束和项目级危险操作。
- **主要页面/流程（现场）**：`/settings` 有 Project Name、不可变更的 Project Type、Extra Instructions（生成时的重点/约束）和 Save；Danger Zone 有 Delete Project。Share 位于页面 header，不属于 General 表单。
- **文档补充**：Rename、Share、Export to GitHub、Delete project 被列为项目级操作；删除会级联移除 tests、runs、recordings，且需确认、不可恢复。
- **核心依赖**：**管理生命周期根容器**；Extra Instructions 影响生成，删除影响全部项目数据。
- **验证级别**：**双证**（静态表单/文档）；未保存或删除。
- **不一致**：文档称项目名 autosaved，现场同时存在明确 Save 按钮；实际保存时机未验证。
- **来源**：[Test Detail → Project Settings](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail.md#project-settings)、[现场 `/settings`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/settings)。

### 3.6 Project Settings → Test Execution → Environment

- **用途**：把“测什么”和“在哪里、用什么身份/变量运行”分离，使同一套 cases 可运行于不同部署。
- **主要页面/流程（现场）**：`/settings/environments` 有 Add Environment；环境卡片显示名称、Default 标记、Website URL 和 Test account 摘要。现场文案称“the first one is the default”。
- **主要页面/流程（文档）**：环境包含 Name、Website URL、Authentication、Custom Variables；支持 Add/Edit、Set As Active、Add Variable、Auto-refresh Login。Backend 另有 per-endpoint authentication/extra headers。至少保留一个环境；Portal 手工 runs 使用 Active 环境；Test List 可按项目固定环境，Schedule 继承这些 pin。
- **核心依赖**：**运行前置配置**。cases 中的环境 placeholder 在 run 前解析；切换环境不要求重新生成 cases。
- **验证级别**：**部分现场**（列表/卡片 + 文档）；未打开编辑对话框，未切换环境。
- **不一致**：现场使用 Default，Web Portal 文档使用 Active；CLI 文档也使用 Default。需视为术语/版本差异，而非已确认的两种状态。
- **来源**：[Environments](https://docs.testsprite.com/web-portal/setup/environments.md)、[现场 `/settings/environments`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/settings/environments)。

### 3.7 Project Settings → Test Execution → Run Behavior

- **用途**：配置项目内每次 run 的浏览器和并发行为。
- **主要页面/流程（现场）**：`/execution-settings` 显示 Log in once per run、Viewport（样本为 1920×1080）、Tests at the same time（样本为 50）和 Save Changes。Viewport 文案说明移动尺寸只缩窄页面，不模拟触摸/移动浏览器，大尺寸消耗更多 credits。
- **文档补充**：四项为 Viewport、Log in once per run、Max tests per run（10/25/50/75/100/Unlimited，默认 50）、Always use planned steps；前两项仅 Frontend。最后一项默认关闭，用于强制 authored plan 覆盖上次录制步骤。
- **核心依赖**：**配置既有 cases 的 runs**，自身不创建用例或执行记录。
- **验证级别**：**双证**（静态控件/文档）；未修改或保存。
- **不一致**：现场未显示 Always use planned steps，且并发名称为 Tests at the same time，而文档为 Max tests per run。
- **来源**：[Run Behavior](https://docs.testsprite.com/web-portal/setup/execution-settings.md)、[现场 `/execution-settings`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/execution-settings)。

### 3.8 Project Settings → Test Execution → Test Files

- **用途**：向 agent 提供测试期间使用的文档、数据文件和图片；现场文案同时覆盖“步骤上传文件”和“读取文件内数据”两种用途。
- **主要页面/流程（现场）**：`/execution-settings/fixture` 有 Add Files，以及 File、Status、Purpose、Summary、Uploaded 列。未打开上传器，未依据骨架行断言样本是否真的为空。
- **文档补充**：Test Files 为 Beta fixture，在 case 遇到文件上传字段时由 agent 附加；也出现在项目创建 Advanced Context。并非所有套餐包含。
- **核心依赖**：**上游 fixture，下游由 case execution 消费**；不是 Sources 的分析结论，也不是 run result。
- **验证级别**：**部分现场**（专门管理页由现场确认；处理状态、Purpose/Summary 生成方式和执行消费仅文档/未知）。
- **来源**：[Project Sources → Test Files](https://docs.testsprite.com/web-portal/setup/project-sources.md#test-files)、[现场 `/execution-settings/fixture`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/execution-settings/fixture)。

### 3.9 Project Settings → Notifications & Ticketing

- **用途**：把 run 结果发送到 Slack，并把失败/阻塞结果转为 Linear/Jira ticket。
- **主要页面/流程（现场）**：`/settings/integration` 有 Slack、Linear、Jira 三张卡；Slack 为结果摘要，Linear/Jira 为失败建单及复发更新。三者均显示 Connect；Linear/Jira 标有 Standard。
- **Slack 流程（文档）**：Workspace 连接一次 → 项目选择 channel → 打开 Notify on test run completion → Save。手动、定时、GitHub 和 CLI run 完成后都会发送，不支持 failures-only。
- **Ticketing 流程（文档）**：可从 failed/blocked test 手工 Create Bug Ticket；项目级自动建单需选择 Linear team/Jira project，打开 File tickets for failed tests，可配置 Include blocked tests（默认关）和 Max new tickets per run（默认 20）。重复失败/同 root cause 会 dedup，恢复时追加 comment，但不会自动关闭 Jira/Linear issue。
- **核心依赖**：**完全下游于 runs/results**；Workspace Connections 是授权前置条件。
- **验证级别**：**部分现场**（未连接卡片 + 文档）；未授权、未选择 channel/destination、未创建 ticket。
- **来源**：[Slack Notifications](https://docs.testsprite.com/web-portal/integrations/slack-notifications.md)、[Ticketing](https://docs.testsprite.com/web-portal/integrations/ticketing.md)、[现场 `/settings/integration`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/settings/integration)。

### 3.10 Sources

- **用途**：为探索、feature/use-case map、计划和 case generation 提供事实输入。
- **主要页面/流程（现场）**：`/settings/source` 显示 Sources、Search Sources、Add Source；副文案为“What the agent reads to understand your app. Better sources make better tests.”本次未观察到可核验的 source 行或 Live Site Exploration 明细。
- **主要页面/流程（文档）**：PRD upload（两类项目）、API Doc upload（Backend）、Agent Web Exploration（Frontend，可重跑）、Test Files。Setup → Sources → Add Source 可后续补充；页面还应显示 Live Site Exploration 状态和已抓取页面。Backend endpoint discovery 支持删除、手工添加和补齐覆盖缺口后再保存。
- **AI Chat 边界（文档）**：Chat 还列出 GitHub repo、Figma、Linear/Jira tickets、documents/test files 等 source 操作；这不能证明每一种都在专门 Sources 页面有同等控件。
- **核心依赖**：**位于 cases 上游**，影响生成和覆盖，不是执行结果。
- **验证级别**：**部分现场**（页头/搜索/Add Source + 文档）；Add Source 选项、上传、探索和 endpoint review 未实测。
- **来源**：[Project Sources](https://docs.testsprite.com/web-portal/setup/project-sources.md)、[AI Chat](https://docs.testsprite.com/web-portal/ai-chat/overview.md)、[现场 `/settings/source`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/settings/source)。

### 3.11 GitHub Action / GitHub 集成

- **用途**：在项目已有 cases 后，由 PR 或 branch push 对应的 CI/CD/deployment 信号触发 runs，并把结果回写 GitHub。
- **主要页面/流程（现场）**：`/settings/github-action` 未连接态是 0 of 2：Step 1 Install the GitHub App；Step 2 Add Trigger（安装前不可用）。另有 PR 结果预览：comment 随 run 更新，展示 passed/failed/blocked/total 和完整报告链接；check 默认不因失败变红，需打开 trigger 的 Merge gate 才能阻止合并。
- **主要页面/流程（文档）**：Workspace Connections 安装 GitHub App → 项目 Add Trigger → Pull Request 或 Push → 检测现有 CI/CD event；PR 配 Target URL pattern，Push 选 Environment；可发送 test event 后创建 trigger。Triggers 有 Active/Disabled、Last matched、启停/删除；Trigger activity 记录匹配事件、结果、Execution 链接、commit 和时间，保留 30 天。PR 还支持 Include draft PRs、Block PR until tests pass。
- **两个相邻但不同的入口**：
  - **Export to GitHub**：All Projects 行菜单现场可见；把项目所有已完成执行的生成代码推到 repo，使用个人 GitHub login，不是 GitHub App。
  - **GitHub Actions / CLI CI**：当前文档用 `testsprite ci init github` 生成 workflow、`testsprite ci run` 执行和 gate；产生 PR check、job summary/annotations、JSON artifact 和 Portal run。它不是上述项目 GitHub App trigger 页面。
- **核心依赖**：**要求 project + cases + 可部署 repo，下游创建普通 runs**；Export 则消费已有 executions 的代码。
- **验证级别**：**双证**（未连接页面/菜单 + 文档）；未安装 App、未配置/触发事件、未导出。
- **来源**：[GitHub Integration](https://docs.testsprite.com/web-portal/integrations/github-integration.md)、[CLI CI/CD](https://docs.testsprite.com/cli/integrations/ci-cd.md)、[GitHub App & GitHub Actions](https://docs.testsprite.com/learn/tutorial-github-ci.md)、[现场 `/settings/github-action`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/settings/github-action)。

### 3.12 Members 与 Share

- **用途**：Workspace roster、邀请、角色、seat、ownership 和访问撤销；Share 是同一成员机制的项目的快捷入口。
- **主要页面/流程（现场）**：`/settings/team` 有按姓名/邮箱搜索、Filter、Invite Members，以及 Member/Role/Status 表格和 seat 使用量。项目 header 与 All Projects 行菜单均有 Share，header 另有 Copy link。
- **主要页面/流程（文档）**：角色为 Owner/Admin/Member/Viewer；Viewer 只读且免费，Member 及以上可创建/编辑/运行/删除项目和 tests。邀请按 email + role 生成可复制链接，不由 TestSprite 自动发邮件；链接绑定邮箱、7 天过期，可撤销/重发。支持角色调整、移除/离开和 ownership transfer。
- **Share 边界（文档）**：没有 per-project 权限；Share 会把受邀者加入整个 Workspace，再附项目链接。撤销也通过 Members。
- **核心依赖**：**访问控制层**，决定谁能执行核心操作和查看 reports/recordings；不是核心数据本身。
- **验证级别**：**双证**（roster/入口 + 文档）；未邀请、改角色或移除成员。
- **来源**：[Members & Roles](https://docs.testsprite.com/web-portal/admin/members-and-roles.md)、[Sharing a Project](https://docs.testsprite.com/web-portal/admin/sharing.md)、[现场 `/settings/team`](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/settings/team)。

### 3.13 Connections → Integrations / API Keys

- **Integrations 用途**：Workspace 级第三方授权，为 GitHub triggers、Slack、Jira/Linear 等提供连接。
- **Integrations（现场）**：`/settings/integrations` 可见 GitHub、Linear、Jira、Slack；Linear/Jira 有 Standard 标记。文档的 Workspace Settings 表还列 Figma，但现场未见，原因未知。
- **API Keys 用途**：让 CLI/MCP 以某成员身份在一个 Workspace 内工作；产出归属该 Workspace 并使用其余额。
- **API Keys（现场）**：`/settings/apikey` 有 New API Key，表格列为 Name、Owner、API Key、Last Used、Created At、Expires；样本为 No API keys yet，并有不要泄露 key 的警示。
- **API Keys（文档）**：创建时配置名称及不过期/30/90/365 天；完整 key 只在创建时显示一次；每 Workspace 两个 active keys；Member 管理自己的，Admin/Owner 可管理全部，revoke 立即生效。
- **核心依赖**：**连接/认证层**。Integrations 触发或外发生命周期事件；API Keys 认证 CLI/MCP 的项目、case、run 操作。二者自身不是项目数据集。
- **验证级别**：**双证**（静态卡片、空 key 表 + 文档）；未连接服务或创建/revoke key。
- **来源**：[Workspaces → Workspace Settings](https://docs.testsprite.com/web-portal/admin/workspaces.md#workspace-settings)、[API Keys](https://docs.testsprite.com/web-portal/admin/api-keys.md)、[现场 Integrations](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/settings/integrations)、[现场 API Keys](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/settings/apikey)。

### 3.14 Billing → Plan / Usage

- **用途**：Workspace 套餐、subscription/payment、credits、seat 费用、额外 credits 和 invoices。
- **Plan（现场）**：`/settings/billing` 有当前套餐说明、Monthly/Yearly、Free/Starter/Standard/Pro/Enterprise、Manage Subscription 和 Compare Plans。比较表把 Environments、Test Lists、Test schedules、Run history、Test file uploads、GitHub PR auto-test、Slack、Jira/Linear 等列为套餐能力/额度，说明辅助功能存在 plan gating。
- **Usage（现场）**：`/settings/usage` 有账期选择、Credits used 图、Usage This Cycle、Usage by Member、Extra Credits/Add Credits，以及 Date/Amount/Status/Details 的 Invoices 表。本文不复制账户额度、支付或发票细节。
- **权限与暂停（文档）**：Plan 仅 Owner；Usage 为 Admin/Owner。付费 Owner/Admin/Member seat 由 Owner 付费，Viewer 免费。订阅结束后若无法满足 Free 条件，Workspace 会 paused：全员只读、不能运行、credit balance 冻结。
- **核心依赖**：**资源与权限外壳**。runs 消耗 Workspace credits，套餐/seat/paused 状态决定核心操作能否执行。
- **验证级别**：**双证**（静态 Plan/Usage + 文档）；未切换套餐、付款或购买 credits。
- **来源**：[Workspaces](https://docs.testsprite.com/web-portal/admin/workspaces.md)、[Members & Roles](https://docs.testsprite.com/web-portal/admin/members-and-roles.md)、[Pricing](https://www.testsprite.com/pricing)、[现场 Plan](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/settings/billing)、[现场 Usage](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/settings/usage)。

### 3.15 Documentation

- **用途**：官方 Web Portal、CLI、MCP Server 和 Learn/tutorial 参考资料。
- **主要页面/流程（现场）**：全局 Documentation 是外链，指向 `https://docs.testsprite.com/mcp/getting-started/introduction`，不是应用内文档面板。Overview 的 View Docs 指向文档首页。
- **文档来源**：官方 `llms.txt` 提供可机器读取的完整页面索引，另有 Website、Community、Contact Us 链接；文档源码在官方 `TestSprite/Docs` repo。
- **核心依赖**：**无**。
- **验证级别**：**双证**（外链 + 官方文档索引）。
- **来源**：[Documentation](https://docs.testsprite.com/)、[llms.txt](https://docs.testsprite.com/llms.txt)、[TestSprite/Docs](https://github.com/TestSprite/Docs)。

## 4. 其他可见入口

| 入口 | 用途与主要页面/流程 | 与核心生命周期关系 | 验证级别与来源 |
| --- | --- | --- | --- |
| **Overview** | Workspace 欢迎页；Get Started、Recent Projects、My Test Lists、Recent Schedules、Recent Updates 摘要及 View All/创建快捷入口。 | 聚合核心与辅助数据，不另建实体。 | **现场**；[Workspace 根路径](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11)。 |
| **Get Started / Onboarding Checklist** | Workspace 四步：Create first project、Invite team、Try AI chat、Connect GitHub；项目内另有 Plan、Generate & run、Fix with AI、Re-run、Run on PR 清单。 | 跨模块导航和进度，不是独立业务实体。 | **现场**；[Get Started](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/get-started)。 |
| **All Projects** | 搜索/过滤/排序；All/Web Portal/CLI/MCP tabs；New Project；结果为 latest results。行菜单现场有 Open in New Tab、Manage Project、Share、Run All Tests、Export to GitHub、Delete Project。 | 核心 project 容器入口，也是 Export/Share/Run 的横向入口。 | **双证**；[现场](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects)、[Test Detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail.md)、[API Keys](https://docs.testsprite.com/web-portal/admin/api-keys.md)。 |
| **Chats / AI Chat / Open chat** | 现场打开 Chats 后有 Ask a question、Upload file、Select a Project、Send 和建议 prompts；未发送。文档称其为全 Portal copilot，可读项目/结果，也可提议创建、编辑、运行等动作，状态变更需用户批准。 | 横跨 project→cases→runs 和 Sources/Lists/Schedules 的另一操作面。 | **双证**（composer + 文档）；[AI Chat](https://docs.testsprite.com/web-portal/ai-chat/overview.md)、[Approving Actions](https://docs.testsprite.com/web-portal/ai-chat/approving-actions.md)。 |
| **Workspace switcher** | Switch Workspace、Create Workspace、Invite Members、Workspace Activity、Upgrade Workspace Plan。切换会替换项目、runs、schedules、settings 和当前角色语境。 | 所有核心数据的最上层归属边界。 | **双证**；[Workspaces](https://docs.testsprite.com/web-portal/admin/workspaces.md)。 |
| **Share / Copy link** | 项目 header 和行菜单入口；Share 创建 Workspace invitation，Copy link 只复制项目地址。 | 访问控制，不产生 cases/runs。 | **双证**；[Sharing a Project](https://docs.testsprite.com/web-portal/admin/sharing.md)。 |
| **Profile / account menu** | Profile 现场有 Full name、Company、Email、Set Password、Language，文案称自动保存；账户菜单另有 Appearance（Light）和 Log Out。 | 与核心生命周期无直接关系。 | **现场**；[Profile](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/settings)。 |
| **Recent Updates / Changelog** | Overview 的 Recent Updates 通过 View All 链到 `/changelog`，展示产品发布摘要。 | 无。 | **现场**；[Changelog](https://www.testsprite.com/changelog)。 |
| **Intercom Messenger** | 多个 Workspace 页面出现 Open Intercom Messenger；与 TestSprite AI Chat 是不同支持入口。未打开或发送消息。 | 无。 | **现场**。 |

## 5. 未知项与文档/现场差异

1. **Insights 正文未现场复验**：参考项目多次显示空正文；无法判断是数据、权限、加载失败还是版本条件，不能据此宣称模块不存在。
2. **General 保存语义不一致**：文档称 rename autosave，现场有 Save；实际提交时机未验证。
3. **Run Behavior 控件集合不一致**：文档有 Always use planned steps，现场未见；并发名称也不同。
4. **Environment 术语不一致**：现场/CLI 为 Default，Web Portal 文档为 Active；编辑和切换行为未验证。
5. **Test Files 完整流程未知**：现场证明有专门页面和表格，但上传格式/大小、处理状态、Purpose/Summary 来源、替换/删除及执行消费没有实测。
6. **Sources 明细未现场复验**：Add Source 的具体类型、Live Site Exploration 状态/页面列表和 Backend endpoint review 均只有文档证据。
7. **Figma 可见性未知**：文档列在 Integrations/AI Chat source 能力中，但参考 Workspace 的 Integrations 只看到 GitHub、Slack、Jira、Linear。
8. **Test Coverage 文档残留/条件入口未知**：[Test Detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail.md) 和 [Coverage Map](https://docs.testsprite.com/web-portal/core/working-with-test/coverage-map.md) 描述该入口，但当前参考项目导航未显示 Test Coverage；可能是项目状态/类型/版本条件，未证实。
9. **Workspace Activity 只有静态页面证据**：样本为空；官方文档只明确菜单入口，完整事件枚举、保留期和与 Project Activity 的字段契约未知。
10. **列表和调度历史未现场复验**：样本没有 Test Lists/Schedules，创建器、详情、历史、删除级联和自动暂停均为文档证据。
11. **外部连接后状态未验证**：GitHub、Slack、Jira、Linear 均保持未连接；授权字段、项目配置展开状态和真实外发行为未实测。
12. **样本边界**：只查看一个 Frontend 项目、一个 Owner 视角和当前套餐；Backend 专属页面、Viewer/Member/Admin 可见性、其他套餐门槛和 paused Workspace 未现场复验。
13. **Marketplace Action 可用性未作为事实基础**：官方旧文档/Marketplace 曾引用 `TestSprite/run-action@v1`，但 2026-11-04 `https://api.github.com/repos/TestSprite/run-action` 返回 404。当前可核验的一手 CI 路线是官方 CLI 文档，旧 Action 不应被假定为可用依赖。

## 6. 主要一手来源索引

- [官方文档索引](https://docs.testsprite.com/llms.txt)
- [Test Lists](https://docs.testsprite.com/web-portal/maintenance/test-lists.md) · [Test Schedules](https://docs.testsprite.com/web-portal/maintenance/monitoring.md)
- [Insights / Activity Log](https://docs.testsprite.com/web-portal/results/project-overview.md)
- [Test Detail / Project Settings](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail.md)
- [Environments](https://docs.testsprite.com/web-portal/setup/environments.md) · [Run Behavior](https://docs.testsprite.com/web-portal/setup/execution-settings.md) · [Sources / Test Files](https://docs.testsprite.com/web-portal/setup/project-sources.md)
- [GitHub Integration](https://docs.testsprite.com/web-portal/integrations/github-integration.md) · [CLI CI/CD](https://docs.testsprite.com/cli/integrations/ci-cd.md) · [CLI Lists & Schedules](https://docs.testsprite.com/cli/integrations/test-lists-and-schedules.md)
- [Slack Notifications](https://docs.testsprite.com/web-portal/integrations/slack-notifications.md) · [Ticketing](https://docs.testsprite.com/web-portal/integrations/ticketing.md)
- [Workspaces / Billing / Connections](https://docs.testsprite.com/web-portal/admin/workspaces.md) · [Members & Roles](https://docs.testsprite.com/web-portal/admin/members-and-roles.md) · [Sharing](https://docs.testsprite.com/web-portal/admin/sharing.md) · [API Keys](https://docs.testsprite.com/web-portal/admin/api-keys.md)
- [AI Chat](https://docs.testsprite.com/web-portal/ai-chat/overview.md) · [Approving Actions](https://docs.testsprite.com/web-portal/ai-chat/approving-actions.md)
