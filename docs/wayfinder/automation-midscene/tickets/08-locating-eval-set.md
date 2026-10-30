---
title: 建立定位评测集并冒烟验证思考档位配置
type: task
status: closed
assignee: null
blocked_by: []
---

## Question

票据「Kimi K2.8 延迟成本与执行缓存调研」实测 `thinking:{type:"disabled"}` 可将定位调用从 6–8s 降到 2–3s 且坐标正确，但这属于未文档化行为（模型元数据标 thinking "only"，未来可能收紧），且禁思考后的定位准确率只验证了 2 例。正式配置定型前需要：

1. **建评测集**：20–30 条 UI 定位任务，取自真实产品页面截图，覆盖小目标（图标/小字）、密集列表项（顺序敏感）、弹窗/遮挡、首屏外元素；每条标注目标元素 bbox（可用 artifacts/midscene-poc 环境 + 本站页面截图）
2. **三档对比**：`disabled` / `reasoning_effort=low` / 默认 max，各跑 3 次，统计首击命中率（坐标落 bbox 内）、P50/P95 延迟、单步 token 成本
3. **判定**：disabled 命中率不低于 max 档 5 个百分点即采用 disabled；否则定位类用 low、规划类保留 max
4. **服务端冒烟检查**：启动时验证当前档位的定位调用正常，异常时回退 low 档（防御未文档化行为被收紧）
5. 评测数据与最终推荐档位记入 Resolution

## Resolution

2026-09-21 完成评测。**判定：定位链路采用 `thinking:{type:"disabled"}`（即保持 `MIDSCENE_MODEL_FAMILY=kimi` 默认，不加任何 extraBody）**。三档在 20 个可定位任务上命中率同为 100%（差距 0 个百分点，满足「不低于 max 档 5pp」判据），disabled 档 P50 延迟仅为 max 档的 40%。

### 1. 评测集与方法

- **24 条定位任务**，全部取自本站真实页面（http://localhost:5199，1440×900 视口、DPR=1）：小目标 6（13px 导航小字、31×31 关闭图标、12px 小按钮、Logo）、密集列表 6（JMeter 模板卡片网格 ×3、供应商预设网格 ×2、报告类型横排按钮）、弹窗/遮挡 4（错误弹窗按钮/标题、添加项目弹窗输入框/取消按钮）、首屏外 4、中文文案 4。
- **真值 bbox 确定性获取**：Playwright 选择器/getByRole 定位后 `getBoundingClientRect()` 记录（`collect.mjs` → `tasks.json` + 每任务参考截图），无人工标注误差；全部任务 scroll=0，视口坐标=页面坐标。
- **真实链路测量**：`PlaywrightAgent.aiLocate()`（生产路径，含截图+单次模型调用），不用裸 curl。每档每任务 2 次，共 **144 次 API 调用（≤150 预算，无重试）**。
- 资产：`artifacts/midscene-eval/`（已 gitignore）——`tasks.mjs`（任务定义）、`collect.mjs`、`run.mjs`、`stats.mjs`、`tasks.json`、`results-{tier}.jsonl`、`screenshots/`、`ai-call-{tier}.log`（每档实际发送参数与响应原文）。

### 2. 三档配置（含一处重要修正）

| 档 | 环境变量 | 实际发送（ai-call.log 实证 48/48） |
|---|---|---|
| disabled | 仅 `.env`（family=kimi 默认） | `thinking:{type:"disabled"}` |
| low | `MIDSCENE_MODEL_REASONING_ENABLED=true` + `MIDSCENE_MODEL_EXTRA_BODY_JSON={"reasoning_effort":"low"}` | `thinking:{type:"enabled"}` + `reasoning_effort:"low"` |
| max | `MIDSCENE_MODEL_REASONING_ENABLED=true` | `thinking:{type:"enabled"}`（端点默认 effort=max） |

**修正（对研究票 03 §1.3 表格第 4 行）**：只设 `MIDSCENE_MODEL_EXTRA_BODY_JSON={"reasoning_effort":"low"}` 而不开 REASONING_ENABLED 是**无效档**——kimi 族 adapter 恒写 `thinking` 字段（默认 disabled），extraBody 只追加不删除，`thinking:disabled` 存在时 `reasoning_effort` 不生效。low 档必须两个变量同时设。

档位生效证据（ai-profile-stats.log 按时间窗统计）：平均 completion tokens **disabled 25 / low 144 / max 226**（输出 JSON 约 25 tokens，余为 reasoning），三档清晰分离；low 档 reasoning 内容明显短于 max。prompt tokens 三档均约 2300，端点 prompt 缓存平均命中约 1150 tokens（≈50%）。

### 3. 总体结果（24 任务 × 2 次 = 48 样本/档）

| 档 | 可定位任务命中率（20 任务，判定指标） | 全量命中率 | P50 | P95 | 平均 | 平均 completion tokens |
|---|---|---|---|---|---|---|
| disabled | **40/40 = 100%** | 42/48 | **2198ms** | **2902ms** | **2184ms** | 25 |
| low | 40/40 = 100% | 42/48 | 4608ms | 7144ms | 4760ms | 144 |
| max | 40/40 = 100% | 42/48 | 6273ms | 11149ms | 6214ms | 226 |

disabled 比 low 快 2.2×（mean），比 max 快 2.8×；P95 差距更大（2.9s vs 11.1s，max 档尾延迟显著）。

### 4. 分类命中率（每格：命中/样本，均为 2 次 × 任务数）

| 类别 | disabled | low | max | 备注 |
|---|---|---|---|---|
| 小目标（6） | 12/12 | 12/12 | 12/12 | 含 31×31 纯图标 X、13px 小字，无一档失手 |
| 密集列表（6） | 12/12 | 12/12 | 12/12 | 模板网格/预设网格/横排按钮顺序全部正确 |
| 弹窗/遮挡（4） | 8/8 | 8/8 | 8/8 | 半透明遮罩上的元素定位不受影响 |
| 中文文案（4） | 8/8 | 8/8 | 8/8 | |
| 首屏外（4） | 2/8 | 2/8 | 2/8 | 行为三档完全一致，见 §5 |

### 5. 首屏外行为（重要副产品结论）

`aiLocate` 截图仅含视口（`base-page.js screenshotBase64()` 无 fullPage），屏外元素不可见。三档表现逐点一致：

- **真·不可见目标（off-card-05 @y=2390、off-footer-github @y=2890）**：三档全部干净报错 `failed to locate element`，**零幻觉坐标**。
- **部分可见目标（off-tpl-new，卡面上缘 62px 在视口内）**：三档全部命中可见部分。
- **诱饵任务（off-pill-ra）**：任务设计缺陷——首页 hero 区恰有一枚可见的「需求分析」装饰 pill（@300,545），与屏外的工具矩阵 pill 同名。三档 6 次全部返回可见诱饵坐标（[298,540]~[314,550]），即模型偏好「可见的匹配元素」而非猜测屏外内容——对截图定位器而言这是合理行为，教训是**评测/生产 prompt 需排除同名歧义**。

结论：不可见目标上模型如实报「找不到」，幻觉率与思考档位无关；生产流程中屏外元素应先滚动（aiAct 规划或显式 scroll），把 `failed to locate` 当作正常信号处理。

### 6. 最终推荐档位

- **定位类（aiLocate/aiTap 的 locate 阶段）**：`disabled`（family=kimi 默认，零配置）。命中率与 max 持平（100% vs 100%），P50 2.2s、P95 2.9s，单步 completion tokens 降至 1/9。
- **断言/查询类（aiAssert/aiQuery）**：同属视觉 grounding 主导，建议同用 disabled（研究票 03 建议一致）；本评测未覆盖，接入后按用例维度观察。
- **规划类（aiAct plan 阶段）**：本评测未覆盖规划链路；PoC 在 family=kimi（默认 disabled）下已端到端跑通，但规划质量收益未量化。如需保守可 `REASONING_ENABLED=true + reasoning_effort=low`，待规划专项评测后再定。
- **线上护栏**：记录每步延迟与 completion tokens；disabled 档单步 P50 若持续 >5s 或 completion tokens 异常升高（说明 disabled 被端点静默忽略、思考被打开），按用例维度回退 low 档并告警。

### 7. 服务端冒烟检查方案（启动时金丝雀 + 异常回退 low）

最小实现（独立模块，不侵入现有源码；启动时在接收任务前 await 一次）：

```ts
// locating-smoke.ts — 启动金丝雀：验证定位链路当前档位可用，异常自动回退 low
import { chromium } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';

// 固定金丝雀页面：data: URL 自带真值，不依赖被测系统状态
const CANARY_URL = `data:text/html,<body style="margin:0">` +
  `<button style="position:absolute;left:120px;top:80px;width:100px;height:40px">OK</button></body>`;
const CANARY_BBOX = { x: 120, y: 80, w: 100, h: 40 };

async function canary(page: Page): Promise<{ hit: boolean; latencyMs: number }> {
  await page.goto(CANARY_URL);
  const agent = new PlaywrightAgent(page); // 与生产同一路径
  const t0 = Date.now();
  const { center } = await agent.aiLocate('页面中的「OK」按钮');
  const latencyMs = Date.now() - t0;
  const [x, y] = center ?? [-1, -1];
  const hit = x >= CANARY_BBOX.x && x <= CANARY_BBOX.x + CANARY_BBOX.w &&
              y >= CANARY_BBOX.y && y <= CANARY_BBOX.y + CANARY_BBOX.h;
  return { hit, latencyMs };
}

export async function locatingSmokeCheck(): Promise<{ tier: 'disabled' | 'low'; latencyMs: number }> {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  try {
    const first = await canary(page); // 默认档：family=kimi → thinking disabled
    if (first.hit && first.latencyMs <= 10_000) return { tier: 'disabled', latencyMs: first.latencyMs };
    console.warn('[locating-smoke] disabled 档异常（未文档化行为可能被收紧），回退 reasoning_effort=low', first);
    process.env.MIDSCENE_MODEL_REASONING_ENABLED = 'true';
    process.env.MIDSCENE_MODEL_EXTRA_BODY_JSON = '{"reasoning_effort":"low"}';
    const second = await canary(page);
    if (!second.hit) throw new Error('定位链路在 low 档亦不可用，拒绝启动');
    return { tier: 'low', latencyMs: second.latencyMs };
  } finally {
    await browser.close();
  }
}
```

要点：
- 金丝雀用 data: URL 固定页面 + 内置真值 bbox，30 秒内心智成本一次调用（disabled 档约 1–2s）。
- 覆盖的失效模式：端点对 `thinking:disabled` 返 4xx（收紧的直接信号）、坐标解析失败、坐标漂移出真值、超时/延迟越阈（>10s 视为 disabled 被静默忽略）。
- 回退后的 tier 写入日志并暴露在健康检查里；Midscene 或模型版本升级后必须重跑（extraBody 注入路径依赖 adapter 合并行为，研究票 03 风险 6）。

### 8. 遗留

- 规划链路（aiAct plan）三档评测未做，如需禁用规划思考另开票据。
- `thinking:disabled` 仍是未文档化行为：冒烟检查 + §6 护栏是当前的防御手段；若被收紧且 low 档也不可用，备选模型（k3 / kimi-for-coding-highspeed）评估见研究票 03 风险 7。
- 评测时本站后端未运行（错误弹窗恰被用作弹窗类任务素材）；后端可用后页面布局不变，真值仍有效，但弹窗类任务需改用其他弹层复测。
