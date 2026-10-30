---
title: Kimi K2.8 延迟成本与执行缓存调研
type: research
status: closed
assignee: agent-research-03
blocked_by: []
---

## Question

PoC 实测每个 AI 步骤 4–19s（K2.8 强制 max 思考）。在接入生产前调研优化空间：

1. **思考强度下调**：Kimi 的 OpenAI 兼容接口是否支持降低思考强度（模型列表显示 think_efforts 有效值 low/high/max，默认 max）？通过 `MIDSCENE_MODEL_EXTRA_BODY_JSON` 传参是否生效（参数名需从 Kimi/Moonshot API 文档或实测确认）？下调后对 Midscene 定位准确率的影响用什么方法评估？
2. **执行缓存**：Midscene 1.x 缓存机制（新读写模式 vs `MIDSCENE_CACHE=1`+cacheId 旧方式）的细节——缓存键是什么、页面变化后失效率、回归重放场景的命中预期与推荐配置。
3. **批量执行节流**：一次跑一个用例集（几十条用例 × 每条若干步骤）时，Kimi 端点的 RPM/并发限制是多少（订阅档位的限速），推荐的服务端节流/队列参数。

可在 `artifacts/midscene-poc/` 里跑对照实验（.env 已配好 key），但不要改动 artifacts 之外的项目代码。

## Resolution

**思考强度可降、缓存与节流方案定稿**（13 次实测 API 调用 + Midscene 源码链路验证）：

- **关键反转**：Midscene 1.13 在 `family=kimi`（PoC 现配置）下**默认就发 `thinking:{type:"disabled"}`**——PoC 观测的 4–19s/步主因疑为 prompt 体积而非思考（可用 `DEBUG=ai:call` 确认）；想开思考需显式 `MIDSCENE_MODEL_REASONING_ENABLED=true`
- **降延迟**：`thinking:{type:"disabled"}` 实测 6.0s→2.7s（难例 7.9s→2.0s），reasoning_tokens 归零且坐标正确；`reasoning_effort:"low"` 收益温和（150→117 tokens）；两者均可经 `MIDSCENE_MODEL_EXTRA_BODY_JSON` 注入（extraBody 最后合并、优先级最高，源码已验证）
- **端点红利**：响应出现 `cached_tokens` 全量命中——Kimi 端点自带 prompt 缓存，同用例重复跑、相同前缀的后续步骤额外提速
- **缓存配置**：`cache:{strategy:"read-write", id:"<用例集稳定ID>-<环境>"}`，缓存文件可提交仓库/CI 产物；CI/生产 `read-only` + 通过后 `flushCache({cleanUnused:true})`；缓存键=操作类型+prompt 精确匹配（不含页面内容），locate 有 XPath 重解析兜底，query/assert 永不缓存；页面改版后需清缓存重建
- **节流**：官方未公布 RPM；实测 5 并发无 429。建议并发 3（可升 5）、请求间隔 ≥200ms、429/5xx 指数退避（1s/2s/4s ≤3 次）、`MIDSCENE_MODEL_RETRY_COUNT=3`、批量执行按用例串行
- **遗留风险**：`thinking disabled` 是未文档化行为（元数据标 thinking "only"），可能收紧——需启动冒烟检查 + 异常回退 low 档（已立任务票「建立定位评测集并冒烟验证思考档位配置」）；禁思考准确率仅 2 例，正式接入前先建 20–30 条定位评测集

实测数据表、注入链路与评测方法见 [research/03-cache-and-latency.md](../research/03-cache-and-latency.md)；实验脚本在 artifacts/midscene-poc/exp_*.mjs 可复现。
