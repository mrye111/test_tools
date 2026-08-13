import { randomUUID } from "crypto";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import {
  type CreateReportInput,
  type ReportRepository,
  type ReportSourceType,
  type ReportType,
  type TestReport,
  type TestReportSummary,
  type UpdateReportContentInput,
  MAX_REPORTS,
} from "./types.js";

function now(): Date {
  return new Date();
}

function newId(prefix: string): string {
  // Schema 中 id 列为 VARCHAR(36)，前缀 5 字符 + 31 字符 UUID 截断，确保符合约束
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 31)}`;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof value === "number") return new Date(value);
  return new Date();
}

/** mysql2 对 JSON 列可能返回已解析对象或字符串，统一为对象。 */
function toJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

interface ReportRow extends RowDataPacket {
  id: string;
  title: string;
  report_type: string;
  source_type: string;
  source_digest: string | null;
  chart_kinds: unknown;
  html: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function toReport(row: ReportRow): TestReport {
  return {
    id: row.id,
    title: row.title,
    reportType: row.report_type as ReportType,
    sourceType: row.source_type as ReportSourceType,
    sourceDigest: row.source_digest,
    chartKinds: toJsonValue(row.chart_kinds),
    html: row.html,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toSummary(row: ReportRow): TestReportSummary {
  return {
    id: row.id,
    title: row.title,
    reportType: row.report_type as ReportType,
    sourceType: row.source_type as ReportSourceType,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

/** MySQL 版 ReportRepository：tr_reports 单表，列表查询不 select 大字段。 */
export class MysqlReportRepository implements ReportRepository {
  constructor(private pool: Pool) {}

  async listReports(limit = 20, offset = 0): Promise<TestReportSummary[]> {
    // LIMIT/OFFSET 不支持预编译占位符（mysqld_stmt_execute 报错），
    // 这里强制转为非负整数后内联，值域由服务端控制，无注入风险。
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    const [rows] = await this.pool.query<ReportRow[]>(
      `SELECT id, title, report_type, source_type, created_at, updated_at FROM tr_reports ORDER BY updated_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    );
    return rows.map(toSummary);
  }

  async countReports(): Promise<number> {
    const [rows] = await this.pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM tr_reports");
    return Number(rows[0]?.total ?? 0);
  }

  async getReport(id: string): Promise<TestReport | null> {
    const [rows] = await this.pool.execute<ReportRow[]>("SELECT * FROM tr_reports WHERE id = ?", [id]);
    return rows.length > 0 ? toReport(rows[0]) : null;
  }

  async createReport(input: CreateReportInput): Promise<TestReport> {
    const total = await this.countReports();
    if (total >= MAX_REPORTS) {
      throw new Error(`报告记录已达上限（${MAX_REPORTS} 条）`);
    }
    const id = newId("rpt_");
    const time = now();
    await this.pool.execute(
      "INSERT INTO tr_reports (id, title, report_type, source_type, source_digest, chart_kinds, html, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.title,
        input.reportType,
        input.sourceType,
        input.sourceDigest ?? null,
        input.chartKinds === undefined || input.chartKinds === null ? null : JSON.stringify(input.chartKinds),
        input.html,
        time,
        time,
      ],
    );
    const created = await this.getReport(id);
    if (!created) {
      throw new Error("报告记录创建后读取失败");
    }
    return created;
  }

  async renameReport(id: string, title: string): Promise<TestReport> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "UPDATE tr_reports SET title = ?, updated_at = ? WHERE id = ?",
      [title, now(), id],
    );
    if (result.affectedRows === 0) {
      throw new Error(`报告记录不存在: ${id}`);
    }
    return (await this.getReport(id)) as TestReport;
  }

  async updateReportContent(id: string, input: UpdateReportContentInput): Promise<TestReport> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "UPDATE tr_reports SET html = ?, chart_kinds = ?, updated_at = ? WHERE id = ?",
      [
        input.html,
        input.chartKinds === undefined || input.chartKinds === null ? null : JSON.stringify(input.chartKinds),
        now(),
        id,
      ],
    );
    if (result.affectedRows === 0) {
      throw new Error(`报告记录不存在: ${id}`);
    }
    return (await this.getReport(id)) as TestReport;
  }

  async deleteReport(id: string): Promise<void> {
    const [result] = await this.pool.execute<ResultSetHeader>("DELETE FROM tr_reports WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      throw new Error(`报告记录不存在: ${id}`);
    }
  }
}
