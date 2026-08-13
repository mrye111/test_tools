import { randomUUID } from "crypto";
import {
  type CreateReportInput,
  type ReportRepository,
  type TestReport,
  type TestReportSummary,
  type UpdateReportContentInput,
  MAX_REPORTS,
} from "./types.js";

/** 深拷贝对象，保留 Date 实例（仅支持 JSON 可序列化结构 + Date） */
function deepClone<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }
  const result = {} as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    result[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return result as T;
}

function now(): Date {
  return new Date();
}

function newId(prefix: string): string {
  return `${prefix}${randomUUID()}`;
}

/** 由完整记录生成列表摘要（剥离 html / sourceDigest 大字段）。 */
function toSummary(report: TestReport): TestReportSummary {
  return {
    id: report.id,
    title: report.title,
    reportType: report.reportType,
    sourceType: report.sourceType,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

/** 内存版 ReportRepository：MySQL 不可用时的降级实现。 */
export class MemoryReportRepository implements ReportRepository {
  private reports = new Map<string, TestReport>();

  async listReports(limit = 20, offset = 0): Promise<TestReportSummary[]> {
    return Array.from(this.reports.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(offset, offset + limit)
      .map(toSummary);
  }

  async countReports(): Promise<number> {
    return this.reports.size;
  }

  async getReport(id: string): Promise<TestReport | null> {
    const found = this.reports.get(id);
    return found ? deepClone(found) : null;
  }

  async createReport(input: CreateReportInput): Promise<TestReport> {
    if (this.reports.size >= MAX_REPORTS) {
      throw new Error(`报告记录已达上限（${MAX_REPORTS} 条）`);
    }
    const time = now();
    const report: TestReport = {
      id: newId("rpt_"),
      title: input.title,
      reportType: input.reportType,
      sourceType: input.sourceType,
      sourceDigest: input.sourceDigest ?? null,
      chartKinds: input.chartKinds ?? null,
      html: input.html,
      createdAt: time,
      updatedAt: time,
    };
    this.reports.set(report.id, report);
    return deepClone(report);
  }

  async renameReport(id: string, title: string): Promise<TestReport> {
    const existing = this.reports.get(id);
    if (!existing) {
      throw new Error(`报告记录不存在: ${id}`);
    }
    const updated: TestReport = { ...existing, title, updatedAt: now() };
    this.reports.set(id, updated);
    return deepClone(updated);
  }

  async updateReportContent(id: string, input: UpdateReportContentInput): Promise<TestReport> {
    const existing = this.reports.get(id);
    if (!existing) {
      throw new Error(`报告记录不存在: ${id}`);
    }
    const updated: TestReport = {
      ...existing,
      html: input.html,
      chartKinds: input.chartKinds ?? null,
      updatedAt: now(),
    };
    this.reports.set(id, updated);
    return deepClone(updated);
  }

  async deleteReport(id: string): Promise<void> {
    if (!this.reports.has(id)) {
      throw new Error(`报告记录不存在: ${id}`);
    }
    this.reports.delete(id);
  }
}
