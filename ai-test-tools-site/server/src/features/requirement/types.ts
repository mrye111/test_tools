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
