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
  type IssueStatus,
  type RequirementItem,
  type RtmRow,
  type RtmView,
  type TestCondition,
  type UpsertConditionInput,
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
      // 条件按（需求 sort, 条件 sort）排序：与 MySQL JOIN 排序同语义；reqId 悬空排尾
      conditions: this.sortedConditions(id),
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
      previousRecordId: input.previousRecordId ?? null,
      inheritedIssueCount: input.inheritedIssueCount ?? 0,
      createdAt: time,
      updatedAt: time,
    };
    this.records.set(record.id, record);

    // 子资源 id 服务端重新分配（调用方给的 id 只作记录内引用键），reqId/criterionId 引用跟随映射
    const reqIdMap = new Map<string, string>();
    this.requirements.set(
      record.id,
      input.requirements.map((r) => {
        const mappedId = newId("rreq_");
        reqIdMap.set(r.id, mappedId);
        return {
          ...r,
          id: mappedId,
          parentId: r.parentId ? (reqIdMap.get(r.parentId) ?? r.parentId) : null,
          recordId: record.id,
        };
      }),
    );

    const criterionIdMap = new Map<string, string>();
    for (const criterion of input.criteria) {
      const mappedId = newId("rcr_");
      criterionIdMap.set(criterion.id, mappedId);
      this.criteria.set(mappedId, {
        ...criterion,
        id: mappedId,
        reqId: reqIdMap.get(criterion.reqId) ?? criterion.reqId,
        recordId: record.id,
        createdAt: time,
        updatedAt: time,
      });
    }
    for (const issue of input.issues) {
      const mappedId = newId("rai_");
      this.issues.set(mappedId, {
        ...issue,
        example: issue.example ?? "",
        id: mappedId,
        reqId: issue.reqId ? (reqIdMap.get(issue.reqId) ?? issue.reqId) : issue.reqId,
        recordId: record.id,
        createdAt: time,
        updatedAt: time,
      });
    }
    for (const condition of input.conditions) {
      const mappedId = newId("rcd_");
      this.conditions.set(mappedId, {
        ...condition,
        id: mappedId,
        reqId: condition.reqId ? (reqIdMap.get(condition.reqId) ?? condition.reqId) : condition.reqId,
        criterionId: condition.criterionId ? (criterionIdMap.get(condition.criterionId) ?? condition.criterionId) : condition.criterionId,
        recordId: record.id,
        createdAt: time,
        updatedAt: time,
      });
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
      example: input.example ?? "",
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

  /** 人工新增条件：reqId 必须属于本记录；relay 恒为 none */
  async createCondition(recordId: string, input: UpsertConditionInput): Promise<TestCondition> {
    this.mustRecord(recordId);
    const reqOk = (this.requirements.get(recordId) ?? []).some((r) => r.id === input.reqId);
    if (!reqOk) throw new Error(`需求条目不存在或不属于该记录: ${input.reqId}`);
    if (input.criterionId) {
      const criterion = this.criteria.get(input.criterionId);
      if (!criterion || criterion.recordId !== recordId) throw new Error(`验收准则不存在或不属于该记录: ${input.criterionId}`);
    }
    const text = input.text.trim();
    if (!text) throw new Error("条件文本不能为空");
    const time = now();
    const siblings = this.childrenOf(this.conditions, recordId).filter((c) => c.reqId === input.reqId);
    const sort = siblings.length === 0 ? 0 : Math.max(...siblings.map((c) => c.sort)) + 1;
    const condition: TestCondition = {
      id: newId("rcd_"),
      recordId,
      reqId: input.reqId,
      criterionId: input.criterionId ?? null,
      text,
      kind: input.kind,
      relay: "none",
      testsetId: null,
      sort,
      createdAt: time,
      updatedAt: time,
    };
    this.conditions.set(condition.id, condition);
    this.touchRecord(recordId);
    return deepClone(condition);
  }

  /** 编辑条件：已接力/已生成拒绝（保护 RTM 关联） */
  async updateCondition(recordId: string, conditionId: string, input: Partial<UpsertConditionInput>): Promise<TestCondition> {
    this.mustRecord(recordId);
    const existing = this.conditions.get(conditionId);
    if (!existing || existing.recordId !== recordId) throw new Error(`测试条件不存在: ${conditionId}`);
    if (existing.relay !== "none") throw new Error(`条件已接力或已生成用例，禁止编辑: ${conditionId}`);
    if (input.reqId !== undefined) {
      const reqOk = (this.requirements.get(recordId) ?? []).some((r) => r.id === input.reqId);
      if (!reqOk) throw new Error(`需求条目不存在或不属于该记录: ${input.reqId}`);
    }
    const text = input.text !== undefined ? input.text.trim() : existing.text;
    if (!text) throw new Error("条件文本不能为空");
    const updated: TestCondition = {
      ...existing,
      reqId: input.reqId ?? existing.reqId,
      criterionId: input.criterionId === undefined ? existing.criterionId : input.criterionId,
      text,
      kind: input.kind ?? existing.kind,
      updatedAt: now(),
    };
    this.conditions.set(conditionId, updated);
    this.touchRecord(recordId);
    return deepClone(updated);
  }

  /** 删除条件：已接力/已生成拒绝 */
  async deleteCondition(recordId: string, conditionId: string): Promise<void> {
    this.mustRecord(recordId);
    const existing = this.conditions.get(conditionId);
    if (!existing || existing.recordId !== recordId) throw new Error(`测试条件不存在: ${conditionId}`);
    if (existing.relay !== "none") throw new Error(`条件已接力或已生成用例，禁止删除: ${conditionId}`);
    this.conditions.delete(conditionId);
    this.touchRecord(recordId);
  }

  /** 问题批量状态更新：先全量校验（归属/存在/枚举），再统一生效——原子语义 */
  async bulkPatchIssues(recordId: string, issueIds: string[], patch: { status: IssueStatus }): Promise<AnalysisIssue[]> {
    this.mustRecord(recordId);
    if (issueIds.length === 0) throw new Error("批量更新不能为空");
    const uniqueIds = [...new Set(issueIds)];
    const targets: AnalysisIssue[] = [];
    for (const id of uniqueIds) {
      const existing = this.issues.get(id);
      if (!existing || existing.recordId !== recordId) throw new Error(`问题不存在或不属于该记录: ${id}`);
      targets.push(existing);
    }
    const updated = targets.map((issue) => ({ ...issue, status: patch.status, updatedAt: now() }));
    for (const issue of updated) this.issues.set(issue.id, issue);
    this.touchRecord(recordId);
    return updated.map((issue) => deepClone(issue));
  }

  private sortedConditions(recordId: string): TestCondition[] {
    const reqSortById = new Map((this.requirements.get(recordId) ?? []).map((r) => [r.id, r.sort]));
    return this.childrenOf(this.conditions, recordId).sort((a, b) => {
      const reqA = a.reqId ? (reqSortById.get(a.reqId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      const reqB = b.reqId ? (reqSortById.get(b.reqId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      return reqA !== reqB ? reqA - reqB : a.sort - b.sort;
    });
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
