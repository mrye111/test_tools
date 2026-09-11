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
  created_at: Date | string;
  updated_at: Date | string;
}

function toRecord(row: RecordRow): AnalysisRecord {
  return {
    id: row.id,
    title: row.title,
    sourceFileName: row.source_file_name,
    sourceText: row.source_text,
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
    const [conditionRows] = await this.pool.execute<ConditionRow[]>("SELECT * FROM ra2_conditions WHERE record_id = ? ORDER BY created_at ASC", [id]);
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
    const conditions = input.conditions.map((condition) => ({
      ...condition,
      id: newId("rcd_"),
      reqId: condition.reqId ? (reqIdMap.get(condition.reqId) ?? condition.reqId) : condition.reqId,
      criterionId: condition.criterionId ? (criterionIdMap.get(condition.criterionId) ?? condition.criterionId) : condition.criterionId,
    }));

    await this.pool.execute(
      "INSERT INTO ra2_records (id, title, source_file_name, source_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, input.title, input.sourceFileName ?? null, input.sourceText, time, time],
    );
    for (const req of requirements) {
      await this.pool.execute(
        "INSERT INTO ra2_requirements (id, record_id, parent_id, level, text, sort) VALUES (?, ?, ?, ?, ?, ?)",
        [req.id, id, req.parentId ? (reqIdMap.get(req.parentId) ?? req.parentId) : null, req.level, req.text, req.sort],
      );
    }
    for (const issue of issues) {
      await this.pool.execute(
        "INSERT INTO ra2_issues (id, record_id, req_id, type, severity, quote, description, suggested_question, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [issue.id, id, issue.reqId, issue.type, issue.severity, issue.quote, issue.description, issue.suggestedQuestion, issue.status, time, time],
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
        "INSERT INTO ra2_conditions (id, record_id, req_id, criterion_id, text, kind, relay, testset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [condition.id, id, condition.reqId, condition.criterionId, condition.text, condition.kind, condition.relay, condition.testsetId, time, time],
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
      "INSERT INTO ra2_issues (id, record_id, req_id, type, severity, quote, description, suggested_question, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
      [id, recordId, input.reqId ?? null, input.type, input.severity, input.quote, input.description, input.suggestedQuestion ?? "", time, time],
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
}
