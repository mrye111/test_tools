# Handoff — NexusKit 分析画板独立路由化

## 项目

D:\code\Test_Tools_Demo —— NexusKit（AI 测试工具工作台），React 19 + Vite 8 + Tailwind 4 前端、Express 5 后端，主应用在 `ai-test-tools-site/`。仓库有 CodeGraph 索引（`codegraph explore "..."` 优先于 grep）。全程使用中文交流、中文注释。

## 本期目标

把"分析画板"从 `RequirementAnalysisPage` 的同页结果态，改造为**独立路由页面**（对标 boardmix 编辑器 URL 直达形态）。

## 已对齐的决策（用户已确认，勿再询问）

1. **先存后跳**：新分析完成后先 `createAnalysisRecord` 拿到 id，再 `navigate('/requirement-analysis/board/' + id)`；保存失败则降级为留在分析进度页并提示。
2. **去掉"重新分析"功能与按钮**——后续画布本身可编辑，不再需要重新分析入口。涉及 `AnalysisBoard.tsx` 右侧工具栏的"重新分析"按钮、`onReanalyze` prop，以及 `RequirementAnalysisPage` 里对应处理函数。
3. 画板路由：`/requirement-analysis/board/:id`，画板页自己按 `:id` 调 `getAnalysisRecord` 拉取数据；刷新/直达均有效。
4. 返回列表 = `navigate('/requirement-analysis')`；ESC 保留。
5. 本决策需要**更新 ADR 0005**（顶部加"已被 0006 修订"）并**新增 ADR 0006**。

## 当前进度

### 已完成（上一会话遗留，均已验证）

- ADR 0005 新增；`CONTEXT.md` 新增「分析画板」词条
- `templates.ts`（8 类 18 个静态模板）、`TemplateCenterModal.tsx`（纯骨架弹窗）
- `AnalysisBoard.tsx` 全屏画板组件（同页 `fixed inset-0` 形态）
- `RequirementAnalysisPage.tsx` 结果视图替换为 `<AnalysisBoard>`；新增 `recordName` state；`handleExport` 改 `handleExportFile`
- `index.css` 新增 `.analysis-board-*` / `.template-center-*` 样式，删除旧 `.requirement-canvas-*`
- **`ChartCanvasModal.tsx` 与 `ChartCanvasModal.test.tsx` 已删除**
- **`AnalysisBoard.test.tsx` 已新建**（12 个用例全部通过，mock 套路沿用被删测试）
- 全量 `npm run test`：44 文件 / 313 用例通过
- `npm run lint`：48 错误 / 2 警告——**已确认全部为既存问题**（`react-hooks/set-state-in-effect` 新规则 + 1 处未使用变量），非本次改动引入；用户尚未决定如何处理（推荐不动）
- `npm run build`：**未执行**（lint 失败后中断）

### 待办（本会话目标）

1. 读 `src/App.tsx` 与 `src/pages/RequirementAnalysisPage.tsx`（此前工具被系统中断，未能读取）
2. 新建 `src/pages/AnalysisBoardPage.tsx`：按 `:id` 拉记录，持有 `chartType/selectedNodeId/activeFindingId` 等 state，渲染 `AnalysisBoard`
3. `App.tsx` 新增路由 `/requirement-analysis/board/:id`
4. `RequirementAnalysisPage.tsx`：删 `result` phase 与 `AnalysisBoard` 渲染；`handleOpenRecord` 改 `navigate(board/:id)`；`handleAnalyze` 完成后先存后跳；`handleChartTypeChange/handleSelectNode/handleSelectFinding/handleExportFile` 迁往画板页
5. `AnalysisBoard.tsx`：删"重新分析"按钮与 `onReanalyze` prop
6. `AnalysisBoard.test.tsx`：同步删"重新分析"相关断言（如有）
7. 新增 `docs/adr/0006-analysis-board-dedicated-route.md`；ADR 0005 顶部加修订链接
8. 验证：`npm run test`、`npm run lint`（确认无新增）、`npm run build`
9. 视觉验证：`npm run server`（3000）+ `npm run dev`（5173），打开记录走 `/board/:id` 检查直达/刷新

## 关键实现细节

- `AnalysisBoard` props 契约保持：`recordName/result/chartType/onChartTypeChange/selectedNodeId/onSelectNode/activeFindingId/onSelectFinding/findingCounts/nodeTitles/processBlocks/error/onBack/onHandoff/onExportFile/onExportError`（删 `onReanalyze`）
- 画板复用 `MindMapView`/`TreeChartView`（`ChartCanvasHandle`）与 `FindingsPanel`；缩放计算复用 `canvas-zoom.ts`
- 右侧工具栏 Tooltip `placement="left"`，左轨 `placement="right"`
- 画板本体 `position:fixed; inset:0; z-index:20`；模板中心用 `ModalShell`（portal 在其上）
- 图表类型下拉用 `components/ui/CustomSelect`（无 aria-label，测试按按钮文本选）
- 测试 mock 套路：`vi.hoisted` 暴露 `mindmapHandle/treeHandle`（`zoomBy/fit/getPngDataUrl`）+ `onZoomScaleChange` props + `downloadDataUrl`；`vi.mock('./MindMapView'/'./TreeChartView')` 用 `forwardRef + useImperativeHandle` 返回 stub

## Suggested skills

- `frontend-design` — 画板独立路由后的视觉走查（顶部是否完全无主导航）
- `grill-with-docs` — 画布可编辑对象模型进入下一阶段前，先对齐术语与 ADR
- `tdd` — `AnalysisBoardPage.test.tsx` 数据拉取逻辑测试

## 沟通约定

仅中文回复；MCP 调用遵循 AGENTS.md 的单轮单工具与"工具调用简报"规则；编辑用 apply_patch，测试 Vitest + Testing Library。

## 注意事项

- 工作区有与本任务无关的未提交改动（首页 Hero/ToolCard 等），**不要回退**
- lint 的 48 个既存错误**不是本任务引入**，用户尚未决定是否处理，默认不动
