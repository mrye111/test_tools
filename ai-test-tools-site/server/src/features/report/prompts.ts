import { descriptorsFor } from "./chart-catalog.js";
import type { ReportType, ReportSourceType } from "./types.js";

/** 管线消息类型（与 testcase/ai.ts 的 ChatMessage 对齐） */
export type PipelineMessage = { role: "system" | "user" | "assistant"; content: string };

/** 选图阶段产出的单个图表选型（严格 JSON 契约）。 */
export interface ChartSelection {
  code: string;
  title: string;
  sub: string;
  source: string;
  data: unknown;
}

/** 缺数占位选型：code 固定为 PLACEHOLDER。 */
export interface PlaceholderSelection {
  code: "PLACEHOLDER";
  missing: string;
  title: string;
  need: string;
}

export interface ReportSelection {
  title: string;
  charts: (ChartSelection | PlaceholderSelection)[];
}

const REPORT_TYPE_GUIDE: Record<ReportType, string> = {
  summary: "测试总结报告：面向一轮测试执行的完整总结。叙事顺序建议：总体结论（通过率/进度）→ 用例分布 → 缺陷构成与归属 → 执行漏斗或趋势。",
  brief: "快速简报：面向几句话的定性描述。只出结构图：测试重点层级（G7）、条目归类计数（F5）、风险/待澄清清单归属（L12）。严禁编造任何指标数字。",
  defect: "缺陷分析报告：面向 BUG 数据复盘。叙事顺序建议：严重度 × 状态矩阵（L4）→ 模块归属（L5/L12）→ 严重度构成 → 时间序列或解决时长分布。",
  free: "自由报告：根据素材内容自行判断最合适的叙事结构。",
};

/** 选图阶段 system prompt：只产出选型 JSON，不写 HTML。 */
export function buildSelectionMessages(input: {
  reportType: ReportType;
  sourceType: ReportSourceType;
  sourceText: string;
}): PipelineMessage[] {
  const descriptors = descriptorsFor(input.reportType);
  const chartList = descriptors
    .map((d) => `${d.code} ${d.name}（${d.cardTitle}）：${d.contract}${d.echarts ? "【需 ECharts】" : ""}`)
    .join("\n");

  const system = `你是测试报告信息设计师，遵循 lieflat-charts 视觉体系。你的任务是为一份${input.reportType === "brief" ? "快速简报" : "测试报告"}做选图与数据映射，只输出严格 JSON，不输出任何其他内容。

## 报告类型指引
${REPORT_TYPE_GUIDE[input.reportType]}

## 可用图型（只允许使用以下编号）
${chartList}

## 数据诚实红线（违反即返工）
- 图中的每个数字必须能溯源到素材原文或素材中的真实条目计数，禁止编造指标。
- 素材没有定量数据时，对应图表用占位选型，不得虚构。
- 占比类图表（F4/L14/F7）的数字必须加总为 100 或真实条目总数。

## 输出 JSON 契约（严格）
{
  "title": "报告标题（结论式，不是图型名）",
  "charts": [
    {
      "code": "图型编号",
      "title": "该图结论式标题",
      "sub": "副标题：单位口径 · 图例 · 范围，用 · 分隔",
      "source": "来源行（图型名 · 系列 · 数据来源）",
      "data": "该图的真实数据（对象或数组，字段命名清晰，数值来自素材）"
    }
  ]
}
缺数占位条目：
{ "code": "PLACEHOLDER", "missing": "缺数标识（如 pass-rate / trend / severity-dist）", "title": "占位卡标题", "need": "需要补录的数据清单" }

## 规则
- charts 数量 2–6 张，每张承担一个独立结论，不重复。
- 占位条目最多 2 张，放在最后。
- 全部使用中文（图型名等专业词汇除外）。`;

  return [
    { role: "system", content: system },
    { role: "user", content: `报告素材：\n\n${input.sourceText}` },
  ];
}

const SKELETON_CONTRACT = `## 单文件 HTML 骨架契约
\`\`\`html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>{报告标题}</title>
<!-- 仅当选型包含 G7/G15 时引入： --><!-- <script src="https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js"></script> -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>/* 内联 MONO.CARD_CSS；另加 .card-placeholder 样式 */</style>
<style>
@media print {
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .card { break-inside: avoid; }
  .pop,.fade,.draw { animation: none !important; }
}
</style>
</head>
<body>
<div class="grid2">
  <div class="card">
    <h2>{结论式标题}</h2>
    <div class="sub">{单位口径 · 图例 · 范围}</div>
    <svg id="ch1" viewBox="0 0 400 320"></svg>
    <div class="src">{图型名 · 系列 · 来源}</div>
  </div>
  <!-- 缺数占位卡： -->
  <!-- <div class="card card-placeholder" data-missing="pass-rate">
    <h2>{标题}</h2>
    <div class="sub">补数据后可解锁</div>
    <p class="placeholder-need">{需要的数据清单}</p>
    <div class="src">PLACEHOLDER</div>
  </div> -->
</div>
<script>/* 内联 mono-tokens 全文 */</script>
<script>/* 各图渲染代码：以注入的图型片段为骨架，替换数据与元素 id */</script>
</body>
</html>
\`\`\`

## 硬规则
- 每个 .card 必须有 h2 + .sub + 图容器 + .src 四件套；标题写结论不写图型名。
- 整份 HTML 只用一套色彩系统（Mono 灰阶；wire 时可加一个强调色 #F5572F 标唯一主角）。
- 占位卡（data-missing）内禁止出现 svg/canvas/echarts 实例，只能有文字说明。
- 数值与视觉严格成正比；面积编码用 sqrt 换算半径。
- reveal 用 MONO.obsReveal（滚入播放 + 点击重播）；演示抖动用 MONO.rnd，禁止 Math.random()。
- 外链白名单：仅 echarts@6 CDN 与 Google Fonts，其余一律不得出现。
- 动画带 prefers-reduced-motion 降级（MONO.CARD_CSS 已含）。`;

/** 组装阶段 prompt：注入 mono-tokens 全文 + 选中图型的真实渲染片段。 */
export function buildAssemblyMessages(input: {
  reportType: ReportType;
  selection: ReportSelection;
  monoTokens: string;
  fragments: { code: string; text: string }[];
  sourceText: string;
}): PipelineMessage[] {
  const fragmentSection = input.fragments
    .map((f) => `### 图型片段 ${f.code}\n\`\`\`js\n${f.text}\n\`\`\``)
    .join("\n\n");

  const system = `你是 lieflat-charts 报告排版引擎。根据选型 JSON 与注入的图型片段，组装一份单文件 HTML 测试报告。

${SKELETON_CONTRACT}

## mono-tokens.js 全文（内联进第一个 <script>）
\`\`\`js
${input.monoTokens}
\`\`\`

## 选中图型的真实渲染片段（以此为核心骨架，保留几何、编码与动效；替换数据与元素 id）
${fragmentSection}

只输出完整 HTML，不要任何解释文字或 Markdown 代码块标记。`;

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `选型 JSON：\n\`\`\`json\n${JSON.stringify(input.selection, null, 2)}\n\`\`\`\n\n原始素材：\n\n${input.sourceText}`,
    },
  ];
}

/** 修复重试指令（选图阶段）。 */
export const SELECTION_REPAIR_INSTRUCTION =
  "你上一次的输出无法解析为符合契约的 JSON。请仅输出修正后的完整 JSON 对象：不要解释文字、Markdown 代码块标记；charts 中每个 code 必须在允许清单内或为 PLACEHOLDER；确保 JSON 完整闭合。";

/** 修复重试指令（组装阶段）：携带校验问题清单。 */
export function buildAssemblyRepairInstruction(issues: string[]): string {
  return `你上一次输出的 HTML 未通过静态校验，问题如下：\n${issues.map((i) => `- ${i}`).join("\n")}\n请仅输出修正后的完整 HTML（从 <!doctype html> 开始），不要解释文字或 Markdown 代码块标记。`;
}
