---
title: Kimi K2.8 延迟优化：思考强度、执行缓存与批量节流
type: research
status: done
ticket: ../tickets/03-cache-and-latency-strategy.md
date: 2026-09-21
---

# 结论先行

1. **思考强度可以下调，且有两档可用**：
   - `thinking: {"type": "disabled"}` —— 效果最大。实测同一张截图同一类定位请求 **6.0s → 2.7s（-55%）**，难例（顶部小字「文档」入口）**7.9s → 2.0s（-75%）**，`reasoning_tokens` 归零，两次定位坐标均正确。
   - `reasoning_effort: "low" | "high" | "max"` —— 效果温和（reasoning tokens 150→117，延迟 6.0s→5.4s），适合想保留思考但降强度的场景。
   - 两者均可通过 `MIDSCENE_MODEL_EXTRA_BODY_JSON` 注入（源码链路已验证，extraBody 最后合并、优先级最高）。
   - **重要发现**：Midscene 1.13 在 `MIDSCENE_MODEL_FAMILY=kimi`（PoC 当前配置）下**默认就已发送 `thinking:{type:"disabled"}`**。PoC 观测到的 4–19s/步需要先确认是否真带着思考（见「风险」第 3 条）。
2. **缓存推荐配置**：回归重放用 `cache: { strategy: "read-write", id: "<用例集稳定ID>" }`，缓存文件（`midscene_run/cache/*.cache.yaml`）提交进仓库/CI 产物；CI 或生产环境用 `read-only` + 测试通过后手动 `agent.flushCache({ cleanUnused: true })`。缓存键是「操作类型 + prompt 精确匹配」，不含页面内容，页面改版后需清缓存重建。
3. **节流建议**：Kimi Code 订阅端点（api.kimi.com/coding）官方未公布 RPM/并发数字；实测 5 并发全部 200 无 429。建议服务端队列 **并发 3–5、请求间隔 ≥200ms、429/5xx 指数退避（1s/2s/4s，≤3 次）**，批量执行按用例串行。

---

## 1. 思考强度下调

### 1.1 模型与端点事实

- 端点 `https://api.kimi.com/coding/v1` 的 `/models` 返回（实测）：
  - `kimi-for-coding` = **K2.8 Preview**，`supports_thinking_type: "only"`，`think_efforts: { valid_efforts: ["low","high","max"], default_effort: "max" }` —— 即票据所述「默认 max」。
  - 另有 `kimi-for-coding-highspeed`（K2.7 Code Highspeed，不支持动态工具）和 `k3` / `k3-256k`（默认 effort=high）可用。
- 官方文档（platform.kimi.com/docs）表述：K2.x 用 `thinking` 对象开关，K3 用顶层 `reasoning_effort`；k2.7-code「thinking 只能 enabled，disabled 会报错」。
- **实测与文档的矛盾点**：K2.8（kimi-for-coding）虽然元数据标 `supports_thinking_type: "only"`，但 `thinking:{type:"disabled"}` **被接受且完全生效**（`reasoning_tokens=0`、无 `reasoning_content` 返回）。属未文档化行为，可用但需防御（见风险 2）。

### 1.2 实测数据

方法：`artifacts/midscene-poc/shot_debug.jpg`（1440×900 真实页面截图）+ Midscene 风格定位 prompt（强制 `response_format: json_object`），逐变体单次调用计时。实验脚本保留在 `artifacts/midscene-poc/exp_think_effort.mjs`、`exp_hard.mjs`、`exp_burst.mjs`，可复现。共消耗 13 次 API 调用。

| 变体 | 延迟 | reasoning_tokens | 定位结果 | 正确 |
|---|---|---|---|---|
| baseline（默认 max） | 6.0s | 150 | 「立即开始」[95,702] | ✓ |
| `reasoning_effort=low` | 5.4s | 117 | [96,703] | ✓ |
| `reasoning_effort=high` | 6.0s | 179 | [94,703] | ✓ |
| `thinking.type=disabled` | **2.7s** | **0** | [96,703] | ✓ |
| 难例 baseline（顶部「文档」小字） | 7.9s | 252 | [1194,40] | ✓ |
| 难例 `thinking.type=disabled` | **2.0s** | **0** | [1197,40] | ✓ |

观察：
- 思考禁用后延迟降至 1/3~1/4；即使难例（低显著度小目标）两者坐标都落在正确元素上。
- `reasoning_effort` 低/高档只影响思考 token 量，对本类简单定位的总延迟影响有限（图像编码+prompt 处理+网络占了固定成本）。
- `reasoning_effort=high` 那次响应出现 `prompt_tokens_details.cached_tokens: 1915`（全量命中）——**端点自带 prompt 缓存**，同一用例重复跑、相同前缀的后续步骤会额外提速，实测延迟里也体现了这一点（baseline 第二次同类请求偏快）。
- 附带验证：纯文本请求带 `thinking:{type:"disabled"}` 同样生效；成功响应头不含 `X-RateLimit-*` 字段。

### 1.3 在 Midscene 中的注入方式（源码已验证）

链路：`MIDSCENE_MODEL_EXTRA_BODY_JSON` → `parseOpenaiSdkConfig()` 解析为 `modelConfig.extraBody`（`@midscene/shared/src/env/parse-model-config.ts:232`）→ `requestBodyParams = { ...adapterParams, ...modelConfig.extraBody }`（`@midscene/core/dist/lib/ai-model/service-caller/openai/chat-completion/chat-completion.js:55-58`，**extraBody 最后合并，覆盖 adapter 默认**）→ 原样进入 OpenAI SDK `chat.completions.create` body（`non-stream.js:34-38`）。

Midscene 1.13 的模型族适配器（`core/dist/lib/ai-model/models/kimi.js` + `registry.js`）：

| 配置 | 实际发送 | 说明 |
|---|---|---|
| `MIDSCENE_MODEL_FAMILY=kimi`（PoC 当前） | `thinking:{type:"disabled"}`（默认！） | `reasoningEnabled ?? false`；设 `MIDSCENE_MODEL_REASONING_ENABLED=true` 才开思考。该族声明不支持 `reasoningEffort` 用户配置 |
| `MIDSCENE_MODEL_FAMILY=kimi3` | `reasoning_effort: <MIDSCENE_MODEL_REASONING_EFFORT>` | 该族不支持 `reasoningEnabled` |
| `MIDSCENE_MODEL_EXTRA_BODY_JSON={"thinking":{"type":"disabled"}}` | 覆盖一切 | 对任意族生效，优先级最高 |
| `MIDSCENE_MODEL_EXTRA_BODY_JSON={"reasoning_effort":"low"}` | 直接注入 | kimi 族下绕过 adapter 限制的可行路径 |

**推荐接入配置（二选一）**：
- 保持 `family=kimi`（默认已禁思考），无需任何 extraBody；想开思考时 `MIDSCENE_MODEL_REASONING_ENABLED=true`。
- 若想保留思考但降强度：`MIDSCENE_MODEL_EXTRA_BODY_JSON={"reasoning_effort":"low"}`。

### 1.4 准确率评估方法与建议档位

两个样例不足以证明禁用思考对所有定位都安全。正式接入前建议建一个小型评测集：

1. **评测集**：20–30 条定位任务，取自真实产品页面截图，覆盖：小目标（图标/小字）、密集列表项（顺序敏感）、弹窗/遮挡、首屏外元素。每条标注目标元素 bbox。
2. **方法**：同一截图分别跑 `disabled` / `reasoning_effort=low` / 默认 max，各 3 次。统计：首击命中率（返回坐标落在 bbox 内）、P50/P95 延迟、单步 token 成本。
3. **判定**：disabled 命中率不低于 max 档位 5 个百分点即采用 disabled；否则定位类用 low、规划类保留 max。
4. **建议起步档位**：
   - 定位类（aiTap/aiLocate 的 locate 阶段）、断言/查询（aiAssert/aiQuery）：**thinking disabled** 起步——这类任务靠视觉grounding，思考收益小（本次两例均正确）。
   - 规划类（aiAct 的 plan 阶段，多步流程编排）：先保留 `reasoning_effort=low` 对比命中率，再决定是否也禁掉。
5. **线上护栏**：接入后记录每步 `reasoning_tokens` 与延迟，若禁用思考的步骤出现定位失败率上升，按用例维度回退到低档思考。

---

## 2. Midscene 1.x 执行缓存

来源：官方文档 `apps/site/docs/zh/caching.mdx`（web-infra-dev/midscene@main）+ 源码 `packages/core/src/agent/task-cache.ts`、`packages/core/src/agent/utils.ts`、`packages/web-integration/src/common/cache-helper.ts`。

### 2.1 两种配置方式

| 方式 | 配置 | 状态 |
|---|---|---|
| 新方式（推荐） | Agent 构造参数 `cache: { id, strategy }` | 当前官方推荐 |
| 旧方式（兼容） | 环境变量 `MIDSCENE_CACHE=1` + 构造参数 `cacheId` | 等价于 read-write，不推荐 |

`strategy` 四档：
- **不配置 / `cache: false`**：禁用（默认）。
- **`read-write`（默认策略）**：`cache: { id: "xxx" }` —— 读已有缓存，执行中自动更新文件。适合本地迭代。
- **`read-only`**：只读不落盘，需手动 `agent.flushCache()` 写入。适合 CI/生产，保证缓存一致性（配合 `testInfo.status === 'passed'` 才 flush 的模板）。
- **`write-only`**：只写不读，每次仍调 AI。适合首次建缓存/强制重建。

Playwright Fixture（`PlaywrightAiFixture`）下 `cache: true` 会自动按测试信息生成 cache id；直接 new Agent 时必须显式给 id（`cache: true` 会抛错）。

### 2.2 缓存键与存储

- **键 = `type`（`plan` | `locate`）+ prompt 的深度相等**（`isDeepStrictEqual`，`task-cache.ts` `matchCache()`）。**键里不含页面 DOM/截图/URL 哈希** —— 页面变化不会让键失配，靠缓存值的运行时校验兜底（见 2.3）。
- **存储**：`./midscene_run/cache/<cacheId>.cache.yaml`（可用 `cache.cacheDir` 改目录；id 超长自动截断+hash）。文件头带 `midsceneVersion`，**< 0.16.10 的旧缓存直接拒读**。
- **存什么**：
  - `plan` 缓存：AI 规划出的 `yamlWorkflow`（完整执行流）。写库前校验非空 flow，空 flow 视为 miss。
  - `locate` 缓存：元素的 `ElementCacheFeature`（XPath 列表；旧格式 xpaths 字段自动迁移）。
- **永不缓存**：`aiQuery` / `aiAssert` / `aiBoolean` 等查询类操作 —— 这些步骤即使全缓存命中也仍然调模型（优化思考强度对它们仍然重要）。

### 2.3 页面变化后的失效行为

- **locate 缓存**：命中后先用 `rectMatchesCacheFeature` 把缓存 XPath 重新解析成 rect；解析失败（元素消失/结构变化）→ 自动回退 AI 重定位并更新该条缓存。若用缓存元素执行动作失败触发 replan，该条被标记 stale，重定位结果**原位替换**而非追加（防止下次又命中坏条目，issue #2529）。
- **plan 缓存**：回放中途失败（如偶现弹窗没出现）→ 本次回退到 AI 重新规划，但**回退结果不写回该 prompt 的缓存**（部分步骤已改变页面状态，新 flow 对初始页面未必成立）；下次运行该 prompt 视为 miss 重新生成。
- **手动清理**：`agent.flushCache({ cleanUnused: true })` 保留「本次用到的 + 新增的」，删除其余旧条目。适合 UI 改版后重建缓存。
- **结论**：页面小改（元素移动但 XPath 仍解析得到）→ locate 缓存仍命中；结构变化 → 单步失效自动重建，不会整体雪崩；但 **plan 缓存在页面流程变化后可能回放过期流程**，靠失败回退兜底，UI 大改版建议删缓存重建。

### 2.4 回归重放场景推荐配置

- 本地开发/录制：`new PlaywrightAgent(page, { cache: { strategy: "read-write", id: "<用例集名>-<环境>" } })`。
- CI 回归：`read-only`，`afterEach` 中测试通过才 `flushCache({ cleanUnused: true })`；缓存文件提交仓库或作为 CI artifact 传递（官方 FAQ 明确：CI 命中需要把缓存文件提交进仓库）。
- cache id 按「用例集 × 被测环境」命名（不同环境域名/数据不同，prompt 虽相同但流程可能不同）。
- **命中预期**：页面无变化时 plan + locate 全命中，剩余模型调用只有 query/assert；官方示例 51s→28s。叠加思考禁用（本调研第 1 节）后，缓存未命中步骤也能再快 2–4 倍。

---

## 3. 批量执行节流

### 3.1 端点限制现状

- Kimi Code 订阅（api.kimi.com/coding，随 Kimi 会员的 Kimi Code 权益）与 Kimi 开放平台（platform.kimi.com，按量计费）**是相互独立的产品和限速体系**（官方 product-plans 文档明示）。
- **订阅端点的 RPM/并发官方数字未公开**（文档与公开检索均无）。开放平台 Tier 表（Tier1 并发15/RPM100，Tier5 并发100/RPM300）不适用，仅可作量级参考。
- 实测：5 并发小请求全部 HTTP 200、无 429，成功响应无 `X-RateLimit-*` 头（订阅端点应在触发限制时返回 429，按开放平台文档 429 响应会带限流头）。
- 订阅制产品通常按**用量窗口**（小时/周级额度）而非 RPM 计费限流，突刺流量比匀速流量更危险。

### 3.2 服务端队列建议

| 参数 | 建议值 | 依据 |
|---|---|---|
| 全局并发 | **3**（保守起步），观察无 429 后升至 5 | 实测 5 并发无 429；留余量防用量窗口风控 |
| 请求间隔 | ≥ 200ms（队列出队节流） | 避免瞬时突刺 |
| 用例编排 | 用例间串行/小并发，单用例内步骤天然串行（步骤间有页面状态依赖） | Midscene 步骤本身必须顺序执行 |
| 重试 | 429/5xx/网络错误：指数退避 1s→2s→4s，**≤3 次**，带 jitter | Midscene 内置 `MIDSCENE_MODEL_RETRY_COUNT`（默认1）/`MIDSCENE_MODEL_RETRY_INTERVAL`（默认2000ms），建议 `RETRY_COUNT=3` |
| 超时 | `MIDSCENE_MODEL_TIMEOUT` ≥ 60s（max 思考下单步曾达 19s；禁思考后可降到 30s） | PoC 实测区间 |
| 灰度 | 首次批量跑一个用例集时先 5–10 条小批量观察 429/额度消耗，再放量 | 限速数字未公开 |
| 兜底 | 触发持续 429 时整体暂停并告警（用量窗口可能耗尽），而非继续退避 | 订阅制窗口耗尽只能等重置 |

---

## 4. 风险与遗留问题

1. **禁用思考的准确率未充分验证**：仅 2 个定位样例（均正确），不足以覆盖复杂页面。→ 按 1.4 节建评测集后再全量启用；先灰度。
2. **`thinking:{type:"disabled"}` 在 K2.8 coding 端点属未文档化行为**：模型元数据标 `supports_thinking_type:"only"`、同系 k2.7-code 文档明确 disabled 报错。端点行为可能随版本收紧。→ 接入时加冒烟检查（断言响应 `reasoning_tokens==0` 或单步延迟阈值告警），失效时自动回退 `reasoning_effort=low`。
3. **PoC 4–19s/步的真实构成未分解**：`family=kimi` 下 Midscene 1.13 默认已发 `thinking:{type:"disabled"}` —— 若 PoC 运行时该配置已生效，则慢的主因不是思考而是 **prompt 体积**（截图 + 页面元素树，prompt 处理）与**规划输出长度**。→ 用 `DEBUG=ai:call` 打印实际请求体确认思考是否真被禁用、prompt tokens 量级；若 thinking 已禁用，则优化空间主要在缓存命中率与 prompt 精简，思考参数无进一步提升空间。
4. **缓存键与页面内容无关**：plan 缓存在页面流程变化后可能回放过期流程（靠失败回退兜底）。UI 大改版后应删除对应 cacheId 文件重建；缓存文件随版本升级（<0.16.10 不兼容）也需重建。
5. **订阅端点限速/额度规则不透明**：可能按用量窗口限流，批量跑长时间占用需先小批量灰度；持续 429 只能等窗口重置。
6. **extraBody 注入 `reasoning_effort` 绕过了 kimi 族 adapter 声明的「不支持」**：升级 Midscene 版本时需回归验证该路径（adapter 声明变化可能影响合并行为）。
7. **k3 / kimi-for-coding-highspeed 备选未实测**：K3 默认 effort=high 且原生支持 `reasoning_effort`（family=kimi3 路径最干净）；highspeed 款可能延迟更低。若 K2.8 禁思考行为被收紧，可切换备选模型，需另行评估定位准确率。
