import { randomUUID } from "crypto";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import {
  type CreateProjectInput,
  type CreateRunInput,
  type LoadTestProject,
  type LoadTestProjectSummary,
  type LoadTestRepository,
  type LoadTestRun,
  type LoadTestRunStatus,
  type LoadTestRunSummary,
  type UpdateProjectInput,
  type UpdateRunInput,
  MAX_LOADTEST_PROJECTS,
  MAX_LOADTEST_RUNS_PER_PROJECT,
} from "./types.js";

function newId(prefix: string): string {
  // Schema 中 id 列为 VARCHAR(36)，前缀 4 字符 + 31 字符 UUID 截断，确保符合约束
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 31)}`;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof value === "number") return new Date(value);
  return new Date();
}

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
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

function toStringMap(value: unknown): Record<string, string> {
  const parsed = toJsonValue(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
    result[key] = typeof item === "string" ? item : String(item);
  }
  return result;
}

interface ProjectRow extends RowDataPacket {
  id: string;
  name: string;
  description: string;
  target_base_url: string;
  script_source: string;
  payload_template: string | null;
  env_vars: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RunRow extends RowDataPacket {
  id: string;
  project_id: string;
  status: string;
  env_snapshot: unknown;
  script_snapshot: string;
  log_tail: string;
  summary_text: string | null;
  exit_code: number | null;
  error: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  ended_at: Date | string | null;
}

function toProject(row: ProjectRow): LoadTestProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    targetBaseUrl: row.target_base_url,
    scriptSource: row.script_source,
    payloadTemplate: row.payload_template,
    envVars: toStringMap(row.env_vars),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toProjectSummary(row: ProjectRow): LoadTestProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    targetBaseUrl: row.target_base_url,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toRun(row: RunRow): LoadTestRun {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status as LoadTestRunStatus,
    envSnapshot: toStringMap(row.env_snapshot),
    scriptSnapshot: row.script_snapshot,
    logTail: row.log_tail,
    summaryText: row.summary_text,
    exitCode: row.exit_code,
    error: row.error,
    createdAt: toDate(row.created_at),
    startedAt: toDateOrNull(row.started_at),
    endedAt: toDateOrNull(row.ended_at),
  };
}

function toRunSummary(row: RunRow): LoadTestRunSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status as LoadTestRunStatus,
    exitCode: row.exit_code,
    error: row.error,
    summaryText: row.summary_text,
    createdAt: toDate(row.created_at),
    startedAt: toDateOrNull(row.started_at),
    endedAt: toDateOrNull(row.ended_at),
  };
}

/** MySQL 版 LoadTestRepository：lt_projects / lt_runs 两表。 */
export class MysqlLoadTestRepository implements LoadTestRepository {
  constructor(private pool: Pool) {}

  async listProjects(limit = 20, offset = 0): Promise<LoadTestProjectSummary[]> {
    const take = Math.max(1, Math.min(limit, 100));
    const skip = Math.max(0, offset);
    const [rows] = await this.pool.query<ProjectRow[]>(
      "SELECT * FROM lt_projects ORDER BY updated_at DESC LIMIT ? OFFSET ?",
      [take, skip],
    );
    return rows.map(toProjectSummary);
  }

  async countProjects(): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM lt_projects");
    return Number(rows[0]?.total ?? 0);
  }

  async getProject(id: string): Promise<LoadTestProject | null> {
    const [rows] = await this.pool.query<ProjectRow[]>("SELECT * FROM lt_projects WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? toProject(rows[0]) : null;
  }

  async createProject(input: CreateProjectInput): Promise<LoadTestProject> {
    const total = await this.countProjects();
    if (total >= MAX_LOADTEST_PROJECTS) {
      throw new Error(`压测项目已达上限（${MAX_LOADTEST_PROJECTS} 个）`);
    }
    const id = newId("ltp_");
    await this.pool.query(
      `INSERT INTO lt_projects
        (id, name, description, target_base_url, script_source, payload_template, env_vars, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), NOW(3), NOW(3))`,
      [
        id,
        input.name,
        input.description ?? "",
        input.targetBaseUrl,
        input.scriptSource,
        input.payloadTemplate ?? null,
        JSON.stringify(input.envVars ?? {}),
      ],
    );
    const created = await this.getProject(id);
    if (!created) throw new Error("压测项目创建后读取失败");
    return created;
  }

  async updateProject(id: string, input: UpdateProjectInput): Promise<LoadTestProject> {
    const existing = await this.getProject(id);
    if (!existing) throw new Error("压测项目不存在");
    const next = {
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      targetBaseUrl: input.targetBaseUrl ?? existing.targetBaseUrl,
      scriptSource: input.scriptSource ?? existing.scriptSource,
      payloadTemplate: input.payloadTemplate === undefined ? existing.payloadTemplate : input.payloadTemplate,
      envVars: input.envVars === undefined ? existing.envVars : input.envVars,
    };
    await this.pool.query(
      `UPDATE lt_projects
       SET name = ?, description = ?, target_base_url = ?, script_source = ?, payload_template = ?,
           env_vars = CAST(? AS JSON), updated_at = NOW(3)
       WHERE id = ?`,
      [
        next.name,
        next.description,
        next.targetBaseUrl,
        next.scriptSource,
        next.payloadTemplate,
        JSON.stringify(next.envVars),
        id,
      ],
    );
    const updated = await this.getProject(id);
    if (!updated) throw new Error("压测项目更新后读取失败");
    return updated;
  }

  async deleteProject(id: string): Promise<void> {
    const [result] = await this.pool.query<ResultSetHeader>("DELETE FROM lt_projects WHERE id = ?", [id]);
    if (result.affectedRows === 0) throw new Error("压测项目不存在");
    await this.pool.query("DELETE FROM lt_runs WHERE project_id = ?", [id]);
  }

  async listRuns(projectId: string, limit = 20, offset = 0): Promise<LoadTestRunSummary[]> {
    const take = Math.max(1, Math.min(limit, 100));
    const skip = Math.max(0, offset);
    const [rows] = await this.pool.query<RunRow[]>(
      "SELECT * FROM lt_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [projectId, take, skip],
    );
    return rows.map(toRunSummary);
  }

  async countRuns(projectId: string): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM lt_runs WHERE project_id = ?",
      [projectId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async getRun(id: string): Promise<LoadTestRun | null> {
    const [rows] = await this.pool.query<RunRow[]>("SELECT * FROM lt_runs WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async createRun(input: CreateRunInput): Promise<LoadTestRun> {
    const total = await this.countRuns(input.projectId);
    if (total >= MAX_LOADTEST_RUNS_PER_PROJECT) {
      // 淘汰最老的已完成记录，运行中的记录永不淘汰
      const [victims] = await this.pool.query<RunRow[]>(
        `SELECT id FROM lt_runs
         WHERE project_id = ? AND status IN ('succeeded','failed','stopped')
         ORDER BY created_at ASC LIMIT 1`,
        [input.projectId],
      );
      const victim = victims[0];
      if (!victim) throw new Error("执行记录已达上限，且全部处于进行中状态");
      await this.pool.query("DELETE FROM lt_runs WHERE id = ?", [victim.id]);
    }
    const id = newId("ltr_");
    await this.pool.query(
      `INSERT INTO lt_runs
        (id, project_id, status, env_snapshot, script_snapshot, log_tail, created_at)
       VALUES (?, ?, 'queued', CAST(? AS JSON), ?, '', NOW(3))`,
      [id, input.projectId, JSON.stringify(input.envSnapshot), input.scriptSnapshot],
    );
    const created = await this.getRun(id);
    if (!created) throw new Error("压测执行创建后读取失败");
    return created;
  }

  async updateRun(id: string, input: UpdateRunInput): Promise<LoadTestRun> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.status !== undefined) {
      sets.push("status = ?");
      params.push(input.status);
    }
    if (input.logTail !== undefined) {
      sets.push("log_tail = ?");
      params.push(input.logTail);
    }
    if (input.summaryText !== undefined) {
      sets.push("summary_text = ?");
      params.push(input.summaryText);
    }
    if (input.exitCode !== undefined) {
      sets.push("exit_code = ?");
      params.push(input.exitCode);
    }
    if (input.error !== undefined) {
      sets.push("error = ?");
      params.push(input.error);
    }
    if (input.startedAt !== undefined) {
      sets.push("started_at = ?");
      params.push(input.startedAt);
    }
    if (input.endedAt !== undefined) {
      sets.push("ended_at = ?");
      params.push(input.endedAt);
    }
    if (sets.length > 0) {
      params.push(id);
      const [result] = await this.pool.query<ResultSetHeader>(
        `UPDATE lt_runs SET ${sets.join(", ")} WHERE id = ?`,
        params,
      );
      if (result.affectedRows === 0) throw new Error("压测执行不存在");
    }
    const updated = await this.getRun(id);
    if (!updated) throw new Error("压测执行不存在");
    return updated;
  }
}
