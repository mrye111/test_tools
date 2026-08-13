/**
 * 测试报告域数据类型。
 * 报告记录是 AI 报告生成管线的持久化产物，对应"记录列表 ↔ 报告视图"两层结构的列表层；
 * 只保存完成态：生成中断不落库（对齐分析记录语义）。
 */

/** 报告类型：测试总结 / 快速简报 / 缺陷分析 / 自由输入 */
export type ReportType = "summary" | "brief" | "defect" | "free";

/** 报告来源：几句话文本 / 禅道 CSV 解析数据 */
export type ReportSourceType = "text" | "csv";

/** 报告记录（完整，含 HTML 与源数据快照） */
export interface TestReport {
  id: string;
  title: string;
  reportType: ReportType;
  sourceType: ReportSourceType;
  /** 输入快照（文本原文或 CSV 解析 JSON 字符串），对话式追改时复用；无则 null */
  sourceDigest: string | null;
  /** 选图阶段选型 JSON（图型编号 + 数据映射）；无则 null */
  chartKinds: unknown;
  /** 单文件 HTML 报告全文 */
  html: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 报告摘要（列表层，不含 html / sourceDigest 大字段） */
export interface TestReportSummary {
  id: string;
  title: string;
  reportType: ReportType;
  sourceType: ReportSourceType;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建报告记录入参（由生成管线在产出合格后调用） */
export interface CreateReportInput {
  title: string;
  reportType: ReportType;
  sourceType: ReportSourceType;
  sourceDigest?: string | null;
  chartKinds?: unknown;
  html: string;
}

/** 追改更新入参：整体替换 HTML（一期不做局部 patch） */
export interface UpdateReportContentInput {
  html: string;
  chartKinds?: unknown;
}

/** 报告记录条数硬上限 */
export const MAX_REPORTS = 200;

/** Report Repository 接口：内存与 MySQL 双实现共用同一契约 */
export interface ReportRepository {
  /** 按 updatedAt 倒序分页；摘要不含 html / sourceDigest */
  listReports(limit?: number, offset?: number): Promise<TestReportSummary[]>;
  countReports(): Promise<number>;
  getReport(id: string): Promise<TestReport | null>;
  createReport(input: CreateReportInput): Promise<TestReport>;
  renameReport(id: string, title: string): Promise<TestReport>;
  /** 追改通路：整体替换 HTML 与选型，更新 updatedAt */
  updateReportContent(id: string, input: UpdateReportContentInput): Promise<TestReport>;
  deleteReport(id: string): Promise<void>;
}
