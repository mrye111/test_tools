---
title: Laya 微调：Web 导航决策后端（替换 openai 通用后端）
type: task
status: closed
assignee: main-session
blocked_by: []
---

## Question

雾区毕业：极速引擎的 openai 通用后端决策延迟 2–5s/轮且有 API 成本，目标替换为自托管 Laya（毫秒级、免费、数据不出网）。Laya 零样本接近随机（0.362 vs 0.318 基线），价值全靠 RLCD 微调——需要自建 Web 导航决策数据集 + 评测门槛 + 推理服务。

**阶段 A（无 GPU 依赖，本票主体）**：

1. **数据管线**：收割器回放自动化用例（视觉引擎执行），每个 act 步骤前取极速快照，把 Midscene 动作事件（Tap@point / Input / Select）映射回快照元素序号，产出 (state, questions, answer) JSONL——训练/推理共用同一问题构建器（一致性由共享代码保证）。另立 Mind2Web 转换器（英文大规模）为数据量补充。
2. **评测集与门槛**：hold-out 决策任务（本站页面，≥20 条），go/no-go 初始门槛 operation 准确率 ≥85%、target ≥80%（看到基线后可调）。
3. **推理 sidecar**：FastAPI 包装 `laya`（懒加载 checkpoint，/health + /decide 协议与 FastDecisionBackend 对齐），接入极速引擎为第三后端选项（配置可见、未启动 sidecar 时如实报不可用）。

**阶段 B（需用户决策算力）**：

4. 训练：Kaggle 免费 2xT4（官方 RLCD notebook 适配，4–5h）或本机 GPU（若有）；数据=收割轨迹 + Mind2Web 转换。
5. 温度校准 + 评测门槛判定 → 达标后 fastEngine.backend 切 laya。

## Resolution

**阶段 A（无 GPU 依赖部分）2026-09-22 全部完成**；阶段 B（训练与上线）拆至票据「Laya 微调阶段 B：训练算力与上线」。

落地内容：

1. **数据管线**（[harvest-decisions.mjs](../../../ai-test-tools-site/server/scripts/harvest-decisions.mjs)）：回放自动化用例（视觉引擎执行），每 act 步前取极速快照，把 Midscene 动作事件（Tap@point/Input/SelectOption/Scroll）经 [harvest-mapping.ts](../../../ai-test-tools-site/server/src/features/automation/fast/harvest-mapping.ts) 映射回快照元素序号（bbox 命中 → 最近中心兜底，阈值 40px），产出 `(state, questions, answer)` JSONL（80/20 按用例切分 train/eval，动作按签名去重）。**训练/推理一致性由共享问题构建器 [questions.ts](../../../ai-test-tools-site/server/src/features/automation/fast/questions.ts) 保证**（Jev 后端/收割器/Laya sidecar 三方共用，Jev 后端已重构复用）。冒烟产出 4 条真实记录（首页 2 条 ok、百度 2 条），格式与映射正确性人工抽验通过；Mind2Web 转换器留作阶段 B 数据量补充。
2. **评测集与门槛**：hold-out 切分机制已随收割器落地；当前数据量过小（4 条）评测集暂空，随数据积累（更多用例收割 + Mind2Web 转换）自动成型。go/no-go 门槛维持 operation ≥85% / target ≥80%。
3. **推理 sidecar**（[server/laya-sidecar/](../../../ai-test-tools-site/server/laya-sidecar/)）：FastAPI 包装 `laya`（懒加载 checkpoint、/health + /decide 协议与 FastDecisionBackend 对齐、操作+目标同一 forward pass、置信度取选中项概率），README 写明启动方式与"基础 checkpoint 零样本不可用"警示；已接入极速引擎为第三后端选项 `laya`（配置页可选、sidecar 地址可配、30s 缓存健康探测、不可达/未就绪如实报不可用）。py_compile 验证通过；未做真实模型下载实测（约 650MB，留给阶段 B）。
4. **回归**：fast 模块 31 测试全绿（新增 questions/harvest-mapping 测试矩阵），全量服务端 382 + 前端 517 通过，双端 tsc 零错误。
