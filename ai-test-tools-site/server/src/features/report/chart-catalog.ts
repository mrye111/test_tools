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
 * 16 种已全部按 2026-09-22 视觉重构的 §5 规格重绘为 1080 宽全出血图。
 */
export const CHART_CATALOG: ChartDescriptor[] = [
  { code: "F11", name: "Meter Rails", cardTitle: "各模块通过率，谁能过发版线",
    contract: "单值进度 0–100%，1–6 条并排（各模块通过率 / 各质量门禁），每条带阈值刻度", echarts: false },
  { code: "F4", name: "Stacked Share", cardTitle: "128 条里 118 条通过，未通过 9 条",
    contract: "100% 构成（≤6 段）；状态构成按 STATUS.order 段序（通过|阻塞|失败|跳过，绿红不得相邻）", echarts: false },
  { code: "L14", name: "Hundred Field", cardTitle: "100 个单位逐格可数",
    contract: "构成（占比），≤6 类小数据；1 点 = 1 个单位，点数即真实条目数", echarts: false },
  { code: "F5", name: "Emphasis Bars", cardTitle: "支付网关一个模块占了四成缺陷",
    contract: "名义类目排名比较（≤8 行），单位可数；一支高亮风险焦点，其余去强调灰", echarts: false },
  { code: "L4", name: "Ink Matrix", cardTitle: "唯一致命缺陷仍卡在「激活」",
    contract: "分类 × 分类 + 量（≤100 格）；典型为严重度 × 状态的缺陷计数", echarts: false },
  { code: "F2", name: "Emphasis Lines", cardTitle: "新增缺陷见顶，修复进度落后两天",
    contract: "日序列（≤30 天，逐日读数）；1–2 系列同单位共用一轴，绝不双轴", echarts: false },

  { code: "F1", name: "Columns", cardTitle: "用户中心与订单中心占了六成用例",
    contract: "竖向少类目比较（≤8），单位可数；单系列同一墨色，不用值色阶", echarts: false },
  { code: "F7", name: "Stacked Columns", cardTitle: "各优先级用例的状态分布",
    contract: "堆叠构成（≤4 类 × ≤3 段）；段为状态时按 STATUS.order 段序，段间 2px 表面间隙", echarts: false },
  { code: "F6", name: "Paired Columns", cardTitle: "本轮对上轮，逐模块比一比",
    contract: "分组对比，每类 2 系列（本轮 vs 上轮）；emphasis 1 色 + 灰，组内 2px 间隙", echarts: false },
  { code: "F9", name: "Waterfall", cardTitle: "从计划执行走到通过，损失在哪几级",
    contract: "瀑布 / 增减分解（≤6 级）；加项墨色、减项灰，数据形状 [类目, 取值, 标记]", echarts: false },
  { code: "F10", name: "Dot Heat", cardTitle: "缺陷在周二上午最吵",
    contract: "星期×小时×量（小热力；缺陷爆发时段）；点面积 = 量，明度 = 密度", echarts: false },
  { code: "L3", name: "Barcode Lollipop", cardTitle: "九十天执行量，肌理可数",
    contract: "日序列 90 天级，要肌理；条码日历地板 + 棒棒糖读数，只标前 3 峰值", echarts: false },
  { code: "L5", name: "Radial Convergence", cardTitle: "48 个缺陷汇聚到五个模块",
    contract: "多对一归属不丢明细（≤60 条）；外圈 1 点 = 1 条，中心点面积 = 归属条数", echarts: false },
  { code: "L12", name: "Type Colonnade", cardTitle: "44 条条目归到十个维度",
    contract: "多对一归属 + 逐条名单（≤50 条）；左名录右归属中心，发丝连线不丢明细", echarts: false },
  { code: "G7", name: "Tree LR", cardTitle: "这轮测了哪些范围",
    contract: "层级结构 2–3 层（测试范围 → 重点条目）。降级理由：层级从属无权重语义，Lupi/Basics 无承接图型", echarts: true },
  { code: "G15", name: "Jitter Strip", cardTitle: "各严重度的解决时长摊开看",
    contract: "分组分布逐条记录几百点（逐条缺陷解决时长），共用一根横轴。降级理由：F8 散点容量 ≤20 点不足", echarts: true },
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
