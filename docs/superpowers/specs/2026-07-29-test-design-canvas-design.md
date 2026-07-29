# 测试设计画布 — 分析画板工作台化设计文档

> 日期：2026-07-29
> 状态：已确认（用户逐节审阅通过）
> 前置：ADR 0005（分析画板取代结果页）、ADR 0006（画板独立路由）
> 参考：boardmix 在线白板编辑器（《图表画布功能需求文档》调研）

---

## 1. 背景与目标

分析画板（`/requirement-analysis/board/:id`）当前是只读的需求分解树阅览视图。本设计将其进化为**测试设计工作台**：以需求分解树为工作起点，在自由白板上通过 AI 全自动生成测试用例设计方法图表——**因果图、判定表、正交表**（黑盒三件套），并以确定性算法将图表转换为用例骨架，接力到用例生成工具。

### 与 boardmix 的关系

参考其画布形态与交互范式，但本质不同：boardmix 是自由创作白板（图元是装饰性内容），本画布是**有形式化语义的分析模型**——每种图表有明确的结构语义，可机械地转换为测试用例。

### 明确不做（对齐测试工具定位）

- 多人协作 / 权限 / 分享 / 商业化 / AI 点数
- 第三方集成（Jira、墨刀等）
- 画笔、便签、看板、容器等通用白板元素
- 连线吸附对齐线、格式刷、锁定、图元旋转、右键菜单（一期走浮动工具条）、图钉演示、小地图

---

## 2. 已确认的关键决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 方向 | 画板进化为"测试设计工作台"（不新增独立工具） |
| 2 | 建模方式 | 全自动：AI 直接产出图表草稿，用户修改 |
| 3 | 图表集 | 因果图 + 判定表 + 正交表（黑盒三件套）；状态迁移图放二期 |
| 4 | 画布形态 | 自由白板（无限画布、图元自由摆放），非页签/分区 |
| 5 | 渲染技术栈 | Canvas 2D 全量渲染（含表格型图元），DOM overlay 仅用于文本编辑态 |
| 6 | AI 生成上下文 | 基于需求树上**选中的节点**生成；未选中则插入按钮禁用 |
| 7 | 用例骨架去向 | 首期走接力：骨架序列化为文本，经 REQUIREMENT_HANDOFF_KEY 进入现有 AI 用例生成管线 |
| 8 | 持久化 | 白板内容（图元数据 + 布局）持久化到分析记录，自动保存防抖 1.5s |

### Canvas 路线的成本确认（用户已知情拍板）

Canvas 下命中检测、文本编辑、选中态需全部自研（约占白板工作量 50-60%），且 jsdom 覆盖不了渲染层（渲染人工验收，模型层单测）。收益是后续自由绘图扩展性。判定表/正交表同样用 Canvas 绘制，不做 DOM 混合渲染。

---

## 3. 总体架构

```
┌─ AnalysisBoardPage（路由/数据层，基本沿用）────────────────┐
│  拉取记录 → result + board（新增字段）→ 渲染 AnalysisBoard │
│  自动保存：board 变更防抖 1.5s → PATCH /records/:id        │
└────────────────────────────┬───────────────────────────────┘
                             │
┌─ AnalysisBoard（纯净画布壳，沿用）─────────────────────────┐
│  左上胶囊（返回/记录名/导出菜单） / 右上生成用例            │
│  左侧工具栏（选择·手型/插入三件套/插入模板）/ 右下缩放条    │
└────────────────────────────┬───────────────────────────────┘
                             │
┌─ board/ 画布引擎（新增目录，位于 features/requirement-analysis/board/）┐
│  viewport.ts      视口状态 {x,y,zoom} + 世界↔屏幕坐标换算 + DPR      │
│  renderer.ts      Canvas 渲染循环（按需重绘，非 RAF 轮询）            │
│  hit-test.ts      命中检测（z 序包围盒 + 边距离判定）                 │
│  board-store.ts   白板模型（元素树 + 会话选中态）+ 命令栈             │
│  commands.ts      移动/改文本/加删元素/改连线，撤销重做               │
│  elements/        图元渲染与行为：                                    │
│    mindmap-ref.ts   需求树参考图（只读，Canvas 重绘，节点可选中）     │
│    cause-effect.ts  因果图（节点 + 约束边）                           │
│    decision-table.ts 判定表（网格 + 单元格）                          │
│    orthogonal.ts    正交表（网格）                                    │
├─ board/ai.ts      AI 生成契约（请求/解析/schema 校验）                │
├─ board/derive.ts  确定性推导（因果图→判定表、正交阵列、图表→用例骨架）│
└─ board/persistence.ts  board JSON 序列化/反序列化/版本迁移            │
```

### 关键架构决策

1. **模型与渲染分离**：白板模型是纯数据（TS 对象），渲染器只读模型画 Canvas；所有修改走命令，命令改模型 → 标脏 → 下一帧重绘。撤销/重做、持久化、单测都因此简单。
2. **DOM overlay 只用于文本编辑态**：双击图元浮 `<input>`/`contenteditable`，提交写回模型；平时画布上零 DOM。浮动工具条、Tooltip、缩放条仍是 DOM（不属于画布层）。
3. **需求树参考图**作为白板上的一个**只读图元**，Canvas 重绘静态布局；不做交互编辑，只做**节点选中**（选中 = AI 生成上下文）。
4. **按需重绘**：模型变更/视口变更才触发重绘，不用 requestAnimationFrame 轮询。

---

## 4. 图元模型

所有图元共享基础接口；持久化 = 整个 `Board` 的 JSON（存分析记录新增的 `board` 字段）。

```ts
type BoardElement =
  | MindmapRefElement      // 需求树参考图（只读，可选中节点）
  | CauseEffectElement     // 因果图
  | DecisionTableElement   // 判定表
  | OrthogonalElement      // 正交表

interface ElementBase {
  id: string
  kind: 'mindmap-ref' | 'cause-effect' | 'decision-table' | 'orthogonal'
  x: number            // 画布世界坐标
  y: number
  w: number            // 包围盒（因果图由内容推导，表格由行列推导）
  h: number
  /** 溯源：该图元从哪个需求节点生成；null = 用户白手建的 */
  sourceNodeId: string | null
}

interface Board {
  version: 1                 // 持久化版本号
  elements: BoardElement[]
  // 视口不持久化：打开时自动 fit 需求树
}

interface MindmapRefElement extends ElementBase {
  kind: 'mindmap-ref'
  selectedNodeId: string | null     // 单选，驱动插入按钮可用性
}

interface CauseEffectElement extends ElementBase {
  kind: 'cause-effect'
  nodes: Array<{
    id: string; role: 'cause' | 'intermediate' | 'effect'
    text: string; x: number; y: number   // 相对图元原点的局部坐标
  }>
  edges: Array<{
    id: string; from: string; to: string
    constraint: 'and' | 'or' | 'not' | 'identity'
  }>
}

interface DecisionTableElement extends ElementBase {
  kind: 'decision-table'
  conditions: string[]                // 条件桩
  actions: string[]                   // 动作桩
  rules: Array<{
    conditionValues: Array<'Y' | 'N' | '-'>   // '-' = 无关项
    actionValues: boolean[]
  }>
}

interface OrthogonalElement extends ElementBase {
  kind: 'orthogonal'
  factors: Array<{ name: string; levels: string[] }>
  arrayName: string                   // 如 'L9(3^4)'
  rows: string[][]                    // 阵列本体（算法产出；允许用户删行）
}
```

### 设计要点

1. **双层坐标**：图元有世界坐标（白板拖动用）；因果图内部节点有相对图元原点的局部坐标——整图拖动时内部结构不动，编辑节点只改局部坐标。
2. **表格内容决定尺寸**：判定表/正交表的 `w/h` 由行列数推导，用户不直接拖尺寸；改内容自动重算。
3. **`sourceNodeId` 溯源锚点**：每个图元记住从哪个需求节点生成，是后续"覆盖率追溯"的基础。
4. **选中态不持久化**：`selectedNodeId`、画布选中集、文本编辑态均为会话态。
5. **正交表 rows 冗余存储**：算法确定，但存 rows 使打开即渲染，且允许用户删行。

---

## 5. 数据流

### 5.1 AI 生成图表草稿

```
用户在需求树图元上选中节点
  → 左侧工具栏插入按钮变为可用（未选中节点时禁用，
    Tooltip 提示"先在需求树中选择一个节点"）
  → 点击插入 → 画布中央出现"生成中"占位图元（骨架屏）
  → POST /api/requirement-analysis/records/:id/board/generate
      { nodeId, chartKind: 'cause-effect' | 'decision-table' | 'orthogonal' }
  → 后端取该记录需求全文 + 定位节点子树文本，
    按 chartKind 的 prompt 契约调 AI，要求输出严格 JSON
  → 前端解析 JSON → schema 校验 → 落到图元模型 → 替换占位图元
  → AI 输出不合规：后端自动修复重试一次；仍失败 → 占位图元变为
    错误卡片（可删除、可重试），不污染画布
```

- AI 生成走服务端（需要记录上下文；prompt 契约版本化在服务端）；一次性 JSON 响应，不用 SSE。
- 生成接口沿用现有鉴权与模型配置（用户本地统一供应商，后端不存 key）。

### 5.2 确定性推导（`derive.ts` 纯函数，零 AI）

- **因果图 → 判定表**：对每条结果节点回溯原因链，枚举约束组合（与/或/非展开），生成条件桩 + 规则列，动作桩 = 结果。产物作为新图元落在源图右侧，自动连一条虚线（视觉溯源）。
- **正交表生成**：用户编辑因子/水平后点"重新生成"→ 查表选型（L4/L8/L9/L16/L18）→ 算法产出阵列 → 替换 rows。
- **图表 → 用例骨架**：
  - 判定表：每列规则 → `{ 前置条件: Y/N 条件组合, 步骤: 触发条件, 预期: 动作组合 }`
  - 正交表：每行 → `{ 前置条件: 因子水平组合, 步骤: 按组合构造输入, 预期: 行为符合对应规则 }`
  - 因果图：不直接产出，须经判定表。

### 5.3 用例接力（复用现有管线）

```
右上"生成测试用例"按钮
  → 收集白板上所有判定表 + 正交表的用例骨架
  → 骨架序列化为结构化文本（Markdown 表格），与需求原文一起写入
    localStorage REQUIREMENT_HANDOFF_KEY
  → navigate('/testcase')，新建用例弹窗预填：
    需求描述 = 需求原文摘要 + 「以下用例骨架由测试设计画布产出，
    请据此补全为标准用例」+ 骨架文本
  → 后续走现有 AI 生成管线（覆盖模式/质量校验/8 列格式全部复用）
```

- 白板为空时退化为现状（只接力需求原文）；有骨架时升级为"原文 + 骨架"。

---

## 6. 交互与编辑

### 6.1 视口操作

| 操作 | 交互 |
|---|---|
| 平移 | 空格按住拖 / 鼠标中键拖 / 手型工具（V 切换选择↔手型） |
| 缩放 | Ctrl/⌘ + 滚轮（指针锚点）；右下缩放条沿用（±20% 步进、百分比点击重置、适应屏幕） |
| 适应屏幕 | 对全部图元包围盒 fit；首次打开自动 fit 需求树 |

### 6.2 选中与拖拽

- **点选**：按图元 z 序（数组倒序）遍历；因果图先测节点，再测边（点到线段距离 ≤ 4px），最后测图元背景区。
- **框选**：选择工具下空白处拖出选框，与选框相交的图元进选中集（整图元粒度）。
- **拖拽**：选中集整体拖动；因果图内部节点可单独拖动。
- **多选**：Shift + 点选；Ctrl+A 全选。
- **删除**：Del/Backspace 删选中集；判定表规则列/正交表行选中后也可删。

### 6.3 文本编辑（DOM overlay）

- **双击**可编辑部位（因果图节点文字、判定表/正交表单元格、因子名/水平名）→ 在该部位屏幕坐标处浮 `<input>`（单行）或 `contenteditable`（多行）。
- **Enter/blur 提交**（走命令，进撤销栈），**Esc 取消**。
- overlay 位置随视口实时换算。

### 6.4 浮动工具条（DOM overlay，选中即现）

跟随选中集包围盒上沿，按类型动态装配：

| 选中 | 工具条内容 |
|---|---|
| 因果图 | 添加节点（因/果/中间态）、添加约束边（∧∨¬）、推导判定表、重新生成、删除 |
| 判定表 | 添加条件/动作/规则列、合并等价规则、转用例骨架预览、删除 |
| 正交表 | 编辑因子水平、重新生成阵列、转用例骨架预览、删除 |
| 任意图元 | 置顶/置底、复制（Ctrl+C/V 图元级）、删除 |

### 6.5 撤销/重做

- 所有模型修改走命令 `{ label, do(model), undo(model) }`；栈上限 100 条。
- Ctrl+Z / Ctrl+Shift+Z（或 Ctrl+Y）；右下缩放条旁撤销/重做图标按钮，空栈置灰。
- 命令执行后照常防抖保存；撤销/重做是对模型的再修改，同样触发保存。
- AI 生成插入图元也是一条命令（可撤销插入）。

### 6.6 左侧工具栏（最终形态）

自上而下：选择/手型（V）、插入因果图、插入判定表、插入正交表、插入模板（沿用骨架，二期再接真模板）、收缩/展开。插入类按钮在未选中需求节点时禁用。

---

## 7. 错误处理与边界

### AI 生成失败链

1. AI 输出非法 JSON / schema 校验失败 → 服务端自动修复重试一次。
2. 仍失败 → 占位图元变为**错误卡片**（红色边框 + 文案 + 重试/删除按钮），画布其余内容不受影响。
3. 网络/超时（前端 60s）→ 同上，文案区分"生成失败"与"网络异常"。

### 推导失败链（可预期业务情形）

- 因果图无结果节点 / 原因链成环 → 不产出判定表，Toast 提示具体原因。
- 因子数 > 4 或总水平数超出 L18 覆盖范围 → Toast 提示，不修改现有阵列。

### 持久化失败链

- 自动保存失败 → 顶部横幅错误条"白板保存失败，将继续重试"；下一次变更或 10s 后重试。
- **版本冲突不做**：多标签同时编辑时后写覆盖先写（与现有 chartType 回写语义一致，明确接受）。
- 打开记录时 `board` 字段缺失（旧记录）→ 视为空白板；`version` 不符 → 迁移函数（一期只有 v1，留空壳）。

### 边界与限制（写死在代码里）

- 单记录白板图元上限 **50 个**（超出禁用插入按钮并提示）。
- 因果图节点 ≤ 60、判定表规则列 ≤ 64、正交表 ≤ 4 因子 × 总水平 ≤ 18——AI 草稿阶段截断并 banner 提示。
- 文本编辑单字段 ≤ 200 字。

### 安全边界

- 图元文本全部走 Canvas `fillText`（无 HTML 注入面）；DOM overlay 编辑框值经 React 受控渲染。

---

## 8. 测试策略

Canvas 渲染层 jsdom 覆盖不了，按"模型可测、渲染人工验收"分层。

### 单元测试（Vitest，全量自动化）

- `board-store.ts`：命令执行/撤销/重做、选中集管理、图元 CRUD
- `commands.ts`：每条命令的 do/undo 对称性
- `derive.ts`（重点）：
  - 因果图→判定表：与/或/非组合展开、环路检测、无结果节点
  - 正交选型与阵列生成：L4/L8/L9 代表性参数组合
  - 判定表/正交表→用例骨架文本序列化
- `persistence.ts`：序列化/反序列化往返、缺字段/版本容错
- `viewport.ts`：坐标换算、fit 包围盒计算
- `hit-test.ts`：点/边命中判定（纯几何）
- 组件层：AnalysisBoard 装配（mock 渲染器）——插入按钮禁用态、占位图元→错误卡片、保存防抖触发

### 服务端测试

生成接口的 prompt 契约解析、AI 输出修复重试、schema 校验失败路径（沿用现有 requirement routes 测试模式）。

### 人工验收清单

渲染视觉、拖拽/框选手感、缩放锚点、浮动工具条跟随、文本编辑 overlay 吸附、DPR 高分屏清晰度。

### 覆盖率目标

新增纯逻辑模块（derive/commands/store/persistence/viewport/hit-test）≥ 80%。

---

## 9. 后端 API 变更

### 新增

`POST /api/requirement-analysis/records/:id/board/generate`
- 请求：`{ nodeId: string, chartKind: 'cause-effect' | 'decision-table' | 'orthogonal' }`
- 响应（统一信封）：`{ success: true, draft: CauseEffectDraft | DecisionTableDraft | OrthogonalDraft }`
- 行为：取记录需求全文 + 节点子树文本 → chartKind 对应 prompt 契约 → AI 输出严格 JSON → schema 校验 → 失败自动修复重试一次 → 返回草稿

### 变更

- `AnalysisRecord` 新增 `board?: Board` 字段（可选，旧记录缺失视为空白板）
- `PATCH /api/requirement-analysis/records/:id` 的 `UpdateAnalysisRecordInput` 增加 `board?: Board`（白板自动保存通道）
- 记录创建时 `board` 缺省（首个图元 = 打开画板时前端自动放置的需求树参考图，首次保存时写入）

---

## 10. 对现有代码的影响面

| 文件 | 变更 |
|---|---|
| `AnalysisBoardPage.tsx` | 拉取/保存 board 字段；移除单图表 chartType 概念（需求树固定为参考图元，不再有图表类型切换） |
| `AnalysisBoard.tsx` | 壳保留（胶囊/工具栏/缩放条/模板中心）；中央单图表渲染替换为 `<BoardCanvas>` |
| `features/requirement-analysis/board/` | 新增画布引擎全部模块 |
| `MindMapView/TreeChartView` | 画板不再使用（需求树由 `mindmap-ref.ts` Canvas 重绘）；经全库搜索确认无其他引用，两组件及其测试随本期退役删除 |
| `chart-tabs.ts` / 顶部图表类型菜单 | 退役（画板内不再有"切换图表类型"） |
| `lib/requirement-analysis-api.ts` | 类型与接口扩展（board 字段、generate 接口） |
| `server/src/features/requirement/` | 新增 board generate 路由与 prompt 契约；records store 支持 board 字段 |
| `CONTEXT.md` | 「分析画板」词条更新为测试设计工作台；新增因果图/判定表/正交表/用例骨架词条 |
| ADR | 新增 ADR 0007（分析画板进化为测试设计画布），0006 顶部加修订链接 |

---

## 11. 分期建议（实施计划时细化）

- **一期（本 spec 全部内容）**：画布引擎 + 三件套图元 + AI 生成 + 推导 + 接力 + 持久化
- **二期候选**（不进本期，记录在案）：状态迁移图、覆盖率追溯矩阵、因果图完整性体检、判定表合并简化、正交因子智能推荐、图钉演示路径、缺陷反推、评审分享
