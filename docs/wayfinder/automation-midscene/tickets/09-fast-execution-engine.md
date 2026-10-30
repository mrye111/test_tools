---
title: 极速执行引擎（DOM 动作表 + 决策模型）可选集成
type: grilling
status: closed
assignee: main-session
blocked_by: []
---

## Question

调研结论（2026-09-21，依据 browser-use/jev-ultrafast 与 awlevin/typesafe-computer-use 官方 README 及实测数据）：

「DOM 编号动作表 + 决策模型选动作」回路已被验证——程序把页面可见控件序列化成编号元素表，决策模型（TypeSafe Jev）一次请求同时选"操作类型 + 目标元素序号"，需要填字时才调小语言模型。Google Flights 完整任务 **7.1s / $0.0039**，单决策 **0.13–0.38s / $0.0002**——比 Midscene VLM 路径（Kimi 实测 2.7–6s/步）**快约 10–40 倍、便宜约两个数量级**。

但该回路的边界（官方自述）：**不做结果验证**（DONE 需独立的成功检测，断言要另写）；DOM 读取器不覆盖 shadow DOM、frames、canvas、上传、弹窗标签页、嵌套滚动、复杂键盘组件；无屏幕感知能力（纯 DOM 文本）。

集成构想（可选「极速引擎」）：复用 CompiledPlan 抽象——`act` 指令可走路由到极速引擎（DOM 动作表回路），`assert`/`extract` 默认走视觉引擎（Midscene），极速引擎 BLOCKED/低置信/超时自动降级到视觉引擎。混合架构兼得速度与断言能力。

需要与用户敲定：

1. **决策后端**：Jev API（开箱即用、$0.0002/步，但页面元素文本会发往 TypeSafe 海外 API，内网被测系统合规需评估）vs Laya 自托管（数据不出网，但零样本接近随机 0.362、>20 选项弱于 Jev 0.425vs0.870，需 RLCD 微调 + 评测达标才能用）vs 后端可插拔两者都支持（推荐）；另有社区 Jev 兼容开源 API（Qwen3.6-35B，ekzhang1）可列为第三选项
2. **实施形态**：Python sidecar 跑 jev-ultrafast 原版（最快验证，但引入 Python 运维面）vs TypeScript 重写回路（保持单栈；原 repo 刻意保持小——agent.py/snapshot.js/browser.py/model.py/questions.py 五个文件，snapshot.js 本身就是页面内 JS，移植到 Playwright TS 很顺；推荐生产形态）
3. **优先级**：MVP（视觉引擎）之后作为增强接入，还是与视觉引擎同期开发？

## Resolution

2026-09-21 与用户定稿：

- **决策后端：可插拔三选**——Jev API（TypeSafe 付费，$0.0002/决策，开箱即用）/ Laya 自托管（数据不出网，需 RLCD 微调 + 评测达标）/ 开源 Jev 兼容 API（如 Qwen3.6-35B 实现），运行时按执行配置切换
- **实施形态**：TypeScript 重写回路（保持单栈；参考 jev-ultrafast 五文件结构 agent/snapshot/browser/model/questions，snapshot.js 本身就是页面内 JS，移植到 Playwright 页面上下文很顺）；Python sidecar 跑原版仅用于快速验证
- **优先级**：排在视觉引擎 MVP 之后，作为增强接入；复用 CompiledPlan 抽象——act 走极速引擎，assert/extract 走视觉引擎，BLOCKED/低置信/超时自动降级视觉引擎
- **合规注意**：Jev API 路径下页面元素文本发往海外 API，内网被测系统默认路由到自托管后端（与票据 05 的凭据/环境配置联动，按项目维度配置后端）

**2026-09-23 补充（极速回放）**：极速路径绕过 Midscene agent，agent 无任务流水则 `reportFile` 为空——全极速运行在运行历史里没有报告链接。修复：`runFastAct` 采集回放帧（决策/动作/失败现场各一张 JPEG 截图 + 目标 bbox + 置信度 + 耗时，单步上限 40 帧），runner 汇总脱敏后交给 [fast-replay.ts](../../../ai-test-tools-site/server/src/features/automation/fast-replay.ts) 拼成 Midscene `GroupedActionDump`，直接调官方 `writeDumpReport`（`@midscene/core/utils`）——产物就是原生 Midscene 报告格式，查看器原生渲染时间线/截图胶片条/Param/Meta。注意点：截图必须带 `data:image/` 前缀（裸 base64 查看器会当路径渲染成破图）；帧内文本写出前经 `sanitizeErrorMessage` 脱敏。运行历史详情区同时加了不依赖报告的逐步结果明细表。

**2026-09-23 再补（播放器）**：要出 Midscene 的 Replay 播放器（缩放镜头 + 指针跟随 + 播放条），dump 任务必须带 `uiContext.shotSize`（缺了它 `extractMetaFromNormalized` 返回 null，查看器不构建回放脚本——这是隐藏门槛，逆向 `packages/visualizer/src/utils/replay-scripts.ts` 所得）；决策帧有目标 bbox 时映射为 `Planning/Locate` 任务并带 `output.element.center/rect` 才有缩放+指针动画；动作帧 subType 用原生动作名（Tap/Input/Select/Scroll/Sleep）走 `typeStr/paramStr` 显示链路。截图内联 `{base64: "data:...", capturedAt}` 即可，无需 ref+image 块分离存储。
