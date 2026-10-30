# Laya 决策 Sidecar

把（微调后的）Laya checkpoint 包装成极速引擎的自托管决策后端：毫秒级、免费、页面数据不出网。

## 启动

```bash
cd ai-test-tools-site/server/laya-sidecar
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8765
```

首次 `/decide` 会下载 checkpoint（默认 `convaiinnovations/laya-multilingual`，322M，约 650MB）；之后常驻内存，CPU 单决策约 0.2–0.5s。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `LAYA_CHECKPOINT` | `convaiinnovations/laya-multilingual` | HuggingFace id 或本地路径（微调后的 checkpoint 目录） |

## 接口

- `GET /health` → `{ok, loaded, checkpoint, error}`
- `POST /decide` → 请求 `{goal, snapshot{url,title,text,elements[]}, history[]}`；响应 `{operation, target?, text?, confidence, latencyMs}`

协议与 `server/src/features/automation/fast/decision-backend.ts` 的 `createLayaBackend` 对齐；问题构建逻辑与 `fast/questions.ts` 同构（TS/Python 各一份，改动需同步）。

## 重要提醒

- **基础 checkpoint 零样本接近随机**（官方基准 0.362 vs 随机 0.318），未微调前决策质量不可用——sidecar 管线（健康检查/协议/延迟）可先行验证，生产启用需等票据 14 阶段 B 的微调与评测门槛达标。
- 微调后把 `LAYA_CHECKPOINT` 指向微调产物目录，并先做温度校准（官方 notebook 末段），否则置信度偏高不可信。
