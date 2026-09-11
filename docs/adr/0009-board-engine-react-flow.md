# ADR 0009：画板引擎整体迁移 React Flow

日期：2026-09-11
状态：已接受
关联：wayfinder 地图 #13；ADR 0007（测试设计画布）

## 背景

ADR 0007 引入的测试设计画布建立在自研 Canvas 2D 引擎上（renderer / hit-test / viewport / commands / BoardStore，约 2300 行）。随着图元类型与交互增多，自研引擎的持续投入（命中检测、框选、拖拽、缩放、可访问性）与业务价值不成比例——画板的真正资产是**确定性推导**（因果图 → 判定表 → 用例骨架）与 AI 生成通路，而非渲染器。

## 决策

整体迁移到 React Flow（@xyflow/react，MIT），**RF 状态即画布真相**：

- `BoardElement` 语义类型保留，转为 RF 节点的 `data` 载荷；因果图/流程图的子节点拆为 RF 一等节点+边（`groupId` 标记图元归属），判定表/正交表/需求树引用为整体自定义节点
- 废弃 BoardStore 命令栈；撤销/重做采用**快照栈**（commit/transient/silent 三级：语义变更入栈，拖拽中间态合并为一条，选择/测量静默），上限 100 条
- 持久化格式升级为 version 2（nodes/edges + viewport）；**不做旧数据迁移**——version 1 数据读为空画板（画板内容可由 AI 随时重生成，迁移价值低于成本）
- derive 推导与用例接力的语义逻辑零改动，仅输入改为从 RF 图重建（`reconstructCauseEffectElement` 等）
- 旧引擎（renderer/hit-test/viewport/commands/board-store/TextEditOverlay 及 elements/ 绘制代码）整体删除，仅保留 `elements/layout.ts`（需求树布局，AI 落位与 RF 节点共用）

## 明确放弃 / 二期候选

- 旧 BoardStore 数据迁移（决策即放弃）
- PNG 离屏导出（依赖旧 canvas 渲染器，移入雾里区域）
- AI 增量修改画布（对话改图）：经查旧引擎从未有此功能，属新特性；待手动编辑（#19）就位并有真实使用反馈后评估
- 连线编辑、文本编辑、表格内编辑：跟随票 #19/#20

## 后果

- 画板交互（框选、多选拖拽、缩放平移、删除）由 React Flow 原生承担，删除约 2300 行自研引擎代码
- 图元渲染从 Canvas 绘制变为 DOM/SVG 组件，获得可访问性与 CSS 主题能力；表格类图元改为 HTML 表格
- jsdom 测试从"canvas 断言"变为标准组件断言，测试编写成本下降
