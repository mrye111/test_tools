/** UI 自动化域 MySQL 仓储：at_cases（JSON 列承载步骤/人工项/变量）+ at_compiled_cache（编译缓存）。 */

import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { defaultProjectExt } from "./memory-repository.js";
import { deriveExecutable } from "./plan-validation.js";
import type {
  ActivityAction,
  ActivityEntry,
  AutomationCase,
  AutomationCasePatch,
  AutomationEnvironment,
  AutomationProjectExt,
  AutomationRepository,
  AutomationRunStatus,
  AutomationSet,
  AutomationTestFile,
  CapturedPage,
  CompiledPlan,
  ExecutableLevel,
  ExploreSource,
  ManualItem,
  NewAutomationCase,
  NewCapturedPage,
  NewPlanProposal,
  PlanProposal,
  PlanProposalPatch,
  RunInsightRow,
  RunRecord,
  TestList,
  TestListItem,
  TestSchedule,
} from "./types.js";
import type { AutomationStep } from "./types.js";

export const AUTOMATION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS at_sets (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_at_sets_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_cases (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    case_no VARCHAR(32) NOT NULL,
    title VARCHAR(400) NOT NULL,
    source VARCHAR(24) NOT NULL,
    entry_url VARCHAR(500),
    precondition_text MEDIUMTEXT,
    var_defs JSON,
    steps JSON,
    manual_items JSON,
    executable VARCHAR(12) NOT NULL,
    source_functional_case_id VARCHAR(128),
    source_proposal_id VARCHAR(36),
    compile_hash VARCHAR(64),
    last_run_status VARCHAR(12) NOT NULL DEFAULT 'never',
    last_run_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_at_cases_project (project_id),
    UNIQUE KEY uk_at_cases_proj_no (project_id, case_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_compiled_cache (
    case_ref VARCHAR(128) NOT NULL,
    text_hash VARCHAR(64) NOT NULL,
    plan JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (case_ref, text_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_runs (
    id VARCHAR(36) PRIMARY KEY,
    case_id VARCHAR(36),
    case_no VARCHAR(32),
    title VARCHAR(400),
    engine VARCHAR(16) NOT NULL,
    status VARCHAR(12) NOT NULL,
    verdict VARCHAR(12),
    step_results JSON,
    manual_items JSON,
    entry_url VARCHAR(500),
    cache_id VARCHAR(128),
    report_file VARCHAR(500),
    error TEXT,
    duration_ms INT,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    started_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    root_cause JSON NULL,
    environment_id VARCHAR(64) NULL,
    viewport VARCHAR(32) NULL,
    run_group_id VARCHAR(64) NULL,
    INDEX idx_at_runs_case (case_id),
    INDEX idx_at_runs_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_projects_ext (
    project_id VARCHAR(64) PRIMARY KEY,
    default_env_id VARCHAR(36) NULL,
    extra_instructions MEDIUMTEXT,
    prd_text MEDIUMTEXT,
    run_behavior JSON,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_environments (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    url VARCHAR(500) NOT NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    auth JSON,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_at_env_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_test_files (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    filename VARCHAR(300) NOT NULL,
    path VARCHAR(700) NOT NULL,
    size INT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_at_files_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_sources (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    entry_url VARCHAR(500) NOT NULL,
    status VARCHAR(12) NOT NULL,
    max_pages INT NOT NULL,
    page_count INT NOT NULL DEFAULT 0,
    error TEXT,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    finished_at DATETIME(3) NULL,
    INDEX idx_at_sources_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_captured_pages (
    id VARCHAR(36) PRIMARY KEY,
    source_id VARCHAR(36) NOT NULL,
    url VARCHAR(700) NOT NULL,
    title VARCHAR(300),
    depth INT NOT NULL DEFAULT 0,
    ai_summary MEDIUMTEXT,
    elements JSON,
    screenshot_file VARCHAR(200),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_at_pages_source (source_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_plan_proposals (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    batch_id VARCHAR(36) NOT NULL,
    source_id VARCHAR(36) NULL,
    use_case VARCHAR(200) NOT NULL,
    case_no VARCHAR(32) NOT NULL,
    title VARCHAR(400) NOT NULL,
    goal MEDIUMTEXT,
    expected JSON,
    priority VARCHAR(12) NOT NULL DEFAULT 'medium',
    est_steps JSON,
    included TINYINT(1) NOT NULL DEFAULT 1,
    status VARCHAR(12) NOT NULL DEFAULT 'proposed',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_at_proposals_project (project_id),
    UNIQUE KEY uk_at_proposals_proj_no (project_id, case_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_test_lists (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_test_list_items (
    id VARCHAR(36) PRIMARY KEY,
    list_id VARCHAR(36) NOT NULL,
    case_id VARCHAR(64) NOT NULL,
    added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_at_list_items (list_id, case_id),
    INDEX idx_at_list_items_list (list_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_schedules (
    id VARCHAR(36) PRIMARY KEY,
    list_id VARCHAR(36) NOT NULL,
    cron VARCHAR(100) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_run_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_at_schedules_list (list_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS at_activity (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    actor VARCHAR(100) NOT NULL,
    action VARCHAR(20) NOT NULL,
    detail VARCHAR(500) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_at_activity_project (project_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function initAutomationSchema(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    for (const statement of AUTOMATION_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
    // 老库迁移（CREATE IF NOT EXISTS 不改已有表）：1060=列已存在，1061=索引/约束已存在
    const migrations = [
      "ALTER TABLE at_cases ADD UNIQUE KEY uk_at_cases_proj_no (project_id, case_no)",
      "ALTER TABLE at_cases ADD COLUMN set_id VARCHAR(36) NULL",
      "ALTER TABLE at_cases ADD INDEX idx_at_cases_set (set_id)",
      "ALTER TABLE at_runs ADD COLUMN batch_id VARCHAR(36) NULL",
      "ALTER TABLE at_runs ADD INDEX idx_at_runs_batch (batch_id)",
      "ALTER TABLE at_cases ADD COLUMN source_proposal_id VARCHAR(36) NULL",
      "ALTER TABLE at_runs ADD COLUMN root_cause JSON NULL",
      "ALTER TABLE at_runs ADD COLUMN environment_id VARCHAR(64) NULL",
      "ALTER TABLE at_runs ADD COLUMN viewport VARCHAR(32) NULL",
      "ALTER TABLE at_runs ADD COLUMN run_group_id VARCHAR(64) NULL",
    ];
    for (const statement of migrations) {
      try {
        await connection.query(statement);
      } catch (error) {
        const errno = (error as { errno?: number }).errno;
        if (errno !== 1060 && errno !== 1061) throw error;
      }
    }
  } finally {
    connection.release();
  }
}

interface CaseRow extends RowDataPacket {
  id: string;
  project_id: string;
  set_id: string | null;
  case_no: string;
  title: string;
  source: string;
  entry_url: string | null;
  precondition_text: string | null;
  var_defs: unknown;
  steps: unknown;
  manual_items: unknown;
  executable: string;
  source_functional_case_id: string | null;
  source_proposal_id: string | null;
  compile_hash: string | null;
  last_run_status: string;
  last_run_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CacheRow extends RowDataPacket {
  plan: unknown;
}

interface RunRow extends RowDataPacket {
  id: string;
  case_id: string | null;
  batch_id: string | null;
  case_no: string | null;
  title: string | null;
  engine: string;
  status: string;
  verdict: string | null;
  step_results: unknown;
  manual_items: unknown;
  entry_url: string | null;
  cache_id: string | null;
  report_file: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  root_cause: unknown;
  environment_id: string | null;
  viewport: string | null;
  run_group_id: string | null;
}

function toRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    caseId: row.case_id ?? undefined,
    batchId: row.batch_id ?? undefined,
    caseNo: row.case_no ?? "",
    title: row.title ?? "",
    engine: row.engine as RunRecord["engine"],
    status: row.status as RunRecord["status"],
    verdict: (row.verdict ?? undefined) as RunRecord["verdict"],
    stepResults: toJsonValue<RunRecord["stepResults"]>(row.step_results, []),
    manualItems: toJsonValue<RunRecord["manualItems"]>(row.manual_items, []),
    entryUrl: row.entry_url ?? "",
    cacheId: row.cache_id ?? undefined,
    reportFile: row.report_file ?? undefined,
    error: row.error ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    rootCause: toJsonValue<RunRecord["rootCause"]>(row.root_cause, undefined),
    environmentId: row.environment_id ?? undefined,
    viewport: row.viewport ?? undefined,
    runGroupId: row.run_group_id ?? undefined,
  };
}

function toIso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** mysql2 对 JSON 列可能返回已解析对象或字符串，统一为对象。 */
function toJsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function toCase(row: CaseRow): AutomationCase {
  return {
    id: row.id,
    projectId: row.project_id,
    setId: row.set_id ?? undefined,
    caseNo: row.case_no,
    title: row.title,
    source: row.source as AutomationCase["source"],
    entryUrl: row.entry_url ?? "",
    preconditionText: row.precondition_text ?? "",
    varDefs: toJsonValue<Record<string, string>>(row.var_defs, {}),
    steps: toJsonValue<AutomationStep[]>(row.steps, []),
    manualItems: toJsonValue<ManualItem[]>(row.manual_items, []),
    executable: row.executable as ExecutableLevel,
    sourceFunctionalCaseId: row.source_functional_case_id ?? undefined,
    sourceProposalId: row.source_proposal_id ?? undefined,
    compileHash: row.compile_hash ?? undefined,
    lastRunStatus: row.last_run_status as AutomationRunStatus,
    lastRunAt: toIso(row.last_run_at),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

export class MysqlAutomationRepository implements AutomationRepository {
  constructor(private pool: Pool) {}

  async listSets(projectId?: string): Promise<AutomationSet[]> {
    const [rows] = projectId
      ? await this.pool.query<RowDataPacket[]>("SELECT * FROM at_sets WHERE project_id = ? ORDER BY name", [projectId])
      : await this.pool.query<RowDataPacket[]>("SELECT * FROM at_sets ORDER BY project_id, name");
    return rows.map((row) => ({
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    }));
  }

  async createSet(input: { projectId: string; name: string }): Promise<AutomationSet> {
    const record: AutomationSet = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    await this.pool.query("INSERT INTO at_sets (id, project_id, name, created_at) VALUES (?, ?, ?, ?)", [
      record.id,
      record.projectId,
      record.name,
      toDate(record.createdAt) ?? new Date(),
    ]);
    return record;
  }

  async updateSet(id: string, patch: { name: string }): Promise<AutomationSet | null> {
    const [result] = await this.pool.query("UPDATE at_sets SET name = ? WHERE id = ?", [patch.name, id]);
    if ((result as { affectedRows?: number }).affectedRows !== 1) return null;
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM at_sets WHERE id = ?", [id]);
    if (rows.length === 0) return null;
    return {
      id: rows[0].id as string,
      projectId: rows[0].project_id as string,
      name: rows[0].name as string,
      createdAt: toIso(rows[0].created_at) ?? new Date(0).toISOString(),
    };
  }

  async deleteSet(id: string): Promise<boolean> {
    const [result] = await this.pool.query("DELETE FROM at_sets WHERE id = ?", [id]);
    if ((result as { affectedRows?: number }).affectedRows !== 1) return false;
    await this.pool.query("UPDATE at_cases SET set_id = NULL WHERE set_id = ?", [id]);
    return true;
  }

  async listCases(projectId?: string, setId?: string): Promise<AutomationCase[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (projectId) {
      conditions.push("project_id = ?");
      params.push(projectId);
    }
    if (setId) {
      conditions.push("set_id = ?");
      params.push(setId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await this.pool.query<CaseRow[]>(`SELECT * FROM at_cases ${where} ORDER BY project_id, case_no`, params);
    return rows.map(toCase);
  }

  async getCase(id: string): Promise<AutomationCase | null> {
    const [rows] = await this.pool.query<CaseRow[]>("SELECT * FROM at_cases WHERE id = ?", [id]);
    return rows.length > 0 ? toCase(rows[0]) : null;
  }

  async createCase(input: NewAutomationCase): Promise<AutomationCase> {
    const steps = input.steps ?? [];
    const manualItems = input.manualItems ?? [];
    // 唯一约束兜底并发；1062 冲突时有界重算编号重试（评审 H1）
    for (let attempt = 0; attempt < 3; attempt++) {
      const record: AutomationCase = {
        id: randomUUID(),
        projectId: input.projectId,
        setId: input.setId,
        caseNo: await this.nextCaseNo(input.projectId),
        title: input.title,
        source: input.source ?? "manual",
        entryUrl: input.entryUrl ?? "",
        preconditionText: input.preconditionText ?? "",
        varDefs: input.varDefs ?? {},
        steps,
        manualItems,
        executable: deriveExecutable(steps.filter((s) => s.enabled).length, manualItems.length),
        sourceFunctionalCaseId: input.sourceFunctionalCaseId,
        sourceProposalId: input.sourceProposalId,
        compileHash: input.compileHash,
        lastRunStatus: "never",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      try {
        await this.pool.query(
          `INSERT INTO at_cases (id, project_id, set_id, case_no, title, source, entry_url, precondition_text, var_defs, steps, manual_items, executable, source_functional_case_id, source_proposal_id, compile_hash, last_run_status, last_run_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.id,
            record.projectId,
            record.setId ?? null,
            record.caseNo,
            record.title,
            record.source,
            record.entryUrl,
            record.preconditionText,
            JSON.stringify(record.varDefs),
            JSON.stringify(record.steps),
            JSON.stringify(record.manualItems),
            record.executable,
            record.sourceFunctionalCaseId ?? null,
            record.sourceProposalId ?? null,
            record.compileHash ?? null,
            record.lastRunStatus,
            null,
            toDate(record.createdAt) ?? new Date(),
            toDate(record.updatedAt) ?? new Date(),
          ],
        );
        return record;
      } catch (error) {
        if ((error as { errno?: number }).errno !== 1062 || attempt === 2) throw error;
      }
    }
    throw new Error("分配用例编号失败");
  }

  async updateCase(id: string, patch: AutomationCasePatch): Promise<AutomationCase | null> {
    const existing = await this.getCase(id);
    if (!existing) return null;
    const steps = patch.steps ?? existing.steps;
    const manualItems = patch.manualItems ?? existing.manualItems;
    const merged: AutomationCase = {
      ...existing,
      ...patch,
      steps,
      manualItems,
      executable: deriveExecutable(steps.filter((s) => s.enabled).length, manualItems.length),
      updatedAt: new Date().toISOString(),
    };
    await this.pool.query(
      `UPDATE at_cases SET title = ?, source = ?, entry_url = ?, precondition_text = ?, var_defs = ?, steps = ?, manual_items = ?, executable = ?, source_functional_case_id = ?, source_proposal_id = ?, compile_hash = ?, last_run_status = ?, last_run_at = ?, updated_at = ?, set_id = ? WHERE id = ?`,
      [
        merged.title,
        merged.source,
        merged.entryUrl,
        merged.preconditionText,
        JSON.stringify(merged.varDefs),
        JSON.stringify(merged.steps),
        JSON.stringify(merged.manualItems),
        merged.executable,
        merged.sourceFunctionalCaseId ?? null,
        merged.sourceProposalId ?? null,
        merged.compileHash ?? null,
        merged.lastRunStatus,
        toDate(merged.lastRunAt),
        toDate(merged.updatedAt) ?? new Date(),
        merged.setId ?? null,
        id,
      ],
    );
    return merged;
  }

  async updateCaseRunStatus(id: string, status: AutomationRunStatus, at: string): Promise<void> {
    await this.pool.query("UPDATE at_cases SET last_run_status = ?, last_run_at = ? WHERE id = ?", [
      status,
      toDate(at),
      id,
    ]);
  }

  async deleteCase(id: string): Promise<boolean> {
    const [result] = await this.pool.query("DELETE FROM at_cases WHERE id = ?", [id]);
    return (result as { affectedRows?: number }).affectedRows === 1;
  }

  async getCompiledCache(caseRef: string, textHash: string): Promise<CompiledPlan | null> {
    const [rows] = await this.pool.query<CacheRow[]>(
      "SELECT plan FROM at_compiled_cache WHERE case_ref = ? AND text_hash = ?",
      [caseRef, textHash],
    );
    if (rows.length === 0) return null;
    return toJsonValue<CompiledPlan | null>(rows[0].plan, null);
  }

  async putCompiledCache(caseRef: string, textHash: string, plan: CompiledPlan): Promise<void> {
    await this.pool.query("REPLACE INTO at_compiled_cache (case_ref, text_hash, plan) VALUES (?, ?, ?)", [
      caseRef,
      textHash,
      JSON.stringify(plan),
    ]);
  }

  async createRunRecord(record: RunRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO at_runs (id, case_id, batch_id, case_no, title, engine, status, verdict, step_results, manual_items, entry_url, cache_id, report_file, error, duration_ms, created_at, started_at, finished_at, root_cause, environment_id, viewport, run_group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.caseId ?? null,
        record.batchId ?? null,
        record.caseNo,
        record.title,
        record.engine,
        record.status,
        record.verdict ?? null,
        JSON.stringify(record.stepResults),
        JSON.stringify(record.manualItems),
        record.entryUrl,
        record.cacheId ?? null,
        record.reportFile ?? null,
        record.error ?? null,
        record.durationMs ?? null,
        toDate(record.createdAt) ?? new Date(),
        toDate(record.startedAt),
        toDate(record.finishedAt),
        record.rootCause ? JSON.stringify(record.rootCause) : null,
        record.environmentId ?? null,
        record.viewport ?? null,
        record.runGroupId ?? null,
      ],
    );
  }

  async updateRunRecord(id: string, patch: Partial<RunRecord>): Promise<void> {
    const existing = await this.getRunRecord(id);
    if (!existing) return;
    const merged: RunRecord = { ...existing, ...patch, id };
    await this.pool.query(
      `UPDATE at_runs SET status = ?, verdict = ?, step_results = ?, report_file = ?, error = ?, duration_ms = ?, started_at = ?, finished_at = ?, root_cause = ? WHERE id = ?`,
      [
        merged.status,
        merged.verdict ?? null,
        JSON.stringify(merged.stepResults),
        merged.reportFile ?? null,
        merged.error ?? null,
        merged.durationMs ?? null,
        toDate(merged.startedAt),
        toDate(merged.finishedAt),
        merged.rootCause ? JSON.stringify(merged.rootCause) : null,
        id,
      ],
    );
  }

  async getRunRecord(id: string): Promise<RunRecord | null> {
    const [rows] = await this.pool.query<RunRow[]>("SELECT * FROM at_runs WHERE id = ?", [id]);
    return rows.length > 0 ? toRun(rows[0]) : null;
  }

  async listRunRecords(caseId?: string, limit = 50): Promise<RunRecord[]> {
    const [rows] = caseId
      ? await this.pool.query<RunRow[]>("SELECT * FROM at_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT ?", [caseId, limit])
      : await this.pool.query<RunRow[]>("SELECT * FROM at_runs ORDER BY created_at DESC LIMIT ?", [limit]);
    return rows.map(toRun);
  }

  async listRunsByBatch(batchId: string): Promise<RunRecord[]> {
    const [rows] = await this.pool.query<RunRow[]>(
      "SELECT * FROM at_runs WHERE batch_id = ? ORDER BY created_at",
      [batchId],
    );
    return rows.map(toRun);
  }

  /** 取该项目现有 ATC-N 编号的最大值 +1（COUNT 法在删除中间记录后会重复，评审 H1）。 */
  private async nextCaseNo(projectId: string): Promise<string> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT MAX(CAST(SUBSTRING(case_no, 5) AS UNSIGNED)) AS maxNo FROM at_cases WHERE project_id = ? AND case_no REGEXP '^ATC-[0-9]+$'",
      [projectId],
    );
    const maxNo = Number(rows[0]?.maxNo ?? 0);
    return `ATC-${String(maxNo + 1).padStart(3, "0")}`;
  }

  // ── P1 项目化外壳 ────────────────────────────────────────────────────────

  async getProjectExt(projectId: string): Promise<AutomationProjectExt> {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM at_projects_ext WHERE project_id = ?", [projectId]);
    if (rows.length === 0) return defaultProjectExt(projectId);
    const row = rows[0];
    return {
      projectId,
      defaultEnvId: (row.default_env_id as string | null) ?? undefined,
      extraInstructions: (row.extra_instructions as string | null) ?? "",
      prdText: (row.prd_text as string | null) ?? "",
      runBehavior: toJsonValue<AutomationProjectExt["runBehavior"]>(row.run_behavior, defaultProjectExt(projectId).runBehavior),
      updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
    };
  }

  async upsertProjectExt(input: Omit<AutomationProjectExt, "updatedAt">): Promise<AutomationProjectExt> {
    await this.pool.query(
      `INSERT INTO at_projects_ext (project_id, default_env_id, extra_instructions, prd_text, run_behavior)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE default_env_id = VALUES(default_env_id), extra_instructions = VALUES(extra_instructions), prd_text = VALUES(prd_text), run_behavior = VALUES(run_behavior)`,
      [
        input.projectId,
        input.defaultEnvId ?? null,
        input.extraInstructions,
        input.prdText,
        JSON.stringify(input.runBehavior),
      ],
    );
    return this.getProjectExt(input.projectId);
  }

  async listEnvironments(projectId: string): Promise<AutomationEnvironment[]> {
    const [rows] = await this.pool.query<EnvRow[]>(
      "SELECT * FROM at_environments WHERE project_id = ? ORDER BY is_default DESC, created_at",
      [projectId],
    );
    return rows.map(toEnvironment);
  }

  async createEnvironment(input: Omit<AutomationEnvironment, "id" | "createdAt">): Promise<AutomationEnvironment> {
    const record: AutomationEnvironment = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.pool.query(
      "INSERT INTO at_environments (id, project_id, name, url, is_default, auth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [record.id, record.projectId, record.name, record.url, record.isDefault ? 1 : 0, JSON.stringify(record.auth), toDate(record.createdAt) ?? new Date()],
    );
    return record;
  }

  async updateEnvironment(
    id: string,
    patch: Partial<Omit<AutomationEnvironment, "id" | "projectId" | "createdAt">>,
  ): Promise<AutomationEnvironment | null> {
    const existing = await this.getEnvironment(id);
    if (!existing) return null;
    const merged: AutomationEnvironment = { ...existing, ...patch };
    await this.pool.query("UPDATE at_environments SET name = ?, url = ?, is_default = ?, auth = ? WHERE id = ?", [
      merged.name,
      merged.url,
      merged.isDefault ? 1 : 0,
      JSON.stringify(merged.auth),
      id,
    ]);
    return merged;
  }

  async deleteEnvironment(id: string): Promise<boolean> {
    const [result] = await this.pool.query("DELETE FROM at_environments WHERE id = ?", [id]);
    return (result as { affectedRows?: number }).affectedRows === 1;
  }

  async setDefaultEnvironment(projectId: string, id: string): Promise<void> {
    await this.pool.query("UPDATE at_environments SET is_default = (id = ?) WHERE project_id = ?", [id, projectId]);
  }

  async listTestFiles(projectId: string): Promise<AutomationTestFile[]> {
    const [rows] = await this.pool.query<TestFileRow[]>(
      "SELECT * FROM at_test_files WHERE project_id = ? ORDER BY created_at DESC",
      [projectId],
    );
    return rows.map(toTestFile);
  }

  async addTestFile(input: Omit<AutomationTestFile, "id" | "createdAt">): Promise<AutomationTestFile> {
    const record: AutomationTestFile = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.pool.query(
      "INSERT INTO at_test_files (id, project_id, filename, path, size, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [record.id, record.projectId, record.filename, record.path, record.size, toDate(record.createdAt) ?? new Date()],
    );
    return record;
  }

  async deleteTestFile(id: string): Promise<AutomationTestFile | null> {
    const found = await this.getTestFile(id);
    if (!found) return null;
    await this.pool.query("DELETE FROM at_test_files WHERE id = ?", [id]);
    return found;
  }

  // ── P2 探源 ──────────────────────────────────────────────────────────────

  async createSource(input: { projectId: string; entryUrl: string; maxPages: number }): Promise<ExploreSource> {
    const record: ExploreSource = {
      id: randomUUID(),
      projectId: input.projectId,
      entryUrl: input.entryUrl,
      status: "running",
      maxPages: input.maxPages,
      pageCount: 0,
      createdAt: new Date().toISOString(),
    };
    await this.pool.query(
      "INSERT INTO at_sources (id, project_id, entry_url, status, max_pages, page_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [record.id, record.projectId, record.entryUrl, record.status, record.maxPages, record.pageCount, toDate(record.createdAt) ?? new Date()],
    );
    return record;
  }

  async getSource(id: string): Promise<ExploreSource | null> {
    const [rows] = await this.pool.query<SourceRow[]>("SELECT * FROM at_sources WHERE id = ?", [id]);
    return rows.length > 0 ? toSource(rows[0]) : null;
  }

  async listSources(projectId: string): Promise<ExploreSource[]> {
    const [rows] = await this.pool.query<SourceRow[]>(
      "SELECT * FROM at_sources WHERE project_id = ? ORDER BY created_at DESC",
      [projectId],
    );
    return rows.map(toSource);
  }

  async updateSource(
    id: string,
    patch: Partial<Pick<ExploreSource, "status" | "pageCount" | "error" | "finishedAt">>,
  ): Promise<ExploreSource | null> {
    const existing = await this.getSource(id);
    if (!existing) return null;
    const merged: ExploreSource = { ...existing, ...patch };
    await this.pool.query(
      "UPDATE at_sources SET status = ?, page_count = ?, error = ?, finished_at = ? WHERE id = ?",
      [merged.status, merged.pageCount, merged.error ?? null, toDate(merged.finishedAt), id],
    );
    return merged;
  }

  async deleteSource(id: string): Promise<{ source: ExploreSource; screenshots: string[] } | null> {
    const found = await this.getSource(id);
    if (!found) return null;
    const [pages] = await this.pool.query<CapturedPageRow[]>(
      "SELECT screenshot_file FROM at_captured_pages WHERE source_id = ?",
      [id],
    );
    await this.pool.query("DELETE FROM at_captured_pages WHERE source_id = ?", [id]);
    await this.pool.query("DELETE FROM at_sources WHERE id = ?", [id]);
    return {
      source: found,
      screenshots: pages.map((p) => p.screenshot_file).filter((f): f is string => Boolean(f)),
    };
  }

  async addCapturedPage(input: NewCapturedPage): Promise<CapturedPage> {
    const record: CapturedPage = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.pool.query(
      "INSERT INTO at_captured_pages (id, source_id, url, title, depth, ai_summary, elements, screenshot_file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        record.id,
        record.sourceId,
        record.url,
        record.title,
        record.depth,
        record.aiSummary,
        JSON.stringify(record.elements),
        record.screenshotFile ?? null,
        toDate(record.createdAt) ?? new Date(),
      ],
    );
    return record;
  }

  async listCapturedPages(sourceId: string): Promise<CapturedPage[]> {
    const [rows] = await this.pool.query<CapturedPageRow[]>(
      "SELECT * FROM at_captured_pages WHERE source_id = ? ORDER BY created_at",
      [sourceId],
    );
    return rows.map(toCapturedPage);
  }

  async getCapturedPage(id: string): Promise<CapturedPage | null> {
    const [rows] = await this.pool.query<CapturedPageRow[]>("SELECT * FROM at_captured_pages WHERE id = ?", [id]);
    return rows.length > 0 ? toCapturedPage(rows[0]) : null;
  }

  private async getEnvironment(id: string): Promise<AutomationEnvironment | null> {
    const [rows] = await this.pool.query<EnvRow[]>("SELECT * FROM at_environments WHERE id = ?", [id]);
    return rows.length > 0 ? toEnvironment(rows[0]) : null;
  }

  private async getTestFile(id: string): Promise<AutomationTestFile | null> {
    const [rows] = await this.pool.query<TestFileRow[]>("SELECT * FROM at_test_files WHERE id = ?", [id]);
    return rows.length > 0 ? toTestFile(rows[0]) : null;
  }

  // ── P3 规划提案 ──────────────────────────────────────────────────────────

  async createProposals(inputs: NewPlanProposal[]): Promise<PlanProposal[]> {
    if (inputs.length === 0) return [];
    const projectId = inputs[0].projectId;
    for (let attempt = 0; attempt < 3; attempt++) {
      let nextNo = await this.nextProposalNo(projectId);
      const records = inputs.map((input): PlanProposal => {
        const record: PlanProposal = {
          ...input,
          id: randomUUID(),
          caseNo: `ATP-${String(nextNo++).padStart(3, "0")}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return record;
      });
      const inserted: string[] = [];
      try {
        for (const record of records) {
          await this.pool.query(
            `INSERT INTO at_plan_proposals (id, project_id, batch_id, source_id, use_case, case_no, title, goal, expected, priority, est_steps, included, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              record.id,
              record.projectId,
              record.batchId,
              record.sourceId ?? null,
              record.useCase,
              record.caseNo,
              record.title,
              record.goal,
              JSON.stringify(record.expected),
              record.priority,
              JSON.stringify(record.estSteps),
              record.included ? 1 : 0,
              record.status,
              toDate(record.createdAt) ?? new Date(),
              toDate(record.updatedAt) ?? new Date(),
            ],
          );
          inserted.push(record.id);
        }
        return records;
      } catch (error) {
        // 唯一约束兜底并发；重试前清掉本批已插入的行，避免半批残留（评审 H1 同款）
        if ((error as { errno?: number }).errno !== 1062 || attempt === 2) {
          if (inserted.length > 0) {
            await this.pool.query(`DELETE FROM at_plan_proposals WHERE id IN (${inserted.map(() => "?").join(",")})`, inserted);
          }
          throw error;
        }
        if (inserted.length > 0) {
          await this.pool.query(`DELETE FROM at_plan_proposals WHERE id IN (${inserted.map(() => "?").join(",")})`, inserted);
        }
      }
    }
    throw new Error("分配提案编号失败");
  }

  async listProposals(projectId: string): Promise<PlanProposal[]> {
    const [rows] = await this.pool.query<ProposalRow[]>(
      "SELECT * FROM at_plan_proposals WHERE project_id = ? ORDER BY created_at DESC, case_no",
      [projectId],
    );
    return rows.map(toProposal);
  }

  async getProposal(id: string): Promise<PlanProposal | null> {
    const [rows] = await this.pool.query<ProposalRow[]>("SELECT * FROM at_plan_proposals WHERE id = ?", [id]);
    return rows.length > 0 ? toProposal(rows[0]) : null;
  }

  async updateProposal(id: string, patch: PlanProposalPatch): Promise<PlanProposal | null> {
    const existing = await this.getProposal(id);
    if (!existing) return null;
    const merged: PlanProposal = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.pool.query(
      "UPDATE at_plan_proposals SET title = ?, goal = ?, expected = ?, priority = ?, est_steps = ?, included = ?, status = ?, updated_at = ? WHERE id = ?",
      [
        merged.title,
        merged.goal,
        JSON.stringify(merged.expected),
        merged.priority,
        JSON.stringify(merged.estSteps),
        merged.included ? 1 : 0,
        merged.status,
        toDate(merged.updatedAt) ?? new Date(),
        id,
      ],
    );
    return merged;
  }

  async deleteProposal(id: string): Promise<boolean> {
    const [result] = await this.pool.query("DELETE FROM at_plan_proposals WHERE id = ?", [id]);
    return (result as { affectedRows?: number }).affectedRows === 1;
  }

  /** 取该项目现有 ATP-N 编号的最大值 +1（与 at_cases 的 ATC-N 同法，评审 H1）。 */
  private async nextProposalNo(projectId: string): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT MAX(CAST(SUBSTRING(case_no, 5) AS UNSIGNED)) AS maxNo FROM at_plan_proposals WHERE project_id = ? AND case_no REGEXP '^ATP-[0-9]+$'",
      [projectId],
    );
    return Number(rows[0]?.maxNo ?? 0) + 1;
  }

  // ── P5 Test Lists / Schedules ────────────────────────────────────────────

  async listTestLists(): Promise<TestList[]> {
    const [rows] = await this.pool.query<ListRow[]>("SELECT * FROM at_test_lists ORDER BY created_at DESC");
    return rows.map(toTestList);
  }

  async getTestList(id: string): Promise<TestList | null> {
    const [rows] = await this.pool.query<ListRow[]>("SELECT * FROM at_test_lists WHERE id = ?", [id]);
    return rows.length > 0 ? toTestList(rows[0]) : null;
  }

  async createTestList(input: { name: string; description?: string }): Promise<TestList> {
    const id = randomUUID();
    await this.pool.query("INSERT INTO at_test_lists (id, name, description) VALUES (?, ?, ?)", [
      id,
      input.name,
      input.description ?? "",
    ]);
    return { id, name: input.name, description: input.description ?? "", createdAt: new Date().toISOString() };
  }

  async deleteTestList(id: string): Promise<boolean> {
    const [result] = await this.pool.query("DELETE FROM at_test_lists WHERE id = ?", [id]);
    if ((result as { affectedRows?: number }).affectedRows !== 1) return false;
    await this.pool.query("DELETE FROM at_test_list_items WHERE list_id = ?", [id]);
    await this.pool.query("DELETE FROM at_schedules WHERE list_id = ?", [id]);
    return true;
  }

  async listTestListItems(listId: string): Promise<TestListItem[]> {
    const [rows] = await this.pool.query<ListItemRow[]>(
      "SELECT * FROM at_test_list_items WHERE list_id = ? ORDER BY added_at ASC",
      [listId],
    );
    return rows.map(toTestListItem);
  }

  async addTestListItem(input: { listId: string; caseId: string }): Promise<TestListItem> {
    const [existing] = await this.pool.query<ListItemRow[]>(
      "SELECT * FROM at_test_list_items WHERE list_id = ? AND case_id = ?",
      [input.listId, input.caseId],
    );
    if (existing.length > 0) return toTestListItem(existing[0]);
    const id = randomUUID();
    await this.pool.query("INSERT INTO at_test_list_items (id, list_id, case_id) VALUES (?, ?, ?)", [
      id,
      input.listId,
      input.caseId,
    ]);
    return { id, listId: input.listId, caseId: input.caseId, addedAt: new Date().toISOString() };
  }

  async removeTestListItem(id: string): Promise<boolean> {
    const [result] = await this.pool.query("DELETE FROM at_test_list_items WHERE id = ?", [id]);
    return (result as { affectedRows?: number }).affectedRows === 1;
  }

  async listSchedules(listId?: string): Promise<TestSchedule[]> {
    const [rows] = listId
      ? await this.pool.query<ScheduleRow[]>("SELECT * FROM at_schedules WHERE list_id = ? ORDER BY created_at ASC", [listId])
      : await this.pool.query<ScheduleRow[]>("SELECT * FROM at_schedules ORDER BY created_at ASC");
    return rows.map(toSchedule);
  }

  async createSchedule(input: { listId: string; cron: string; enabled?: boolean }): Promise<TestSchedule> {
    const id = randomUUID();
    const enabled = input.enabled ?? true;
    await this.pool.query("INSERT INTO at_schedules (id, list_id, cron, enabled) VALUES (?, ?, ?, ?)", [
      id,
      input.listId,
      input.cron,
      enabled ? 1 : 0,
    ]);
    return { id, listId: input.listId, cron: input.cron, enabled, createdAt: new Date().toISOString() };
  }

  async updateSchedule(id: string, patch: Partial<Pick<TestSchedule, "cron" | "enabled" | "lastRunAt">>): Promise<TestSchedule | null> {
    const [rows] = await this.pool.query<ScheduleRow[]>("SELECT * FROM at_schedules WHERE id = ?", [id]);
    if (rows.length === 0) return null;
    const updated: TestSchedule = { ...toSchedule(rows[0]), ...patch };
    await this.pool.query("UPDATE at_schedules SET cron = ?, enabled = ?, last_run_at = ? WHERE id = ?", [
      updated.cron,
      updated.enabled ? 1 : 0,
      toDate(updated.lastRunAt),
      id,
    ]);
    return updated;
  }

  async deleteSchedule(id: string): Promise<boolean> {
    const [result] = await this.pool.query("DELETE FROM at_schedules WHERE id = ?", [id]);
    return (result as { affectedRows?: number }).affectedRows === 1;
  }

  // ── P6 Insights / Activity ───────────────────────────────────────────────

  async listRunsForProject(projectId: string, limit = 500): Promise<RunInsightRow[]> {
    const take = Math.max(1, Math.min(limit, 2000));
    const [rows] = await this.pool.query<InsightRunRow[]>(
      `SELECT r.id, r.case_id, r.case_no, r.title, r.engine, r.verdict, r.duration_ms, r.created_at
       FROM at_runs r JOIN at_cases c ON r.case_id = c.id
       WHERE c.project_id = ?
       ORDER BY r.created_at DESC LIMIT ?`,
      [projectId, take],
    );
    return rows.map(toRunInsightRow);
  }

  async addActivity(input: { projectId: string; actor: string; action: ActivityAction; detail: string }): Promise<void> {
    await this.pool.query("INSERT INTO at_activity (id, project_id, actor, action, detail) VALUES (?, ?, ?, ?, ?)", [
      randomUUID(),
      input.projectId,
      input.actor,
      input.action,
      input.detail,
    ]);
  }

  async listActivities(projectId: string, limit = 50): Promise<ActivityEntry[]> {
    const take = Math.max(1, Math.min(limit, 200));
    const [rows] = await this.pool.query<ActivityRow[]>(
      "SELECT * FROM at_activity WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
      [projectId, take],
    );
    return rows.map(toActivity);
  }
}

interface EnvRow extends RowDataPacket {
  id: string;
  project_id: string;
  name: string;
  url: string;
  is_default: number;
  auth: unknown;
  created_at: Date | string;
}

interface TestFileRow extends RowDataPacket {
  id: string;
  project_id: string;
  filename: string;
  path: string;
  size: number;
  created_at: Date | string;
}

interface SourceRow extends RowDataPacket {
  id: string;
  project_id: string;
  entry_url: string;
  status: string;
  max_pages: number;
  page_count: number;
  error: string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
}

interface CapturedPageRow extends RowDataPacket {
  id: string;
  source_id: string;
  url: string;
  title: string | null;
  depth: number;
  ai_summary: string | null;
  elements: unknown;
  screenshot_file: string | null;
  created_at: Date | string;
}

function toSource(row: SourceRow): ExploreSource {
  return {
    id: row.id,
    projectId: row.project_id,
    entryUrl: row.entry_url,
    status: row.status as ExploreSource["status"],
    maxPages: row.max_pages,
    pageCount: row.page_count,
    error: row.error ?? undefined,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    finishedAt: toIso(row.finished_at),
  };
}

function toCapturedPage(row: CapturedPageRow): CapturedPage {
  return {
    id: row.id,
    sourceId: row.source_id,
    url: row.url,
    title: row.title ?? "",
    depth: row.depth,
    aiSummary: row.ai_summary ?? "",
    elements: toJsonValue<CapturedPage["elements"]>(row.elements, []),
    screenshotFile: row.screenshot_file ?? undefined,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

function toEnvironment(row: EnvRow): AutomationEnvironment {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    url: row.url,
    isDefault: row.is_default === 1,
    auth: toJsonValue<AutomationEnvironment["auth"]>(row.auth, { kind: "none" }),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

function toTestFile(row: TestFileRow): AutomationTestFile {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    path: row.path,
    size: row.size,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

interface ProposalRow extends RowDataPacket {
  id: string;
  project_id: string;
  batch_id: string;
  source_id: string | null;
  use_case: string;
  case_no: string;
  title: string;
  goal: string | null;
  expected: unknown;
  priority: string;
  est_steps: unknown;
  included: number;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function toProposal(row: ProposalRow): PlanProposal {
  return {
    id: row.id,
    projectId: row.project_id,
    batchId: row.batch_id,
    sourceId: row.source_id ?? undefined,
    useCase: row.use_case,
    caseNo: row.case_no,
    title: row.title,
    goal: row.goal ?? "",
    expected: toJsonValue<PlanProposal["expected"]>(row.expected, []),
    priority: row.priority as PlanProposal["priority"],
    estSteps: toJsonValue<PlanProposal["estSteps"]>(row.est_steps, []),
    included: row.included === 1,
    status: row.status as PlanProposal["status"],
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

interface ListRow extends RowDataPacket {
  id: string;
  name: string;
  description: string | null;
  created_at: Date | string;
}

function toTestList(row: ListRow): TestList {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

interface ListItemRow extends RowDataPacket {
  id: string;
  list_id: string;
  case_id: string;
  added_at: Date | string;
}

function toTestListItem(row: ListItemRow): TestListItem {
  return {
    id: row.id,
    listId: row.list_id,
    caseId: row.case_id,
    addedAt: toIso(row.added_at) ?? new Date(0).toISOString(),
  };
}

interface ScheduleRow extends RowDataPacket {
  id: string;
  list_id: string;
  cron: string;
  enabled: number;
  last_run_at: Date | string | null;
  created_at: Date | string;
}

function toSchedule(row: ScheduleRow): TestSchedule {
  return {
    id: row.id,
    listId: row.list_id,
    cron: row.cron,
    enabled: row.enabled === 1,
    lastRunAt: toIso(row.last_run_at ?? undefined),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

interface InsightRunRow extends RowDataPacket {
  id: string;
  case_id: string | null;
  case_no: string;
  title: string;
  engine: string;
  verdict: string | null;
  duration_ms: number | null;
  created_at: Date | string;
}

function toRunInsightRow(row: InsightRunRow): RunInsightRow {
  return {
    id: row.id,
    caseId: row.case_id ?? undefined,
    caseNo: row.case_no,
    title: row.title,
    engine: row.engine as RunInsightRow["engine"],
    verdict: (row.verdict as RunInsightRow["verdict"]) ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

interface ActivityRow extends RowDataPacket {
  id: string;
  project_id: string;
  actor: string;
  action: string;
  detail: string;
  created_at: Date | string;
}

function toActivity(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    actor: row.actor,
    action: row.action as ActivityAction,
    detail: row.detail,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}
