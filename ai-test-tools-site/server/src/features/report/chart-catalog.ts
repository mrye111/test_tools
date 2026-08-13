import type { ReportType } from "./types.js";

/** 白名单图型的紧凑描述（选图阶段 prompt 用；数据契约蒸馏自 lieflat-charts catalog.md） */
export interface ChartDescriptor {
  code: string;
  name: string;
  cardTitle: string;
  contract: string;
  echarts: boolean;
}

/**
 * 一期图型白名单（16 种；L2 Dot Cascade 为暗卡图，按研究结论排除）。
 * 选型顺序硬规则：先 Lupi/Basics，Glance（G7/G15）仅在 Lupi/Basics 无承接时可用。
 */
export const CHART_CATALOG: ChartDescriptor[] = [
  { code: "F11", name: "Tick Gauge", cardTitle: "How far to the quarter's goal", contract: "单值进度 0–100%（通过率/完成率）", echarts: false },
  { code: "F4", name: "Tick Donut", cardTitle: "Where the traffic comes from", contract: "100% 构成 ≤6 段；1 tick = 1%", echarts: false },
  { code: "L14", name: "Hundred Field", cardTitle: "A hundred of us, four minds", contract: "100% 构成 ≤6 类小数据；1 点 = 1 单位（可数）", echarts: false },
  { code: "F5", name: "Tick Rows", cardTitle: "Six teams, shipped and counted", contract: "横向排名比较 ≤8 行，单位可数（模块用例数/缺陷数）", echarts: false },
  { code: "F1", name: "Rung Bars", cardTitle: "Revenue by plan, rung by rung", contract: "竖向少类目比较 ≤8，单位可数", echarts: false },
  { code: "F7", name: "Stacked Rungs", cardTitle: "Where each region's revenue sits", contract: "堆叠构成 ≤4 类 × ≤3 段（优先级 × 状态）", echarts: false },
  { code: "F6", name: "Paired Rungs", cardTitle: "This year against last, plan by plan", contract: "分组对比：每类 2 系列（本轮 vs 上轮）", echarts: false },
  { code: "F9", name: "Rung Waterfall", cardTitle: "From gross to net, step by step", contract: "瀑布/增减分解 ≤6 级（执行→通过→修复→遗留）", echarts: false },
  { code: "F10", name: "Dot Heat", cardTitle: "When support gets loud", contract: "星期×小时×量（小热力；缺陷爆发时段）", echarts: false },
  { code: "F2", name: "Hairline Line", cardTitle: "Thirty days of sign-ups", contract: "日序列 ≤30 天逐日读数（每日新增缺陷）", echarts: false },
  { code: "L3", name: "Barcode Lollipop", cardTitle: "Ninety days as a barcode", contract: "日序列 90 天级，要肌理", echarts: false },
  { code: "L4", name: "Arc Matrix", cardTitle: "Eight products land in twelve cities", contract: "分类×分类+量 ≤100 格（严重度 × 状态矩阵）", echarts: false },
  { code: "L5", name: "Radial Convergence", cardTitle: "48 requests pull toward five themes", contract: "多对一归属不丢明细 ≤60 条（缺陷 → 模块）", echarts: false },
  { code: "L12", name: "Type Colonnade", cardTitle: "Forty-four repos, ten owners", contract: "多对一归属+逐条名单 ≤50 条（风险/条目 → 维度）", echarts: false },
  { code: "G7", name: "Tree LR", cardTitle: "Everything the platform ships", contract: "层级结构 2–3 层（测试范围 → 重点条目）。降级理由：层级从属无权重语义，Lupi/Basics 无承接图型", echarts: true },
  { code: "G15", name: "Jitter Strip", cardTitle: "Response times, spread out", contract: "分组分布逐条记录几百点（逐条缺陷解决时长）。降级理由：F8 散点容量 ≤20 点不足", echarts: true },
];

/** 各报告类型允许的图型子集（选图阶段的硬约束） */
export const REPORT_TYPE_CHARTS: Record<ReportType, string[]> = {
  summary: ["F11", "F4", "L14", "F5", "F7", "L5", "F2", "F9"],
  brief: ["G7", "F5", "L12"],
  defect: ["L4", "L5", "L12", "F4", "F2", "L3", "G15"],
  free: CHART_CATALOG.map((c) => c.code),
};

export function descriptorsFor(reportType: ReportType): ChartDescriptor[] {
  const allowed = new Set(REPORT_TYPE_CHARTS[reportType]);
  return CHART_CATALOG.filter((c) => allowed.has(c.code));
}

export function isChartAllowed(reportType: ReportType, code: string): boolean {
  return REPORT_TYPE_CHARTS[reportType].includes(code);
}
