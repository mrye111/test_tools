import { randomUUID } from "crypto";
import {
  type CreateProjectInput,
  type CreateRunInput,
  type LoadTestProject,
  type LoadTestProjectSummary,
  type LoadTestRepository,
  type LoadTestRun,
  type LoadTestRunSummary,
  type UpdateProjectInput,
  type UpdateRunInput,
  MAX_LOADTEST_PROJECTS,
  MAX_LOADTEST_RUNS_PER_PROJECT,
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

function newId(prefix: string): string {
  return `${prefix}${randomUUID()}`;
}

function toProjectSummary(project: LoadTestProject): LoadTestProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    targetBaseUrl: project.targetBaseUrl,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function toRunSummary(run: LoadTestRun): LoadTestRunSummary {
  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    exitCode: run.exitCode,
    error: run.error,
    summaryText: run.summaryText,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
  };
}

/** 内存版 LoadTestRepository：MySQL 不可用时的降级实现。 */
export class MemoryLoadTestRepository implements LoadTestRepository {
  private projects = new Map<string, LoadTestProject>();
  private runs = new Map<string, LoadTestRun>();

  async listProjects(limit = 20, offset = 0): Promise<LoadTestProjectSummary[]> {
    return Array.from(this.projects.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(offset, offset + limit)
      .map(toProjectSummary);
  }

  async countProjects(): Promise<number> {
    return this.projects.size;
  }

  async getProject(id: string): Promise<LoadTestProject | null> {
    const found = this.projects.get(id);
    return found ? deepClone(found) : null;
  }

  async createProject(input: CreateProjectInput): Promise<LoadTestProject> {
    if (this.projects.size >= MAX_LOADTEST_PROJECTS) {
      throw new Error(`压测项目已达上限（${MAX_LOADTEST_PROJECTS} 个）`);
    }
    const now = new Date();
    const project: LoadTestProject = {
      id: newId("ltp_"),
      name: input.name,
      description: input.description ?? "",
      targetBaseUrl: input.targetBaseUrl,
      scriptSource: input.scriptSource,
      payloadTemplate: input.payloadTemplate ?? null,
      envVars: deepClone(input.envVars ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    return deepClone(project);
  }

  async updateProject(id: string, input: UpdateProjectInput): Promise<LoadTestProject> {
    const found = this.projects.get(id);
    if (!found) throw new Error("压测项目不存在");
    const next: LoadTestProject = {
      ...found,
      name: input.name ?? found.name,
      description: input.description ?? found.description,
      targetBaseUrl: input.targetBaseUrl ?? found.targetBaseUrl,
      scriptSource: input.scriptSource ?? found.scriptSource,
      payloadTemplate: input.payloadTemplate === undefined ? found.payloadTemplate : input.payloadTemplate,
      envVars: input.envVars === undefined ? found.envVars : deepClone(input.envVars),
      updatedAt: new Date(),
    };
    this.projects.set(id, next);
    return deepClone(next);
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.projects.delete(id)) throw new Error("压测项目不存在");
    for (const [runId, run] of this.runs) {
      if (run.projectId === id) this.runs.delete(runId);
    }
  }

  async listRuns(projectId: string, limit = 20, offset = 0): Promise<LoadTestRunSummary[]> {
    // createdAt 同毫秒并列时按插入顺序反转（数组稳定排序 + reverse ⇒ 后创建者在前）
    return Array.from(this.runs.values())
      .filter((run) => run.projectId === projectId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .reverse()
      .slice(offset, offset + limit)
      .map(toRunSummary);
  }

  async countRuns(projectId: string): Promise<number> {
    return Array.from(this.runs.values()).filter((run) => run.projectId === projectId).length;
  }

  async getRun(id: string): Promise<LoadTestRun | null> {
    const found = this.runs.get(id);
    return found ? deepClone(found) : null;
  }

  async createRun(input: CreateRunInput): Promise<LoadTestRun> {
    const projectRuns = Array.from(this.runs.values()).filter((run) => run.projectId === input.projectId);
    if (projectRuns.length >= MAX_LOADTEST_RUNS_PER_PROJECT) {
      // 淘汰最老的已完成记录，运行中的记录永不淘汰
      const finished = projectRuns
        .filter((run) => run.status === "succeeded" || run.status === "failed" || run.status === "stopped")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const victim = finished[0];
      if (!victim) throw new Error("执行记录已达上限，且全部处于进行中状态");
      this.runs.delete(victim.id);
    }
    const run: LoadTestRun = {
      id: newId("ltr_"),
      projectId: input.projectId,
      status: "queued",
      envSnapshot: deepClone(input.envSnapshot),
      scriptSnapshot: input.scriptSnapshot,
      logTail: "",
      summaryText: null,
      exitCode: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      endedAt: null,
    };
    this.runs.set(run.id, run);
    return deepClone(run);
  }

  async updateRun(id: string, input: UpdateRunInput): Promise<LoadTestRun> {
    const found = this.runs.get(id);
    if (!found) throw new Error("压测执行不存在");
    const next: LoadTestRun = { ...found };
    if (input.status !== undefined) next.status = input.status;
    if (input.logTail !== undefined) next.logTail = input.logTail;
    if (input.summaryText !== undefined) next.summaryText = input.summaryText;
    if (input.exitCode !== undefined) next.exitCode = input.exitCode;
    if (input.error !== undefined) next.error = input.error;
    if (input.startedAt !== undefined) next.startedAt = input.startedAt;
    if (input.endedAt !== undefined) next.endedAt = input.endedAt;
    this.runs.set(id, next);
    return deepClone(next);
  }
}
