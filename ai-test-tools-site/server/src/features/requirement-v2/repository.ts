import { randomUUID } from "crypto";
import {
  MAX_ANALYSIS_RECORDS,
  type AcceptanceCriterion,
  type AnalysisIssue,
  type AnalysisRecord,
  type AnalysisRecordDetail,
  type AnalysisRecordSummary,
  type AnalysisRepository,
  type CreateAnalysisInput,
  type CreateIssueInput,
  type RequirementItem,
  type RtmRow,
  type RtmView,
  type TestCondition,
} from "./types.js";

function deepClone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as T;
  const result = {} as Record<string, unknown>;
  for (const key of Object.keys(value)) result[key] = deepClone((value as Record<string, unknown>)[key]);
  return result as T;
}

function now(): Date {
  return new Date();
}

function newId(prefix: string): string {
  return `${prefix}${randomUUID()}`;
}

/** 内存版 AnalysisRepository：MySQL 不可用时的降级实现。 */
export class MemoryAnalysisRepository implements AnalysisRepository {
  private records = new Map<string, AnalysisRecord>();
  private requirements = new Map<string, RequirementItem[]>();
  private issues = new Map<string, AnalysisIssue>();
  private criteria = new Map<string, AcceptanceCriterion>();
  private conditions = new Map<string, TestCondition>();

  async listRecords(limit = 20, offset = 0): Promise<AnalysisRecordSummary[]> {
    return Array.from(this.records.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(offset, offset + limit)
      .map((record) => this.toSummary(record));
  }

  async countRecords(): Promise<number> {
    return this.records.size;
  }

  async getRecord(id: string): Promise<AnalysisRecordDetail | null> {
    const record = this.records.get(id);
    if (!record) return null;
    return deepClone({
      ...record,
      requirements: this.requirements.get(id) ?? [],
      issues: this.childrenOf(this.issues, id),
      criteria: this.childrenOf(this.criteria, id),
      conditions: this.childrenOf(this.conditions, id),
    });
  }

  async createRecord(input: CreateAnalysisInput): Promise<AnalysisRecordDetail> {
    if (this.records.size >= MAX_ANALYSIS_RECORDS) {
      throw new Error(`分析记录已达上限（${MAX_ANALYSIS_RECORDS} 条）`);
    }
    const time = now();
    const record: AnalysisRecord = {
      id: newId("ra2_"),
      title: input.title,
      sourceFileName: input.sourceFileName ?? null,
      sourceText: input.sourceText,
      createdAt: time,
      updatedAt: time,
    };
    this.records.set(record.id, record);
    this.requirements.set(record.id, input.requirements.map((r) => ({ ...r, recordId: record.id })));
    for (const issue of input.issues) {
      this.issues.set(issue.id, { ...issue, recordId: record.id, createdAt: time, updatedAt: time });
    }
    for (const criterion of input.criteria) {
      this.criteria.set(criterion.id, { ...criterion, recordId: record.id, createdAt: time, updatedAt: time });
    }
    for (const condition of input.conditions) {
      this.conditions.set(condition.id, { ...condition, recordId: record.id, createdAt: time, updatedAt: time });
    }
    return (await this.getRecord(record.id))!;
  }

  async renameRecord(id: string, title: string): Promise<AnalysisRecord> {
    const existing = this.mustRecord(id);
    const updated: AnalysisRecord = { ...existing, title, updatedAt: now() };
    this.records.set(id, updated);
    return deepClone(updated);
  }

  async deleteRecord(id: string): Promise<void> {
    this.mustRecord(id);
    this.records.delete(id);
    this.requirements.delete(id);
    for (const map of [this.issues, this.criteria, this.conditions]) {
      for (const [key, item] of map) {
        if (item.recordId === id) map.delete(key);
      }
    }
  }

  async patchIssue(id: string, patch: { status?: AnalysisIssue["status"]; severity?: AnalysisIssue["severity"] }): Promise<AnalysisIssue> {
    const existing = this.issues.get(id);
    if (!existing) throw new Error(`问题不存在: ${id}`);
    const updated: AnalysisIssue = { ...existing, ...patch, updatedAt: now() };
    this.issues.set(id, updated);
    return deepClone(updated);
  }

  async patchCriterion(id: string, patch: { status?: AcceptanceCriterion["status"]; rewrittenText?: string }): Promise<AcceptanceCriterion> {
    const existing = this.criteria.get(id);
    if (!existing) throw new Error(`验收准则不存在: ${id}`);
    const updated: AcceptanceCriterion = { ...existing, ...patch, updatedAt: now() };
    this.criteria.set(id, updated);
    return deepClone(updated);
  }

  async patchCondition(id: string, patch: { relay?: TestCondition["relay"] }): Promise<TestCondition> {
    const existing = this.conditions.get(id);
    if (!existing) throw new Error(`测试条件不存在: ${id}`);
    const updated: TestCondition = { ...existing, ...patch, updatedAt: now() };
    this.conditions.set(id, updated);
    return deepClone(updated);
  }

  async createIssue(recordId: string, input: CreateIssueInput): Promise<AnalysisIssue> {
    this.mustRecord(recordId);
    const time = now();
    const issue: AnalysisIssue = {
      id: newId("rai_"),
      recordId,
      reqId: input.reqId ?? null,
      type: input.type,
      severity: input.severity,
      quote: input.quote,
      description: input.description,
      suggestedQuestion: input.suggestedQuestion ?? "",
      status: "open",
      createdAt: time,
      updatedAt: time,
    };
    this.issues.set(issue.id, issue);
    this.touchRecord(recordId);
    return deepClone(issue);
  }

  async markConditionsRelayed(recordId: string, conditionIds: string[]): Promise<number> {
    let count = 0;
    for (const id of conditionIds) {
      const existing = this.conditions.get(id);
      if (!existing || existing.recordId !== recordId || existing.relay !== "none") continue;
      this.conditions.set(id, { ...existing, relay: "relayed", updatedAt: now() });
      count += 1;
    }
    if (count > 0) this.touchRecord(recordId);
    return count;
  }

  async markConditionsGenerated(conditionIds: string[], testsetId: string): Promise<number> {
    let count = 0;
    for (const id of conditionIds) {
      const existing = this.conditions.get(id);
      if (!existing) continue;
      this.conditions.set(id, { ...existing, relay: "generated", testsetId, updatedAt: now() });
      count += 1;
    }
    return count;
  }

  async getRtm(recordId: string): Promise<RtmView> {
    const record = this.mustRecord(recordId);
    const reqs = this.requirements.get(record.id) ?? [];
    const reqTextById = new Map(reqs.map((r) => [r.id, r.text]));
    const rows: RtmRow[] = this.childrenOf(this.conditions, record.id).map((c) => ({
      reqId: c.reqId,
      reqText: c.reqId ? reqTextById.get(c.reqId) ?? "" : "",
      conditionId: c.id,
      conditionText: c.text,
      conditionKind: c.kind,
      relay: c.relay,
      testsetId: c.testsetId,
    }));
    const covered = rows.filter((r) => r.relay === "generated").length;
    return {
      totalConditions: rows.length,
      coveredConditions: covered,
      coverage: rows.length === 0 ? 0 : Math.round((covered / rows.length) * 100),
      rows,
    };
  }

  private childrenOf<T extends { recordId: string; createdAt: Date }>(map: Map<string, T>, recordId: string): T[] {
    return Array.from(map.values())
      .filter((item) => item.recordId === recordId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  private toSummary(record: AnalysisRecord): AnalysisRecordSummary {
    const issues = this.childrenOf(this.issues, record.id);
    const conditions = this.childrenOf(this.conditions, record.id);
    return deepClone({
      ...record,
      issueCount: issues.length,
      openIssueCount: issues.filter((i) => i.status === "open").length,
      conditionCount: conditions.length,
      coveredConditionCount: conditions.filter((c) => c.relay === "generated").length,
    });
  }

  private mustRecord(id: string): AnalysisRecord {
    const existing = this.records.get(id);
    if (!existing) throw new Error(`分析记录不存在: ${id}`);
    return existing;
  }

  private touchRecord(id: string): void {
    const existing = this.records.get(id);
    if (existing) this.records.set(id, { ...existing, updatedAt: now() });
  }
}
