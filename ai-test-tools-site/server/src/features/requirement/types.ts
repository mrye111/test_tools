export type RequirementNode = {
  id: string;
  title: string;
  children: RequirementNode[];
};

export type FindingType = "risk" | "ambiguity" | "clarification";

export type Finding = {
  id: string;
  type: FindingType;
  title: string;
  detail: string;
  /** 关联的需求分解树节点 id */
  nodeId: string;
};

export type RequirementChartType = "mindmap" | "tree" | "logic";

export type RequirementAnalysisResult = {
  title: string;
  tree: RequirementNode;
  findings: Finding[];
  /** 解析（并可能截断）后的需求原文 */
  sourceText: string;
  truncated: boolean;
  warnings: string[];
};

/** 持久化的分析记录（ADR-0004）：一次完成态分析的完整快照，可在记录列表中回看。 */
export type AnalysisRecord = RequirementAnalysisResult & {
  id: string;
  name: string;
  chartType: RequirementChartType;
  /** 白板图表数据；服务端透传存储，具体结构由前端校验（deserializeBoard）。 */
  board?: unknown;
  /** ISO 时间 */
  createdAt: string;
  /** ISO 时间 */
  updatedAt: string;
};

/** 记录列表行：不含树/原文等大字段，结论按类型计数。 */
export type AnalysisRecordSummary = {
  id: string;
  name: string;
  chartType: RequirementChartType;
  createdAt: string;
  updatedAt: string;
  findingsCount: Record<FindingType, number>;
  truncated: boolean;
};

export type ParsedDocument = {
  text: string;
  warnings: string[];
  truncated: boolean;
};

export const FINDING_TYPE_LABELS: Record<FindingType, string> = {
  risk: "风险点",
  ambiguity: "歧义点",
  clarification: "待澄清问题",
};
