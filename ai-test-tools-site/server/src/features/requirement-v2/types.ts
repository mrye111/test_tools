/** 需求分析 v2 域类型（地图 #21 决策：四类问题枚举、三档严重度、三态状态机、结构化接力载荷、条件级 RTM） */

export const MAX_ANALYSIS_RECORDS = 200;

/** 问题类型：歧义/缺失/冲突/不可测 */
export type IssueType = "ambiguity" | "missing" | "conflict" | "untestable";
/** 严重度三档 */
export type IssueSeverity = "high" | "medium" | "low";
/** 问题状态机：待澄清 → 已澄清 / 已接受 */
export type IssueStatus = "open" | "resolved" | "accepted";
/** 验收准则状态：待确认 / 已确认 / 已驳回（驳回自动生成不可测问题） */
export type CriterionStatus = "pending" | "confirmed" | "rejected";
/** 测试条件分类 */
export type ConditionKind = "normal" | "boundary" | "exception";
/** 条件接力状态：未接力 / 已接力 / 已生成用例 */
export type RelayState = "none" | "relayed" | "generated";

/** 需求条目（树形，parentId 为空为根） */
export interface RequirementItem {
  id: string;
  recordId: string;
  parentId: string | null;
  level: number;
  text: string;
  sort: number;
}

export interface AnalysisRecord {
  id: string;
  title: string;
  sourceFileName: string | null;
  sourceText: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalysisIssue {
  id: string;
  recordId: string;
  reqId: string | null;
  type: IssueType;
  severity: IssueSeverity;
  quote: string;
  description: string;
  /** 简单易懂的具体例子（≤60字，AI 分析时产出；空串表示无） */
  example: string;
  suggestedQuestion: string;
  status: IssueStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AcceptanceCriterion {
  id: string;
  recordId: string;
  reqId: string;
  originalText: string;
  rewrittenText: string;
  status: CriterionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestCondition {
  id: string;
  recordId: string;
  reqId: string | null;
  criterionId: string | null;
  text: string;
  kind: ConditionKind;
  relay: RelayState;
  testsetId: string | null;
  /** 记录内排序（创建时按输入顺序赋值，保证分组与需求顺序一致） */
  sort: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 记录详情：记录 + 全部子资源（分析页一次拉全） */
export interface AnalysisRecordDetail extends AnalysisRecord {
  requirements: RequirementItem[];
  issues: AnalysisIssue[];
  criteria: AcceptanceCriterion[];
  conditions: TestCondition[];
}

export interface AnalysisRecordSummary extends AnalysisRecord {
  issueCount: number;
  openIssueCount: number;
  conditionCount: number;
  coveredConditionCount: number;
}

/** 创建记录时的整包输入（AI 分析落库） */
export interface CreateAnalysisInput {
  title: string;
  sourceFileName?: string | null;
  sourceText: string;
  requirements: Array<Omit<RequirementItem, "recordId">>;
  issues: Array<Omit<AnalysisIssue, "recordId" | "createdAt" | "updatedAt">>;
  criteria: Array<Omit<AcceptanceCriterion, "recordId" | "createdAt" | "updatedAt">>;
  conditions: Array<Omit<TestCondition, "recordId" | "createdAt" | "updatedAt">>;
}

export interface CreateIssueInput {
  reqId?: string | null;
  type: IssueType;
  severity: IssueSeverity;
  quote: string;
  description: string;
  example?: string;
  suggestedQuestion?: string;
}

/** RTM 行：需求 × 条件 × 用例集 */
export interface RtmRow {
  reqId: string | null;
  reqText: string;
  conditionId: string;
  conditionText: string;
  conditionKind: ConditionKind;
  relay: RelayState;
  testsetId: string | null;
}

export interface RtmView {
  totalConditions: number;
  coveredConditions: number;
  coverage: number;
  rows: RtmRow[];
}

export interface AnalysisRepository {
  listRecords(limit?: number, offset?: number): Promise<AnalysisRecordSummary[]>;
  countRecords(): Promise<number>;
  getRecord(id: string): Promise<AnalysisRecordDetail | null>;
  createRecord(input: CreateAnalysisInput): Promise<AnalysisRecordDetail>;
  renameRecord(id: string, title: string): Promise<AnalysisRecord>;
  deleteRecord(id: string): Promise<void>;

  patchIssue(id: string, patch: { status?: IssueStatus; severity?: IssueSeverity }): Promise<AnalysisIssue>;
  patchCriterion(id: string, patch: { status?: CriterionStatus; rewrittenText?: string }): Promise<AcceptanceCriterion>;
  patchCondition(id: string, patch: { relay?: RelayState }): Promise<TestCondition>;

  /** 驳回准则的闭环：在问题日志生成「不可测」条目 */
  createIssue(recordId: string, input: CreateIssueInput): Promise<AnalysisIssue>;
  /** 接力：勾选条件标记 relayed */
  markConditionsRelayed(recordId: string, conditionIds: string[]): Promise<number>;
  /** 用例集保存后回写：条件 → generated + testsetId */
  markConditionsGenerated(conditionIds: string[], testsetId: string): Promise<number>;
  getRtm(recordId: string): Promise<RtmView>;
}
