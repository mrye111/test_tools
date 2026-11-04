# TestSprite Test Cases 全量交互与用例详情流程调研

- 日期：2026-11-04
- 对应票据：[mrye111/test_tools#34](https://github.com/mrye111/test_tools/issues/34)
- 上级地图：[mrye111/test_tools#32](https://github.com/mrye111/test_tools/issues/32)
- 实测页面：[TestSprite Web Portal / Test Cases](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/test-cases)
- 实测对象：一个已有 37 条 UI 测试用例、1 次 Test Run 的项目；桌面视口约 1695 × 896。
- 调研边界：只读操作为主；仅打开并取消安全对话框。未保存任何编辑，未新增或删除数据，未启动任何测试执行。

## 证据口径

- **实测**：2026-11-04 在上述 Web Portal 页面直接观察到的 DOM、控件、URL、CSS 或行为。
- **文档**：TestSprite 官方文档中的说明，未在本次 UI 中完整走通的部分不会写成实测事实。
- **未知**：本次没有可靠证据，复刻前需要补测或作显式产品决策。

当前项目的数据和文档会变化；下文计数、排序结果和默认项均是这次样本的快照，不应误当成所有项目的固定数据。

## 结论摘要

1. Test Cases 不是普通平铺表格，而是**按 Use Case 分组的最新结果列表**。搜索、状态、优先级、分类、排序、选择、分页共同作用于这一组数据，但列表状态基本不写入 URL。
2. 分页以“完整分组”为边界。选择 25 Rows 时，37 条数据实际分成 19 + 18 条，而不是 25 + 12 条；表头全选会跨页选中当前结果集。
3. 用例详情先以右侧抽屉打开，URL 增加 `?case=<case UUID>`；Expand 后变成独立全页路由 `/test-cases/<case UUID>`。详情同时包含可编辑定义和最近一次运行证据。
4. 已运行用例详情有 Preview、Code、Run log、History 四个证据页签。Failed 与 Blocked 还显示 Error / Cause / Fix 和 Copy Fix Prompt；Passed 显示成功信息，不显示 Create bug ticket。
5. **Edit Test Plan 是全页批量编辑器，不是弹窗**，有 Form / YAML 两种模式；**Add More Tests** 分为 AI 生成与手工新增两个入口。
6. 列表顶部的 Run 按钮会按当前页签、搜索/筛选和选择改变文案与数量；真正执行前还有 Execution Env 菜单。批量删除和详情删除都存在，本次只检查到确认框并取消。
7. 官方文档与当前 UI 有命名差异：文档写 **Edit Test**，实测为 **Edit Test Plan**；文档状态列表包含 Queued，实测页签为 **Generated**，不能未经验证把二者等同。

---

## 1. 页面结构、字段与初始数据（实测）

### 1.1 页面层级

从外到内为：

1. 最左侧产品图标导航栏。
2. 项目侧栏：Setup、Workspace、Analytics、Activity、Project Settings 等；Test Cases 菜单项带总数 37。
3. 主内容顶栏：项目面包屑、Share、复制链接、Chats 等。
4. 标题区：`Test Cases`，说明为 `Every test in this project, grouped by use case, with its latest result.`。
5. 工具栏：Search Tests、筛选图标、Edit Test Plan、Add More Tests、上下文 Run 按钮。
6. 状态页签。
7. 粘性列头与按 Use Case 分组的用例行。
8. 底部批量操作区（有选择时出现）与分页区。
9. 右侧 Chats / AI 辅助面板；本次没有发送任何提示词。

### 1.2 列和行

| 区域 | 实测内容 |
|---|---|
| 选择列 | 行、分组、全局三级 checkbox |
| ID | 如 `CONT-001`、`TEMP-003`；可排序 |
| Latest Status | 状态徽章与相对时间，如 `Passed · 2w ago`；可排序 |
| Test Name | 用例标题；可排序；默认升序并显示向上箭头 |
| Priority | 条形图标加 High / Medium 文案；可排序 |
| 行内补充信息 | Failed / Blocked 行在标题下显示截断的失败或阻塞原因 |

分组头包含：分组 checkbox、折叠 chevron、Use Case 名称、用例数、状态比例条。比例条会随各状态数量变化；例如 Contacts & Organization 的 7 条中 6 Passed + 1 Blocked，对应约 85.7143% 绿色与 14.2857% 黄色。

### 1.3 本次数据快照

状态页签：

| 页签 | 数量 | 无选择时的主按钮 |
|---|---:|---|
| All | 37 | Run All 37 |
| Planned | 0 | Run 0 Planned，禁用 |
| Generated | 0 | Run 0 Generated，禁用 |
| Running | 0 | Run，禁用 |
| Passed | 29 | Re-Run 29 Passed |
| Failed | 5 | Re-Run 5 Failed |
| Blocked | 3 | Re-Run 3 Blocked |

分组：

| Use Case | 数量 |
|---|---:|
| Contacts & Organization | 7 |
| Questionnaire Templates | 7 |
| Platform Settings | 5 |
| Survey Management | 8 |
| Notifications Center | 10 |

官方文档也说明测试按 Use Case 分组，行展示标题、优先级、最新状态和最后运行时间；API 项目还会区分 Endpoint Tests / Integration Tests。本样本是 UI 项目，未观察 API 专属分组。来源：[Test detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail)。

---

## 2. 搜索（实测）

### 2.1 行为

- Search Tests 对标题进行**不区分大小写的子串匹配**：输入大写 `APPROVAL` 可找到标题含 `approval` 的 `NOTI-005`。
- 搜索后列表、页签计数和 Run 按钮同步变化。上述查询得到 All 1、Failed 1，按钮变为 `Run 1 Matching`。
- 清空搜索后恢复全部 37 条。
- 搜索不改变 URL。

### 2.2 不匹配范围与空态

分别用以下文本探测，均得到 0 条：

- 用例 ID：`cont-001`
- 分组名：`Notifications Center`
- 行内失败原因片段：`no valid Excel`

因此，本次证据支持“标题可搜，ID / 分组名 / 行内失败原因未命中”。样本量有限，不把它扩大为对所有后端搜索实现的绝对断言。

无结果时显示：

> No results match your search or filters.

同时隐藏分页。Planned、Generated、Running 等 0 条页签也使用同一空态文案。官方文档未找到搜索匹配字段或该空态的说明。

---

## 3. 状态页签与附加筛选（实测）

### 3.1 状态页签

- 点击页签立即过滤行并更新主 Run 按钮，不改变 URL。
- 0 条页签仍可选择，显示通用空态；对应 Run 按钮禁用。
- 搜索或分类筛选叠加后，按钮改为 `Run N Matching`，数量取当前匹配结果，而不是项目全量。
- 官方 UI 文档列出 Planned、Queued、Running、Passed / Failed / Blocked；本样本实测为 Planned、Generated、Running、Passed、Failed、Blocked。**Generated 是否等同文档中的 Queued 未验证。**来源：[UI Test Generation](https://docs.testsprite.com/web-portal/core/ui/ui-test-gen)。

### 3.2 工具栏筛选图标

筛选根菜单有：

- Priority
- Category

Priority 子菜单为单选样式；当前数据实际出现 High / Medium。Category 子菜单列出全部 5 个 Use Case。

组合筛选示例：Blocked + Category = Contacts & Organization 后，只剩 `CONT-003`；状态计数变为该分类下的 All 7、Passed 6、Blocked 1。这说明计数会按其他筛选条件重算，而不只是在当前页签内显示一个数量。

有筛选时出现 `Reset Filter`：

- 清除 Priority / Category。
- 保留当前状态页签。
- 不改变 URL。

官方文档未找到该筛选图标、菜单及 Reset Filter 的具体说明。

---

## 4. 排序（实测）

ID、Latest Status、Test Name、Priority 四个列头均可点击，再次点击切换升 / 降序。排序会同时影响：

- 分组内行顺序。
- 分组本身的顺序。

在当前数据集上观察到：

| 排序字段 | 正向观察 | 反向观察 |
|---|---|---|
| ID | Contacts → Notifications → Platform → Survey → Questionnaire；组内 ID 升序 | 分组与行顺序均反转 |
| Latest Status | Failed → Blocked → Passed | Passed → Blocked → Failed |
| Test Name | 恢复默认标题升序；显示向上箭头 | 标题降序 |
| Priority | Medium → High | High → Medium |

Status / Priority 相同值的行，在本次样本中按 ID 升序排列。上述是观察到的结果顺序；没有足够不同数据证明它是全局固定枚举顺序或完整的 tie-breaker 契约。

所有排序均不改变 URL。官方文档未找到这些排序规则。

---

## 5. 分组折叠与动画（实测）

- 点击分组头 chevron 折叠或展开该组，分组名称、数量和状态比例条仍保留。
- 分组头通过 `aria-expanded` 暴露状态。
- 内容容器在 `grid-rows-[1fr]` 与 `grid-rows-[0fr]` 间切换。
- CSS 为 `transition-[grid-template-rows] duration-200 ease-out`，即约 200 ms 的行高网格过渡。
- chevron 使用 `-rotate-90` 和约 200 ms 的 transform 过渡。
- 折叠不改变 URL，也不改变分组计数。

未验证 collapsed 状态是否持久化到刷新或跨会话。

---

## 6. 单选、多选、组选与全选（实测）

### 6.1 选择反馈

选中一行后：

- 行出现选中底色，checkbox 为 checked。
- 顶部主按钮变成 `Run 1 Selected`。
- 底部出现批量操作区：`1 selected`、Clear、Delete、Add to Test List、Run 1 Selected。
- 多选时数量同步增加。
- Clear 清除全部选择并恢复上下文 Run 按钮。

组选择：

- 分组 checkbox 一次选中该组所有行。
- 组内只选部分行时，组 checkbox 进入 indeterminate。
- 本次部分选择时，全局表头 checkbox 仍为 unchecked，未呈现 indeterminate。

### 6.2 跨页全选

- 50 Rows 下点击表头全选，37 条全部选中。
- 25 Rows 下全选后，顶部显示 `Run 37 Selected`；翻到第 2 页，选择保留，第二页行也呈选中状态。
- 因此在本次未筛选数据集上，**表头全选作用于全部 37 条结果，而非当前页的 19 条**。
- 搜索/筛选后再全选的边界未单独测试，不应把“跨页”进一步扩写为未经验证的跨筛选语义。

所有选择操作均不改变 URL。官方文档只概述选中行后可 Run、Delete、Add to Test List，未描述上述 indeterminate 和跨页行为。来源：[Test detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail)。

### 6.3 Add to Test List 安全下游

选择 1 条后点击 Add to Test List，打开同 URL 上的对话框：

- 标题：Add to Test List。
- 搜索框 placeholder：`Search test lists...`。
- 当前没有既有 Test List，列表区只有 `New Test List`。
- 底部 Add 初始禁用。
- 点击 New Test List 后出现 `Test List Name` 输入框及 Cancel / Save；未输入名称，未保存。
- 取消后回到列表，再 Clear 选择。

---

## 7. 分页与 Page Size（实测）

底部提供：

- Page size：25 Rows、50 Rows、100 Rows。
- Previous / Next，通过 `aria-disabled` 表示不可用状态。
- 当前页码。

25 Rows 时：

| 页 | 分组 | 实际行数 |
|---|---|---:|
| 1 | Contacts & Organization、Questionnaire Templates、Platform Settings | 19 |
| 2 | Survey Management、Notifications Center | 18 |

这不是 25 + 12，因为分组不会被拆到两页：第一页若再加入 8 条 Survey Management 会达到 27，于是整组移到下一页。**Page Size 是分页容量上限，实际页大小还受完整分组边界约束。**

页码、Page Size、Previous / Next 均不改变 URL。0 条结果时分页隐藏。本次最后恢复 50 Rows 并清除选择。

---

## 8. Run / Re-run 与 Delete 控件（实测 + 文档）

### 8.1 实际存在的 Run 控件

1. **列表顶部上下文按钮**：文案随状态、筛选、选择变化，见 §1.3、§2、§6。
2. **执行菜单**：以 Blocked 页签为例，点击 `Re-Run 3 Blocked` 后打开菜单，显示 `Execution Env: default` 和 `Re-Run 3 Blocked`。未点击菜单中的执行项。
3. **批量操作区**：选择后显示 `Run N Selected`。
4. **详情头部**：Failed、Blocked、Passed 三个已运行样本均有 `Run Test`。

检查执行菜单前后 Running 仍为 0、Test Runs 仍为 1；没有启动执行。Running 状态转移、队列、并发和完成后的刷新机制均未实测。

官方文档还描述详情 Run test / Save & Run 和工具栏 Run all。本次三个样本的稳定详情头部均显示 Run Test；Save & Run 的出现条件未验证。来源：[UI Re-run](https://docs.testsprite.com/web-portal/core/ui/ui-rerun)。

API 项目另有依赖重跑和 Auto Cleanup 文档，但本样本是 UI 项目，未实测：[API Re-run](https://docs.testsprite.com/web-portal/core/api/api-rerun)。

### 8.2 实际存在的 Delete 控件

1. 列表选择后的批量 Delete。
2. 用例详情 More actions 菜单中的 Delete；同一菜单还有 Add to Test List。

详情 Delete 的确认框明确提示：

> “Create a questionnaire template” and its run history will be permanently deleted. This can't be undone.

按钮为 Cancel / Delete。本次点击 Cancel，没有删除。官方文档同样说明删除会永久移除用例及其运行历史：[Managing Test Cases](https://docs.testsprite.com/web-portal/core/working-with-test/managing-test-cases)。

---

## 9. 用例详情抽屉与全页（实测）

### 9.1 打开、关闭与 Expand

点击行打开右侧详情抽屉：

- URL 从 `/test-cases` 变为 `/test-cases?case=<case UUID>`。
- 抽屉从右侧滑入，CSS 为约 260 ms 的 translate 过渡。
- 头部包含 ID、Use Case、Share、Copy link to this page、Expand、Close。
- Close 收起抽屉；完成过渡后 URL 恢复为 `/test-cases`。
- Expand 后导航到 `/test-cases/<case UUID>`，列表被全页详情替代，面包屑增加该 case UUID。

官方文档同样描述“行点击打开抽屉，抽屉可展开为全页”：[Managing Test Cases](https://docs.testsprite.com/web-portal/core/working-with-test/managing-test-cases)。

### 9.2 左侧：定义与编辑区

实测 Failed、Passed、Blocked 三个样本均有：

- 用例标题与当前状态。
- Basics 折叠区。
- Priority 控件。
- `Test Plan(n)`。
- Test Description (Goal)。
- Steps：每步可在 action / assertion 间切换，可删除，可在当前步骤后或末尾 Add Step。
- Run Settings：Step Timeout、Viewport。
- 本样本 Viewport 显示 `Inherit from project (1920 × 1080)`。

Failed / Blocked 头部另有 Create bug ticket；Passed 样本没有该按钮。三个样本均有 Run Test 和 More actions。

本次没有修改任何字段或步骤。

### 9.3 右侧：证据页签

四个主页面签：

| 页签 | 实测内容 |
|---|---|
| Preview | 自动推进的画面回放；上一步、播放/暂停、下一步、倍速、Replay、Screen Recording、View Run Log；显示当前步骤序号和进度 |
| Code | 生成的异步 Playwright Python 代码，带行号和 minimap；以截图确认可见内容，未从 Monaco textarea 的 value 推断代码 |
| Run log(n) | action / assertion 步骤日志、展开查看更多，以及 J / K 键盘提示 |
| History(n) | Status、Env、Test Run、Date 列；样本为 Failed / default / Latest / 时间戳等历史行 |

运行日志可能包含已填入的敏感值；本文不复制这些值。

### 9.4 状态差异

**Passed 样本 `CONT-001`：**

- Test Plan(3)、Run log(7)、History(1)。
- Preview 最终显示 `Test successful. No errors detected.`。
- 无 Create bug ticket，无 Error / Cause / Fix 区。

**Failed 样本 `TEMP-003`：**

- Test Plan(7)、Run log(9)、History(1)。
- Create bug ticket、Run Test、More actions。
- 失败分析区有 Error / Cause / Fix 页签和 Copy Fix Prompt。

**Blocked 样本 `NOTI-008`：**

- Test Plan(3)、Run log(7)、History(1)。
- 同样有 Create bug ticket 和 Error / Cause / Fix。
- Error 内容以 `TEST BLOCKED` 标识，并包含观察到的阻塞原因和 OBSERVATIONS。

API 文档说明 Failed 详情会展示错误和失败断言，Blocked 依赖链可展示缺失变量 trace；这些是 API 场景的文档说明，不替代以上 UI 项目实测。来源：[Endpoint Tests](https://docs.testsprite.com/web-portal/core/api/endpoint-tests)、[Dependency Chains](https://docs.testsprite.com/web-portal/core/api/dependency-chains)。

---

## 10. Edit Test Plan（实测 + 文档）

### 10.1 入口和页面形态

点击 Edit Test Plan 后进入全页编辑器，URL 增加 `?edit=plan`，不是 modal。

页面说明：

> Add use cases and tests, or change any test’s priority, title, goal and steps. Nothing is saved until you press Save Changes.

顶部控件：

- Form / YAML 模式切换。
- `No changes yet` 状态。
- Done。
- Save Changes，初始禁用。

### 10.2 Form 模式

- 按计划顺序显示 Use Case 组，每组内按 ID 顺序显示用例。
- 行包含 ID、Priority、标题和步骤数。
- 每组有 Add Test 和组级 ellipsis 菜单。
- 底部有 Add Use Case。
- Chats / AI 辅助面板仍可见；本次没有发送提示词。

### 10.3 YAML 模式

可见帮助说明涵盖：

- 修改 name、description、priority、steps。
- 新增用例时省略 `id` 或使用新 ID。
- 把用例移动到其他 Use Case。
- 新增 `useCase` 块，`slug` 可选。
- 从文件中移除用例或 Use Case 即表示删除。
- 普通步骤行是 action；`assert:` 行检查预期结果。
- Save 后应用更改。

可见结构字段包括：`useCases`、`useCase`、`slug`、`testCases`、`id`、`priority`、`name`、`description`、`steps`。

本次只做了无修改的 YAML → Form 切换，并用 Done 返回；没有保存。官方文档称该批量编辑器为 **Edit Test**，并说明：

- Form / YAML 两种模式。
- 保存写回变更行，并报告逐条失败。
- 有未保存修改时切换模式，会先警告丢弃修改。

这些保存结果和未保存警告本次未实测。来源：[Managing Test Cases](https://docs.testsprite.com/web-portal/core/working-with-test/managing-test-cases)。

---

## 11. Add More Tests（实测 + 文档）

Add More Tests 下拉菜单有两个入口：

1. Add Tests with AI
2. Add Test Manually

两个入口均在不改变列表 URL 的情况下打开对话框。

### 11.1 Add Test Manually（实测）

对话框标题为 Add Test Case，字段和初始状态：

| 字段/控件 | 实测 |
|---|---|
| Use Case | 本次默认 Survey Management；下拉列出 5 个现有分组和 Add Use Case |
| Title | placeholder：`e.g. User can sign in with valid credentials` |
| Priority | 默认 Medium；可选 High / Medium / Low |
| Description | placeholder：`What does this test verify?` |
| Steps | 初始 `No steps yet.`，有 Add Step |
| 底部 | Cancel；Add Test Case 初始禁用 |

默认值是本次会话观察，不证明所有项目都默认 Survey Management。未填写、未新增步骤、未提交，最后 Cancel。

官方文档给出的优先级集合也是 High / Medium / Low；计划生成文档说明默认 Medium，高优先级更早执行：[Managing Test Cases](https://docs.testsprite.com/web-portal/core/working-with-test/managing-test-cases)、[UI Plan Generation](https://docs.testsprite.com/web-portal/core/ui/ui-plan-gen)。

### 11.2 Add Tests with AI（实测初始界面）

对话框标题为 Generate Tests：

- 提示：`Add sources in the Sources panel or project settings to improve test generation quality.`
- Use Case 默认 All use cases。
- 下拉包含 Add Use Case、All use cases，以及 5 个现有 Use Case 和各自测试数。
- Instructions 标为 Optional。
- textarea placeholder：`e.g. Focus on the checkout flow, generate edge case tests for payment processing, include mobile responsive tests...`。
- 底部 Cancel / Generate；本次初始 Generate 可用。
- 有 Add missing scenarios 的帮助提示，说明可在当前流程添加自定义 Use Case，并加入本批生成。

未点击 Generate，未创建 Use Case，最后 Cancel。

官方文档进一步描述：AI 提案在正式创建前可编辑、取消选择、补充。由于本次没有进入生成和提案评审阶段，这些仅为**文档事实，不是本次实测行为**。来源：[Managing Test Cases](https://docs.testsprite.com/web-portal/core/working-with-test/managing-test-cases)。

---

## 12. URL 与状态持久化矩阵（实测）

| 操作 | URL 结果 |
|---|---|
| 搜索 | 不变 |
| 状态页签 | 不变 |
| Priority / Category 筛选、Reset Filter | 不变 |
| 四列排序 | 不变 |
| 分组折叠 | 不变 |
| 选择、Clear | 不变 |
| 页码、Page Size | 不变 |
| Add More Tests / Add to Test List 对话框 | 不变 |
| 打开详情抽屉 | 增加 `?case=<case UUID>` |
| 关闭详情抽屉 | 过渡完成后恢复 `/test-cases` |
| Expand 详情 | 改为 `/test-cases/<case UUID>` |
| Edit Test Plan | 增加 `?edit=plan` |
| Done 退出编辑器 | 返回 Test Cases 列表 |

除详情和编辑器外，本次没有证据表明列表交互可通过 URL 分享或刷新恢复；但“刷新后一定丢失”未逐项测试。

---

## 13. 空、加载、错误与动画（实测）

### 13.1 列表空态

- 搜索/筛选无匹配和 0 条状态页签：`No results match your search or filters.`
- 此时分页隐藏。
- 尚未观察到真正的“项目无任何用例”专属空态。

### 13.2 详情加载

详情并非一次性同步完成：

- 初期可见 skeleton。
- Failed 样本加载早期曾短暂显示 `This test hasn’t been run yet`，随后才出现已有 Preview、Run log、History 和失败分析。**该短暂文案不能当作最终空态。**
- Blocked 样本 Preview 中也观察到 `Loading…` / `Loading the run…`。

复刻时应把“定义加载”“运行证据加载”“从未运行”区分为不同状态，避免用单一空态造成闪烁误报。

### 13.3 错误呈现

- 列表行：Failed / Blocked 在标题下显示内联原因。
- 详情：Failed / Blocked 用 Error / Cause / Fix 表达失败分析和修复建议。
- 列表整体请求失败、加载失败、重试按钮等真正错误态未观察到。

### 13.4 动画

| 区域 | 实测动画 |
|---|---|
| 分组折叠 | grid-template-rows，200 ms，ease-out |
| 分组 chevron | rotate / transform，约 200 ms |
| 详情抽屉 | translate，约 260 ms |
| 普通对话框 | open/close 时使用 fade + zoom，约 200 ms |
| Preview | 运行证据自动推进，可暂停、切步和改倍速 |

未系统测试 `prefers-reduced-motion`、移动端或键盘完整操作。

---

## 14. 复刻时需要特别保留的行为契约

以下是直接从实测得到、最容易在“看起来相同”的复刻中遗漏的点：

1. 列表以 Use Case 分组，排序会重排分组，不只是组内行。
2. 状态计数会被搜索/分类等条件重算；Run 按钮文案是结果集的函数。
3. Page Size 不拆分组；全选跨页。
4. 组部分选择有 indeterminate，而本样本的全局表头没有同步 indeterminate。
5. 详情抽屉与全页详情是两种路由形态；列表筛选状态则不走 URL。
6. 详情定义可直接编辑，证据区同时承载回放、代码、日志、历史；失败/阻塞另有 AI 分析。
7. Edit Test Plan 是全页 Form / YAML 双模式编辑器，Add More Tests 是 AI / 手工两个独立入口。
8. 删除确认明确包含 run history 永久删除。
9. 详情加载中的临时“未运行”文案不能替代真实 never-run 状态。

---

## 15. 未知与未验证项

### 列表与选择

- 列表整体 loading、网络/服务错误、重试和离线行为。
- 项目完全无用例时的首次空态与 CTA。
- 搜索是否还有未命中的其他字段；大小写和子串规则仅在当前样本上验证。
- Generated 与官方文档 Queued 的确切状态映射。
- Low 优先级在列表行中的实际视觉；当前行数据只有 High / Medium，Low 只在手工新增和文档中确认。
- 折叠、排序、页码、Page Size、筛选是否跨刷新或跨会话持久化。
- 筛选结果下全选、删除、跨页选择的全部组合边界。
- 状态比例条 hover tooltip；本次只读取了可见条和 DOM 比例。

### 详情与执行

- 从未运行用例的最终详情，而非加载中的瞬态。
- Run Test、Run Selected、Run Matching、Run All、Re-Run 的真实执行转移、环境选择、队列、取消和完成刷新。
- Save & Run 的出现条件及其与 Run Test 的关系。
- Screen Recording 的下游播放/下载细节。
- Create bug ticket 的下游集成流程。
- Share、Copy link 的权限和外部访问行为。
- History 多运行记录、Test Run 链接和不同 Env 的变化。
- 移动端、窄视口、完整键盘路径、焦点管理和 reduced-motion。

### 编辑、新增和删除

- Form / YAML 的真实校验、保存成功、逐条失败、未保存切换警告和 Done 丢弃确认。
- YAML 中删除/移动/新增 Use Case 的实际服务端结果。
- AI Generate 后的提案、编辑、取消选择、补充、失败重试与正式创建。
- 手工新增必填规则、步骤编辑、Add Use Case 和保存结果。
- New Test List 的名称校验、保存和 Add 到既有列表的结果。
- 批量 Delete 的确认框与部分失败行为；详情 Delete 仅检查并取消确认框。

---

## 16. 主要来源

### 实测入口

- [Test Cases 当前项目页面](https://www.testsprite.com/dashboard-v3/o/09b05527-d123-5b52-be15-6d804d1abf11/projects/ded928e9-6087-4b71-a8fe-ea5c93cc8cba/test-cases) — 本文所有“实测”标记的来源；涉及的具体 case UUID 已在正文流程中说明。

### TestSprite 官方文档

- [Test detail](https://docs.testsprite.com/web-portal/core/working-with-test/test-detail) — 分组、行字段、详情和选择操作概览。
- [Managing Test Cases](https://docs.testsprite.com/web-portal/core/working-with-test/managing-test-cases) — 抽屉/全页、Edit Test、Form/YAML、AI/手工新增、删除和优先级。
- [UI Test Generation](https://docs.testsprite.com/web-portal/core/ui/ui-test-gen) — 文档中的 Planned、Queued、Running、Passed/Failed/Blocked 状态。
- [UI Re-run](https://docs.testsprite.com/web-portal/core/ui/ui-rerun) — Run test、Save & Run、Run all。
- [UI Plan Generation](https://docs.testsprite.com/web-portal/core/ui/ui-plan-gen) — 默认 Medium 和优先级执行顺序。
- [API Plan Generation](https://docs.testsprite.com/web-portal/core/api/api-plan-gen) — API 计划的优先级执行顺序。
- [API Re-run](https://docs.testsprite.com/web-portal/core/api/api-rerun) — API 依赖重跑与 Auto Cleanup；未在本 UI 项目实测。
- [Endpoint Tests](https://docs.testsprite.com/web-portal/core/api/endpoint-tests) — API 失败详情中的错误和失败断言。
- [Dependency Chains](https://docs.testsprite.com/web-portal/core/api/dependency-chains) — API Blocked 的缺失变量 trace。
