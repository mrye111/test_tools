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
  /** 数据表孪生：任何色编码都得有等价的可读通路。 */
  table?: { columns: string[]; rows: (string | number)[][] };
}

/** 单张图（= 图表选型；命名上与文档槽位区分）。 */
export type FigureSlot = ChartSelection;

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

/**
 * 报告槽位 JSON（B 层）：模型只写「什么」，服务端决定「什么样」。
 * charts 是平铺图序，sections.figureIndexes 引用其下标做分章排布。
 */
export interface ReportDraft extends ReportSelection {
  /** 眉题两段：[项目名 · 测试报告, 报告类型 / 轮次] */
  kicker?: [string, string];
  verdict?: { stamp: "crit" | "warn" | "good"; label: string; text: string };
  meta?: { label: string; value: string }[];
  findings?: { tag: "crit" | "warn" | "good" | "mute"; label: string; text: string }[];
  kpi?: {
    hero: {
      label: string;
      value: string;
      unit?: string;
      meterPct?: number;
      threshold?: number;
      thresholdLabel?: string;
      note?: string;
    };
    tiles: { label: string; value: string; unit?: string; delta: string; deltaTone: "good" | "bad" | "flat" }[];
  };
  sections?: { num: string; title: string; lede?: string; figureIndexes: number[] }[];
  detail?: { num: string; title: string; sub?: string; columns: string[]; rows: (string | number)[][] };
  appendix?: { num: string; title: string; items: { term: string; text: string }[] };
  colophon?: [string, string, string];
}

/** 各图型的数据形状（选图阶段 prompt 用：模型按此填 data，服务端原样注入片段 __DATA__）。 */
const DATA_SHAPES: Record<string, string> = {
  F11: "{rows:[[名称, 值0-100, 阈值, 状态键],…] 1-6 行}；状态键 good|warn|crit",
  F4: "[[名称, 条数, 状态键, 标记],…] ≤6 段；状态键 good|warn|crit|mute，段序须 STATUS.order",
  L14: "[[名称, 单位数, 状态键, 标记],…] ≤6 类；同上",
  F5: "[[名称, 值, 是否风险焦点],…] ≤8 行；恰好一个 true",
  L4: "{rows:[严重度…], cols:[状态…], cells:[[计数],…]}",
  F2: "{days:[日期…] ≤30, add:[每日新增…], close:[每日关闭…]}；两系列同单位",
  F1: "[[名称, 值],…] ≤8 行",
  F6: "[[名称, 上轮, 本轮],…] ≤8 行",
  F7: "{rows:[[类目,[段1,段2,段3]],…] ≤4 类, segs:[[段名, 色键],…] ≤3 段}；色键 good|warn|crit|mute|ink|mid|pale",
  F9: "[[类目, 取值, 标记],…] ≤6 级；首级标 'start'、末级标 'total'、其余 null",
  F10: "{days:[星期…], cells:[[计数],…]} 7 行 × 12 列",
  L3: "[每日读数,…] 90 天级",
  L5: "{hubs:[[归属名, 条数, 角度],…] ≤5 个}；角度均分圆周",
  L12: "{items:[逐条名称,…] ≤50, teams:[归属名,…], assign:[归属下标,…]}",
  G7: "{name, children:[{name, children:[…]},…]} 2-3 层",
  G15: "{cats:[分组名,…], groups:[[[x,y],…],…]} 逐条记录几百点",
};

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
    .map((d) => {
      const shape = DATA_SHAPES[d.code] ?? "";
      return `${d.code} ${d.name}（${d.cardTitle}）：${d.contract}${d.echarts ? "【需 ECharts】" : ""}${shape ? `\n    data 形状：${shape}` : ""}`;
    })
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
**你只输出槽位 JSON，不输出 HTML。** 版式由服务端模板拼装，你负责「写什么」，不负责「长什么样」。

\`\`\`json
{
  "title": "结论式报告标题（不是图型名、不是名词短语）",
  "kicker": ["项目名 · 测试报告", "报告类型 / 轮次"],
  "verdict": { "stamp": "crit|warn|good", "label": "通过|有条件通过|不通过", "text": "一句话结论：规模 + 结果 + 卡点，≤60 字" },
  "meta": [ { "label": "Project|Build|窗口|数据源|范围|执行|负责人|生成", "value": "取值" } ],
  "findings": [
    { "tag": "crit|warn|good|mute", "label": "阻塞|关注|达标|待补", "text": "一句话 + 关键 BUG/用例 ID" }
  ],
  "kpi": {
    "hero": { "label": "通过率 · 单位", "value": "92.2", "unit": "%", "meterPct": 92.2, "threshold": 95, "thresholdLabel": "发版线 95%", "note": "口径 · 分子分母 · 与阈值的差距" },
    "tiles": [ { "label": "指标名", "value": "128", "unit": "条", "delta": "▲ 23 环比上轮", "deltaTone": "good|bad|flat" } ]
  },
  "charts": [
    {
      "code": "图型编号",
      "title": "该图结论式标题",
      "sub": "副标题：单位口径 · 图例 · 范围，用 · 分隔",
      "source": "来源行（图型名 · 系列 · 数据来源）",
      "data": "按该图型的 data 形状给真实数据",
      "table": { "columns": ["列名", "…"], "rows": [["值", "…"]] }
    }
  ],
  "sections": [ { "num": "§ 02", "title": "章节名", "lede": "1–2 句导语：本章回答什么", "figureIndexes": [0, 1] } ],
  "detail": { "num": "§ 03", "title": "缺陷 / 条目明细", "sub": "排序口径", "columns": ["ID","标题","严重度","状态","模块","负责人","日期"], "rows": [["…"]] },
  "appendix": { "num": "§ A", "title": "口径与免责", "items": [ { "term": "通过率", "text": "定义与边界" } ] },
  "colophon": ["项目 · 测试报告 · 类型", "版本 · 轮次", "Generated 时间"]
}
\`\`\`

缺数占位条目（放在 charts 末尾，figureIndexes 不引用它）：
\`{ "code": "PLACEHOLDER", "missing": "缺数标识（如 pass-rate / trend）", "title": "占位卡标题", "need": "缺什么数据 · 补齐后能画什么" }\`

## 规则
- \`charts\` 数量 2–6 张，每张承担一个独立结论，不重复；占位条目最多 2 张且放在末尾。
- \`sections[].figureIndexes\` 是 \`charts\` 的下标（占位条目除外），用于分章排布；未被引用的图会被排到末尾兜底，但请显式分章。
- **每张图必须给 \`table\` 数据表孪生**（≤12 行）：任何色编码都得有等价的可读通路。
- \`kpi\` 里的 \`hero\` 全篇至多一个；素材没有定量数据就整个省略 \`kpi\`，**绝不编一个 hero**。
- \`detail\` 在素材含逐条记录时必出；列按上面的七列。
- 色彩铁律（体现在 data 里就是**用语义键，不写颜色字面量**）：量与序走灰阶明度，状态用 good/warn/crit/mute 键，且状态段序固定 通过|阻塞|失败|跳过（绿红不得相邻）。
- 数据诚实红线（违反即返工）：图中每个数字必须能溯源到素材原文或素材中的真实条目计数，禁止编造指标；素材没有定量数据时用 PLACEHOLDER 占位。
- 占比类图表的数字必须加总为 100 或真实条目总数。
- 全部使用中文（图型名等专业词汇除外）。`;


  return [
    { role: "system", content: system },
    { role: "user", content: `报告素材：\n\n${input.sourceText}` },
  ];
}

/** 修复重试指令（选图阶段）。 */
export const SELECTION_REPAIR_INSTRUCTION =
  "你上一次的输出无法解析为符合契约的 JSON。请仅输出修正后的完整 JSON 对象：不要解释文字、Markdown 代码块标记；charts 中每个 code 必须在允许清单内或为 PLACEHOLDER；确保 JSON 完整闭合。";
