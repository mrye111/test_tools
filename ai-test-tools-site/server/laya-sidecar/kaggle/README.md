# Kaggle 训练手册（票据 15 阶段 B）

把 Web 导航决策数据在 Kaggle 免费 2xT4 上微调 Laya，产出可用作极速引擎决策后端的 checkpoint。

## 一、产出文件（本目录已备好）

| 文件 | 说明 |
|---|---|
| `laya_finetune_webnav_2xT4_kaggle.ipynb` | 适配版训练 notebook（官方 RLCD 流程，数据加载已改为读取 records.jsonl） |
| `extract_mind2web.py` | Mind2Web parquet → steps.ndjson（已跑过，重跑需重新下载分片） |
| `build_dataset.py` | 合并收割记录 + Mind2Web 转换行 → records.jsonl（数据更新后重跑它） |

数据链路（如需重新生成）：

```bash
# 1. 自家收割记录（需 API 服务与 dev server 在跑）
node server/scripts/harvest-decisions.mjs

# 2. Mind2Web 转换（分片已在 artifacts/laya-ft/mind2web/）
python ai-test-tools-site/server/laya-sidecar/kaggle/extract_mind2web.py artifacts/laya-ft/mind2web artifacts/laya-ft/mind2web/steps.ndjson
node ai-test-tools-site/server/scripts/convert-mind2web.mjs --steps artifacts/laya-ft/mind2web/steps.ndjson --out artifacts/laya-ft/mind2web/rows.jsonl

# 3. 合并出最终上传文件
python ai-test-tools-site/server/laya-sidecar/kaggle/build_dataset.py
```

## 二、Kaggle 操作步骤

1. **上传数据**：Kaggle → Datasets → New Dataset → 上传 `artifacts/laya-ft/records.jsonl`（数据集名随意，如 `laya-webnav`）。
2. **上传 notebook**：Kaggle → Code → New Notebook → Import → 选择本目录的 `laya_finetune_webnav_2xT4_kaggle.ipynb`。
3. **挂载数据**：notebook 右侧 Add Data → 选刚上传的数据集（第 6 个 cell 会自动在 `/kaggle/input/*/records.jsonl` 找到它）。
4. **开 GPU**：Settings → Accelerator → **GPU T4 x2**。
5. **Run All**：全程约 4–5 小时（预处理几分钟，训练大头）。产出在 `/kaggle/working/laya_finetuned_typed_decisions/`。
6. **下载产物**：训练完的 checkpoint 目录 + benchmark JSON，下载回本机。

## 三、回本机后的上线步骤

1. checkpoint 目录放到本机（如 `artifacts/laya-ft/checkpoints/laya-webnav-v1/`）。
2. sidecar 指向它：设 `LAYA_CHECKPOINT=<该目录>` 启动（见 server/laya-sidecar/README.md）。
3. **评测门槛**：用 hold-out eval 集判定（operation ≥85% / target ≥80%，用官方 benchmark 脚本或自评脚本跑；不达标不启用，分析失败类别后决定补数据还是调参）。
4. 达标后：配置页把极速引擎后端切到 `laya`，跑一条冒烟用例对比决策延迟（vs openai 后端的 2–5s，预期毫秒级）。

## 注意

- 官方 notebook 第 6 cell 会自动探测 `/kaggle/input/*/records.jsonl`；若你的数据集里还有别的文件命名，确认 records.jsonl 能被 glob 到。
- 训练后务必做温度校准（notebook 末段），否则置信度偏高不可用于降级门控（fast engine 的 low-confidence fallback 依赖可信置信度）。
- Mind2Web 是英文站为主、我们自家收割是中文站——模型上线后优先用中文真实用例回归验证，英文分布偏差可能有影响。
