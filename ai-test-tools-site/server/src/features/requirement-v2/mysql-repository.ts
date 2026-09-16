import { randomUUID } from "crypto";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import {
  MAX_ANALYSIS_RECORDS,
  type AcceptanceCriterion,
  type AnalysisIssue,
  type AnalysisRecord,
  type AnalysisRecordDetail,
  type AnalysisRecordSummary,
  type AnalysisRepository,
  type ConditionKind,
  type CreateAnalysisInput,
  type CreateIssueInput,
  type CriterionStatus,
  type IssueSeverity,
  type IssueStatus,
  type IssueType,
  type RelayState,
  type RequirementItem,
  type RtmRow,
  type RtmView,
  type TestCondition,
  type UpsertConditionInput,
} from "./types.js";

function now(): Date {
  return new Date();
}

function newId(prefix: string): string {
  // id 列 VARCHAR(36)：前缀 + 截断 UUID
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 36 - prefix.length)}`;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

interface RecordRow extends RowDataPacket {
  id: string;
  title: string;
  source_file_name: string | null;
  source_text: string;
  previous_record_id: string | null;
  inherited_issue_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ReqRow extends RowDataPacket {
  id: string;
  record_id: string;
  parent_id: string | null;
  level: number;
  text: string;
  sort: number;
}

interface IssueRow extends RowDataPacket {
  id: string;
  record_id: string;
  req_id: string | null;
  type: string;
  severity: string;
  quote: string;
  description: string;
  example: string;
  suggested_question: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CriterionRow extends RowDataPacket {
  id: string;
  record_id: string;
  req_id: string;
  original_text: string;
  rewritten_text: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ConditionRow extends RowDataPacket {
  id: string;
  record_id: string;
  req_id: string | null;
  criterion_id: string | null;
  text: string;
  kind: string;
  relay: string;
  testset_id: string | null;
  sort: number;
  created_at: Date | string;
  updated_at: Date | string;
}

function toRecord(row: RecordRow): AnalysisRecord {
  return {
    id: row.id,
    title: row.title,
    sourceFileName: row.source_file_name,
    sourceText: row.source_text,
    previousRecordId: row.previous_record_id ?? null,
    inheritedIssueCount: Number(row.inherited_issue_count ?? 0),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toReq(row: ReqRow): RequirementItem {
  return { id: row.id, recordId: row.record_id, parentId: row.parent_id, level: row.level, text: row.text, sort: row.sort };
}

function toIssue(row: IssueRow): AnalysisIssue {
  return {
    id: row.id,
    recordId: row.record_id,
    reqId: row.req_id,
    type: row.type as IssueType,
    severity: row.severity as IssueSeverity,
    quote: row.quote,
    description: row.description,
    example: row.example ?? "",
    suggestedQuestion: row.suggested_question,
    status: row.status as IssueStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toCriterion(row: CriterionRow): AcceptanceCriterion {
  return {
    id: row.id,
    recordId: row.record_id,
    reqId: row.req_id,
    originalText: row.original_text,
    rewrittenText: row.rewritten_text,
    status: row.status as CriterionStatus,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toCondition(row: ConditionRow): TestCondition {
  return {
    id: row.id,
    recordId: row.record_id,
    reqId: row.req_id,
    criterionId: row.criterion_id,
    text: row.text,
    kind: row.kind as ConditionKind,
    relay: row.relay as RelayState,
    testsetId: row.testset_id,
    sort: row.sort,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

/** MySQL 版 AnalysisRepository：ra2_* 五表。 */
export class MysqlAnalysisRepository implements AnalysisRepository {
  constructor(private pool: Pool) {}

  async listRecords(limit = 20, offset = 0): Promise<AnalysisRecordSummary[]> {
    // LIMIT/OFFSET 不支持预编译占位符，强制非负整数后内联（值域服务端控制，无注入风险）
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    const [rows] = await this.pool.query<RecordRow[]>(
      `SELECT * FROM ra2_records ORDER BY updated_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    );
    return Promise.all(rows.map(async (row) => {
      const record = toRecord(row);
      const [issueRows] = await this.pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS total, SUM(status = 'open') AS open_count FROM ra2_issues WHERE record_id = ?",
        [record.id],
      );
      const [condRows] = await this.pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS total, SUM(relay = 'generated') AS covered FROM ra2_conditions WHERE record_id = ?",
        [record.id],
      );
      return {
        ...record,
        issueCount: Number(issueRows[0]?.total ?? 0),
        openIssueCount: Number(issueRows[0]?.open_count ?? 0),
        conditionCount: Number(condRows[0]?.total ?? 0),
        coveredConditionCount: Number(condRows[0]?.covered ?? 0),
      };
    }));
  }

  async countRecords(): Promise<number> {
    const [rows] = await this.pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM ra2_records");
    return Number(rows[0]?.total ?? 0);
  }

  async getRecord(id: string): Promise<AnalysisRecordDetail | null> {
    const [rows] = await this.pool.execute<RecordRow[]>("SELECT * FROM ra2_records WHERE id = ?", [id]);
    if (rows.length === 0) return null;
    const record = toRecord(rows[0]);
    const [reqRows] = await this.pool.execute<ReqRow[]>("SELECT * FROM ra2_requirements WHERE record_id = ? ORDER BY sort ASC", [id]);
    const [issueRows] = await this.pool.execute<IssueRow[]>("SELECT * FROM ra2_issues WHERE record_id = ? ORDER BY created_at ASC", [id]);
    const [criterionRows] = await this.pool.execute<CriterionRow[]>("SELECT * FROM ra2_criteria WHERE record_id = ? ORDER BY created_at ASC", [id]);
    // JOIN 需求表排序：需求 sort 为第一键（结构保证，不靠赋值约定），条件 sort 作组内次序；悬空引用排尾
    const [conditionRows] = await this.pool.execute<ConditionRow[]>(
      `SELECT c.* FROM ra2_conditions c LEFT JOIN ra2_requirements r ON c.req_id = r.id
       WHERE c.record_id = ? ORDER BY r.sort IS NULL ASC, r.sort ASC, c.sort ASC`,
      [id],
    );
    return {
      ...record,
      requirements: reqRows.map(toReq),
      issues: issueRows.map(toIssue),
      criteria: criterionRows.map(toCriterion),
      conditions: conditionRows.map(toCondition),
    };
  }

  async createRecord(input: CreateAnalysisInput): Promise<AnalysisRecordDetail> {
    const total = await this.countRecords();
    if (total >= MAX_ANALYSIS_RECORDS) {
      throw new Error(`分析记录已达上限（${MAX_ANALYSIS_RECORDS} 条）`);
    }
    const id = newId("ra2_");
    const time = now();

    // 子资源 id 服务端重新分配（AI/客户端给的 id 只作记录内引用键，不能直接当全局主键——
    // 两次分析都会产出 r1/r2 导致主键冲突），reqId/criterionId 引用跟随映射。
    const reqIdMap = new Map<string, string>();
    const requirements = input.requirements.map((req) => {
      const newReqId = newId("rreq_");
      reqIdMap.set(req.id, newReqId);
      return { ...req, id: newReqId };
    });
    const criterionIdMap = new Map<string, string>();
    const criteria = input.criteria.map((criterion) => {
      const newCriterionId = newId("rcr_");
      criterionIdMap.set(criterion.id, newCriterionId);
      return { ...criterion, id: newCriterionId, reqId: criterion.reqId ? (reqIdMap.get(criterion.reqId) ?? criterion.reqId) : criterion.reqId };
    });
    const issues = input.issues.map((issue) => ({
      ...issue,
      id: newId("rai_"),
      reqId: issue.reqId ? (reqIdMap.get(issue.reqId) ?? issue.reqId) : issue.reqId,
    }));
    const conditions = input.conditions.map((condition, index) => ({
      ...condition,
      id: newId("rcd_"),
      sort: condition.sort ?? index,
      reqId: condition.reqId ? (reqIdMap.get(condition.reqId) ?? condition.reqId) : condition.reqId,
      criterionId: condition.criterionId ? (criterionIdMap.get(condition.criterionId) ?? condition.criterionId) : condition.criterionId,
    }));

    await this.pool.execute(
      "INSERT INTO ra2_records (id, title, source_file_name, source_text, previous_record_id, inherited_issue_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.title, input.sourceFileName ?? null, input.sourceText, input.previousRecordId ?? null, input.inheritedIssueCount ?? 0, time, time],
    );
    for (const req of requirements) {
      await this.pool.execute(
        "INSERT INTO ra2_requirements (id, record_id, parent_id, level, text, sort) VALUES (?, ?, ?, ?, ?, ?)",
        [req.id, id, req.parentId ? (reqIdMap.get(req.parentId) ?? req.parentId) : null, req.level, req.text, req.sort],
      );
    }
    for (const issue of issues) {
      await this.pool.execute(
        "INSERT INTO ra2_issues (id, record_id, req_id, type, severity, quote, description, example, suggested_question, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [issue.id, id, issue.reqId, issue.type, issue.severity, issue.quote, issue.description, issue.example ?? "", issue.suggestedQuestion, issue.status, time, time],
      );
    }
    for (const criterion of criteria) {
      await this.pool.execute(
        "INSERT INTO ra2_criteria (id, record_id, req_id, original_text, rewritten_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [criterion.id, id, criterion.reqId, criterion.originalText, criterion.rewrittenText, criterion.status, time, time],
      );
    }
    for (const condition of conditions) {
      await this.pool.execute(
        "INSERT INTO ra2_conditions (id, record_id, req_id, criterion_id, text, kind, relay, testset_id, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [condition.id, id, condition.reqId, condition.criterionId, condition.text, condition.kind, condition.relay, condition.testsetId, condition.sort, time, time],
      );
    }
    return (await this.getRecord(id))!;
  }

  async renameRecord(id: string, title: string): Promise<AnalysisRecord> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "UPDATE ra2_records SET title = ?, updated_at = ? WHERE id = ?",
      [title, now(), id],
    );
    if (result.affectedRows === 0) throw new Error(`分析记录不存在: ${id}`);
    const [rows] = await this.pool.execute<RecordRow[]>("SELECT * FROM ra2_records WHERE id = ?", [id]);
    return toRecord(rows[0]);
  }

  async deleteRecord(id: string): Promise<void> {
    const [result] = await this.pool.execute<ResultSetHeader>("DELETE FROM ra2_records WHERE id = ?", [id]);
    if (result.affectedRows === 0) throw new Error(`分析记录不存在: ${id}`);
  }

  async patchIssue(id: string, patch: { status?: IssueStatus; severity?: IssueSeverity }): Promise<AnalysisIssue> {
    const sets: string[] = ["updated_at = ?"];
    const values: unknown[] = [now()];
    if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
    if (patch.severity !== undefined) { sets.push("severity = ?"); values.push(patch.severity); }
    values.push(id);
    const [result] = await this.pool.execute<ResultSetHeader>(`UPDATE ra2_issues SET ${sets.join(", ")} WHERE id = ?`, values as never[]);
    if (result.affectedRows === 0) throw new Error(`问题不存在: ${id}`);
    const [rows] = await this.pool.execute<IssueRow[]>("SELECT * FROM ra2_issues WHERE id = ?", [id]);
    return toIssue(rows[0]);
  }

  async patchCriterion(id: string, patch: { status?: CriterionStatus; rewrittenText?: string }): Promise<AcceptanceCriterion> {
    const sets: string[] = ["updated_at = ?"];
    const values: unknown[] = [now()];
    if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
    if (patch.rewrittenText !== undefined) { sets.push("rewritten_text = ?"); values.push(patch.rewrittenText); }
    values.push(id);
    const [result] = await this.pool.execute<ResultSetHeader>(`UPDATE ra2_criteria SET ${sets.join(", ")} WHERE id = ?`, values as never[]);
    if (result.affectedRows === 0) throw new Error(`验收准则不存在: ${id}`);
    const [rows] = await this.pool.execute<CriterionRow[]>("SELECT * FROM ra2_criteria WHERE id = ?", [id]);
    return toCriterion(rows[0]);
  }

  async patchCondition(id: string, patch: { relay?: RelayState }): Promise<TestCondition> {
    if (patch.relay === undefined) {
      const [rows] = await this.pool.execute<ConditionRow[]>("SELECT * FROM ra2_conditions WHERE id = ?", [id]);
      if (rows.length === 0) throw new Error(`测试条件不存在: ${id}`);
      return toCondition(rows[0]);
    }
    const [result] = await this.pool.execute<ResultSetHeader>(
      "UPDATE ra2_conditions SET relay = ?, updated_at = ? WHERE id = ?",
      [patch.relay, now(), id],
    );
    if (result.affectedRows === 0) throw new Error(`测试条件不存在: ${id}`);
    const [rows] = await this.pool.execute<ConditionRow[]>("SELECT * FROM ra2_conditions WHERE id = ?", [id]);
    return toCondition(rows[0]);
  }

  async createIssue(recordId: string, input: CreateIssueInput): Promise<AnalysisIssue> {
    const id = newId("rai_");
    const time = now();
    await this.pool.execute(
      "INSERT INTO ra2_issues (id, record_id, req_id, type, severity, quote, description, example, suggested_question, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
      [id, recordId, input.reqId ?? null, input.type, input.severity, input.quote, input.description, input.example ?? "", input.suggestedQuestion ?? "", time, time],
    );
    await this.pool.execute("UPDATE ra2_records SET updated_at = ? WHERE id = ?", [time, recordId]);
    const [rows] = await this.pool.execute<IssueRow[]>("SELECT * FROM ra2_issues WHERE id = ?", [id]);
    if (rows.length === 0) throw new Error(`分析记录不存在: ${recordId}`);
    return toIssue(rows[0]);
  }

  async markConditionsRelayed(recordId: string, conditionIds: string[]): Promise<number> {
    if (conditionIds.length === 0) return 0;
    const placeholders = conditionIds.map(() => "?").join(", ");
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE ra2_conditions SET relay = 'relayed', updated_at = ? WHERE record_id = ? AND relay = 'none' AND id IN (${placeholders})`,
      [now(), recordId, ...conditionIds],
    );
    if (result.affectedRows > 0) {
      await this.pool.execute("UPDATE ra2_records SET updated_at = ? WHERE id = ?", [now(), recordId]);
    }
    return result.affectedRows;
  }

  async markConditionsGenerated(conditionIds: string[], testsetId: string): Promise<number> {
    if (conditionIds.length === 0) return 0;
    const placeholders = conditionIds.map(() => "?").join(", ");
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE ra2_conditions SET relay = 'generated', testset_id = ?, updated_at = ? WHERE id IN (${placeholders})`,
      [testsetId, now(), ...conditionIds],
    );
    return result.affectedRows;
  }

  async getRtm(recordId: string): Promise<RtmView> {
    const detail = await this.getRecord(recordId);
    if (!detail) throw new Error(`分析记录不存在: ${recordId}`);
    const reqTextById = new Map(detail.requirements.map((r) => [r.id, r.text]));
    const rows: RtmRow[] = detail.conditions.map((c) => ({
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

  /** 人工新增条件：reqId 归属校验；relay 恒为 none；组内 sort 追加 */
  async createCondition(recordId: string, input: UpsertConditionInput): Promise<TestCondition> {
    const detail = await this.getRecord(recordId);
    if (!detail) throw new Error(`分析记录不存在: ${recordId}`);
    if (!detail.requirements.some((r) => r.id === input.reqId)) {
      throw new Error(`需求条目不存在或不属于该记录: ${input.reqId}`);
    }
    if (input.criterionId && !detail.criteria.some((c) => c.id === input.criterionId)) {
      throw new Error(`验收准则不存在或不属于该记录: ${input.criterionId}`);
    }
    const text = input.text.trim();
    if (!text) throw new Error("条件文本不能为空");
    const siblings = detail.conditions.filter((c) => c.reqId === input.reqId);
    const sort = siblings.length === 0 ? 0 : Math.max(...siblings.map((c) => c.sort)) + 1;
    const id = newId("rcd_");
    const time = now();
    await this.pool.execute(
      "INSERT INTO ra2_conditions (id, record_id, req_id, criterion_id, text, kind, relay, testset_id, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'none', NULL, ?, ?, ?)",
      [id, recordId, input.reqId, input.criterionId ?? null, text, input.kind, sort, time, time],
    );
    await this.pool.execute("UPDATE ra2_records SET updated_at = ? WHERE id = ?", [time, recordId]);
    const [rows] = await this.pool.execute<ConditionRow[]>("SELECT * FROM ra2_conditions WHERE id = ?", [id]);
    return toCondition(rows[0]);
  }

  /** 编辑条件：已接力/已生成拒绝（保护 RTM 关联） */
  async updateCondition(recordId: string, conditionId: string, input: Partial<UpsertConditionInput>): Promise<TestCondition> {
    const [existingRows] = await this.pool.execute<ConditionRow[]>("SELECT * FROM ra2_conditions WHERE id = ?", [conditionId]);
    if (existingRows.length === 0 || existingRows[0].record_id !== recordId) throw new Error(`测试条件不存在: ${conditionId}`);
    const existing = toCondition(existingRows[0]);
    if (existing.relay !== "none") throw new Error(`条件已接力或已生成用例，禁止编辑: ${conditionId}`);
    if (input.reqId !== undefined) {
      const [reqRows] = await this.pool.execute<RowDataPacket[]>("SELECT id FROM ra2_requirements WHERE id = ? AND record_id = ?", [input.reqId, recordId]);
      if (reqRows.length === 0) throw new Error(`需求条目不存在或不属于该记录: ${input.reqId}`);
    }
    const text = input.text !== undefined ? input.text.trim() : existing.text;
    if (!text) throw new Error("条件文本不能为空");
    await this.pool.execute(
      "UPDATE ra2_conditions SET text = ?, kind = ?, req_id = ?, criterion_id = ?, updated_at = ? WHERE id = ?",
      [text, input.kind ?? existing.kind, input.reqId ?? existing.reqId, input.criterionId === undefined ? existing.criterionId : input.criterionId, now(), conditionId],
    );
    await this.pool.execute("UPDATE ra2_records SET updated_at = ? WHERE id = ?", [now(), recordId]);
    const [rows] = await this.pool.execute<ConditionRow[]>("SELECT * FROM ra2_conditions WHERE id = ?", [conditionId]);
    return toCondition(rows[0]);
  }

  /** 删除条件：已接力/已生成拒绝 */
  async deleteCondition(recordId: string, conditionId: string): Promise<void> {
    const [rows] = await this.pool.execute<ConditionRow[]>("SELECT relay FROM ra2_conditions WHERE id = ?", [conditionId]);
    if (rows.length === 0) throw new Error(`测试条件不存在: ${conditionId}`);
    if (rows[0].relay !== "none") throw new Error(`条件已接力或已生成用例，禁止删除: ${conditionId}`);
    const [result] = await this.pool.execute<ResultSetHeader>("DELETE FROM ra2_conditions WHERE id = ? AND record_id = ?", [conditionId, recordId]);
    if (result.affectedRows === 0) throw new Error(`测试条件不存在: ${conditionId}`);
    await this.pool.execute("UPDATE ra2_records SET updated_at = ? WHERE id = ?", [now(), recordId]);
  }

  /** 问题批量状态更新：事务内先校验归属，再统一更新——全成全败 */
  async bulkPatchIssues(recordId: string, issueIds: string[], patch: { status: IssueStatus }): Promise<AnalysisIssue[]> {
    if (issueIds.length === 0) throw new Error("批量更新不能为空");
    const uniqueIds = [...new Set(issueIds)];
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [recordRows] = await connection.execute<RowDataPacket[]>("SELECT id FROM ra2_records WHERE id = ?", [recordId]);
      if (recordRows.length === 0) throw new Error(`分析记录不存在: ${recordId}`);
      const placeholders = uniqueIds.map(() => "?").join(", ");
      const [rows] = await connection.execute<IssueRow[]>(
        `SELECT * FROM ra2_issues WHERE id IN (${placeholders}) FOR UPDATE`,
        uniqueIds,
      );
      if (rows.length !== uniqueIds.length || rows.some((row) => row.record_id !== recordId)) {
        throw new Error("问题不存在或不属于该记录");
      }
      await connection.execute(
        `UPDATE ra2_issues SET status = ?, updated_at = ? WHERE id IN (${placeholders})`,
        [patch.status, now(), ...uniqueIds],
      );
      await connection.execute("UPDATE ra2_records SET updated_at = ? WHERE id = ?", [now(), recordId]);
      await connection.commit();
      return rows.map((row) => toIssue({ ...row, status: patch.status, updated_at: now() }));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
