# ADR 0010：画板纯白板化——全量 React Flow 原生 UI，推导接力退役

日期：2026-09-11
状态：已接受
关联：ADR 0009（画板引擎迁移 React Flow，本决策部分推翻其语义层保留方案）

## 背景

ADR 0009 完成引擎迁移后，用户反馈期望画板全量采用 React Flow 的原生 UI（Controls / MiniMap / 默认节点与边），且不再需要判定表、正交表、需求树引用等测试设计图元。

## 决策

画板转为**通用白板**：

- 全量 React Flow 原生 UI：`<Controls />`（缩放/适应/锁定）、`<MiniMap />`（小地图导航）、`<Background />` 点阵、默认节点/边样式；自研左栏工具条、右下缩放条、自定义节点/边组件全部删除
- 交互：双击空白新增节点、双击节点编辑文案、拖拽连线（箭头默认边）、Delete 删除、Ctrl+Z/Shift+Z/Y 撤销重做（快照栈保留）
- 持久化升级为 version 3（纯 RF 图）；v1/v2 数据一律读为空画板，不做迁移
- **推导接力退役**：删除 derive.ts（因果图→判定表→用例骨架）、board/ai.ts（AI 落图）、table-ops 等语义层；"基于此需求生成测试用例"按钮从画板移除。画板与用例生成工具脱钩
- 分析结果的文件导出（XMind/FreeMind/Markdown）保留——它导出的是分析结果而非画布内容

## 后果

- 画板不再承担测试设计方法（黑盒三件套）能力；用例生成工具的输入回到纯需求文本
- 会话首页模板中心的测试设计图表模板（因果图/判定表/正交表 chips）生成的文件在画板中将打开为空白板——该入口的处置留待后续决策
- board/ 目录收敛为 `rf/`（BoardFlow + rf-types + rf-persistence + useGraphHistory）+ useBoardPersistence，画板前端代码量降至约 400 行

## 二期候选

- 若白板获得真实使用，可评估：节点多类型（input/output 样式）、画布 PNG 导出（html-to-image）、AI 读画布文本生成用例的新接力形态
