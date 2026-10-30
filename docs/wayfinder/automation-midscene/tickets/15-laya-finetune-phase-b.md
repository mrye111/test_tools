---
title: Laya 微调阶段 B：训练算力与上线
type: grilling
status: closed
assignee: main-session
blocked_by: [14]
---

## Question

阶段 A（数据管线/评测门槛/sidecar）已完成（见票据「Laya 微调：Web 导航决策后端」Resolution）。阶段 B 需要用户决策算力并执行：

1. **算力**（✅ 2026-09-22 用户已选定 **Kaggle 免费 2xT4**）：
   - ~~A. Kaggle 免费 2xT4~~（已选）
   - ~~B. 本机 NVIDIA GPU~~
   - ~~C. 暂缓训练~~
2. **数据量**（进行中）：收割轨迹（4 条）+ Mind2Web 转换（7775 步提取完成，转换全量跑批中，映射成功率约 64%）。
3. **校准与门槛**：训练后拟合温度（官方 notebook 末段）→ 评测集判定（operation ≥85% / target ≥80%）→ 达标后 fastEngine.backend 切 laya 并记录基线对比（决策延迟 vs openai 后端）。
4. **上线路径**：`LAYA_CHECKPOINT` 指向微调产物目录 → sidecar 重启 → 配置页切后端 → 冒烟一条用例验证。

**进展记录**：

- 2026-09-22：官方 notebook 数据契约吃透（state/questions/gold 三列 JSON 字符串，gold 为教师分布、one-hot 兼容）；Mind2Web 8 分片 parquet 下载（808MB，5 号分片截断后重下修复）→ 7775 步提取；转换器踩坑三轮定稿（整体读爆内存→readline 流式；首屏外目标滚动搜索；**backend_node_id 元素级身份匹配**才是正确姿势，cleaned_html 保留该属性）；映射成功率 37%→64%；适配版 notebook 产出（[laya_finetune_webnav_2xT4_kaggle.ipynb](../../../ai-test-tools-site/server/laya-sidecar/kaggle/laya_finetune_webnav_2xT4_kaggle.ipynb)），上传/运行手册见 [kaggle/README.md](../../../ai-test-tools-site/server/laya-sidecar/kaggle/README.md)。
- 待办（已完成）：全量转换完成 → build_dataset.py 合并 → 用户上传 Kaggle 运行 → 校准 → 门槛判定 → 切后端。
- 2026-09-22（续）：首轮全量转换发现共享页面被 cleaned_html 脚本累积拖死（renderFail 6136/7775）——改 **JavaScript 关闭渲染 + 每 300 页轮换 context**，重跑 renderFail 降到 207，**最终产出 records.jsonl 7,905 行（Mind2Web 动作 4,903 + 滚动 2,998 + 自家收割 4），94MB**。数据包可直接上传 Kaggle 训练（操作步骤见 kaggle/README.md）。
- 2026-09-22（训练跑完，benchmark 表**不作数**）：2xT4 DDP 4 轮跑完（12,765 序列，loss 2.26→均值 1.20，reward −1.65→0 附近但噪声大），checkpoint 落在 `/kaggle/working/laya_finetuned_typed_decisions/`。第 6/7 节 HEAD-TO-HEAD 表（Laya Acc 0.36 vs Jev 0.727 / ModernBERT 0.646 / Teacher ceiling 0.735）有三处硬伤：① 评测集是 `LocalLLaMA/typed-decisions` 的官方 test split（Agent Trace Observability / Customer Service / Invoice Processing / Security Incidents 风险分级），**跟 Web 导航决策不是同一个任务**，0.36 是跨任务迁移分；② 对比表三行基线是官方 notebook 里的**硬编码常量**，本轮并未实跑；③ 全量 12,765 序列全部参与训练、**没有留出评测集**（温度校准用的 `all_items[::15][:400]` 也是训练切片 → 置信度偏乐观，而 low-confidence 降级门控正依赖它），**门槛（operation ≥85% / target ≥80%）至今从未被测过**。唯一有效信号：`laya.Agent(OUTPUT_DIR).predict()` 跑通，153.7 ms/次 → 管线可用。
- 待办（用户侧，收窄）：① 在同 session 补 Web 导航诊断评测（train accuracy 分 operation / *_target 头）判断学没学会；② operation < 0.70 → 修标签噪声（Mind2Web 映射兜底 tier containment / nearest≤120px 静默灌错 target；38% 合成 SCROLL_DOWN 记录拉偏分布）与 RLCD 目标，**不再烧算力**；③ > 0.90 → 按 annotationId 做 80/20 重训取真 hold-out，再走门槛判定与后端切换。**红线：不要跑 notebook 第 8 节**（会把模型连同错误 model card 推到 HuggingFace 公开仓库）。

## Resolution

**结论：Laya 微调路线关闭，不启用 laya 决策后端。** 极速引擎（票据 09）维持 openai/jev 后端 + 视觉回退不变。2026-09-22 定。

**门槛判定 FAIL，且是在训练集上**（records.jsonl 全量参与过训练 → train accuracy，泛化只会更低）：

| head | acc | n | avg_conf | 门槛 |
|---|---|---|---|---|
| operation | 0.609 | 791 | 0.786 | ≥0.85 ❌ |
| click_target | 0.516 | 370 | 0.630 | — |
| type_text_target | 0.859 | 85 | 0.762 | — |
| select_target | 0.312 | 16 | 0.479 | — |
| **target 合计** | **0.571** | 471 | — | ≥0.80 ❌ |

（operation 0.609 仅比多数类基线约 0.4 —— SCROLL_DOWN 占 38% —— 高 23 个点。）

**证据链（五条，任意一条都足以否决）：**

1. **准确率随候选规模单调下降**：type_text 0.859 → click 0.516 → select 0.312。正是「一次前向在 K 个选项里选一个」撞上「K 无界」的直接表现——架构匹配问题，非超参问题。select_target 还有 9/800 行直接抛 `ValueError: question 'select_target' options exceed head_max_len=256`（整次调用作废）。
2. **置信度不可信 → 降级门控失效**：三个 head 的 `avg_conf` 均高于 `acc`（operation 0.786 vs 0.609），即最自信时最易错。加载时报 `temperatures outside [0.5, 5] … Treat confidence as uncalibrated`；而存盘的 `temperature = [0.94, 1.2, 1.2]` 后两位是 `fit_one_temp` 初值（score/noul 无样本、从未拟合）。**极速引擎的 low-confidence 视觉回退在这套置信度下会反向工作**。
3. **信息瓶颈**：state 原始 24,393 token，最终只进 `max_len=1024` —— 96% 页面状态在进模型前被丢弃。这解释了 operation 连动作类型都判不准。
4. **train/infer 尺子不一致**：预处理用基座 `max_len=512 / head_max_len=192`，`train_ddp.py` 改写成 `1024/256` 后存盘供推理。训练只见过 ≤512 序列、≤192 选项区，推理允许 1024/256。且 `build_training_item` 中 `if len(markers) != k: return None` **静默丢弃**装不下的决策。
5. **数据偏斜**：B3 选项分布里候选 ≥40 的仅占 3%（Mind2Web `cleaned_html` 被剪过），生产真实页面候选会多得多 → 溢出率 1.1% 只是下限。另：Mind2Web 英文站为主、自家收割仅 4 条，中文站分布几乎未覆盖。

**训练实况**：2xT4 DDP 4 epoch，12,765 序列，loss 2.26→均值 1.20（0.5~2.6 乱抖），reward −1.65→0 附近未稳住。RLCD 未收敛。

**保留产出**（若日后重启可复用）：数据管线 `kaggle/extract_mind2web.py` → `scripts/convert-mind2web.mjs`（backend_node_id 身份匹配）→ `kaggle/build_dataset.py`；适配版 notebook `kaggle/laya_finetune_webnav_2xT4_kaggle.ipynb`；Kaggle 数据集 `yewanglin/1111111`（records.jsonl 7,905 行 / 94MB）。

**未做 / 风险已排除**：notebook 第 8 节 HuggingFace 发布因无 HF_TOKEN 在 `api.create_repo()` **之前**抛错，**未发布任何内容**。checkpoint 在 `/kaggle/working/`，Kaggle 会话结束即失效。
