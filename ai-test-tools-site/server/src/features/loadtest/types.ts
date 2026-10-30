/**
 * 在线压测域数据类型。
 * 压测项目是可保存复用的资产容器；压测执行是串行生命周期记录（排队→运行→完成/失败/已停止）。
 * 术语唯一正本：仓库根 CONTEXT.md「在线压测」词条。
 */

/** 压测项目数硬上限 */
export const MAX_LOADTEST_PROJECTS = 100;
/** 单项目执行记录数硬上限（超出时最老记录被淘汰） */
export const MAX_LOADTEST_RUNS_PER_PROJECT = 100;
/** 脚本源码大小上限 */
export const MAX_SCRIPT_SOURCE_LENGTH = 512 * 1024;
/** 请求体模板大小上限 */
export const MAX_PAYLOAD_LENGTH = 2 * 1024 * 1024;
/** 环境变量条目数上限 */
export const MAX_ENV_VARS = 64;
/** 日志尾部落库上限（完整日志在 server/generated/loadtest/<runId>/ 下） */
export const MAX_LOG_TAIL_LENGTH = 64 * 1024;

export type LoadTestRunStatus = "queued" | "running" | "succeeded" | "failed" | "stopped";

/** 压测项目（完整，含脚本与请求体大字段） */
export interface LoadTestProject {
  id: string;
  name: string;
  description: string;
  /** 被测目标基础地址，运行前确认弹窗展示 */
  targetBaseUrl: string;
  /** k6 脚本源码 */
  scriptSource: string;
  /** 请求体模板（JSON 文本），无则 null */
  payloadTemplate: string | null;
  /** 环境变量（API_BASE / STAGES / 阈值等 k6 运行参数） */
  envVars: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

/** 项目摘要（列表层，不含脚本等大字段） */
export interface LoadTestProjectSummary {
  id: string;
  name: string;
  description: string;
  targetBaseUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  targetBaseUrl: string;
  scriptSource: string;
  payloadTemplate?: string | null;
  envVars?: Record<string, string>;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  targetBaseUrl?: string;
  scriptSource?: string;
  /** 显式 null 表示清除请求体模板 */
  payloadTemplate?: string | null;
  envVars?: Record<string, string>;
}

/** 压测执行（完整，含脚本快照与日志尾部） */
export interface LoadTestRun {
  id: string;
  projectId: string;
  status: LoadTestRunStatus;
  /** 运行时环境快照：项目 envVars + 运行覆盖 + TEST_ID，历史执行可还原 */
  envSnapshot: Record<string, string>;
  /** 本次执行使用的脚本快照（项目后续改动不影响历史还原） */
  scriptSnapshot: string;
  /** 日志尾部（截断存储，上限 MAX_LOG_TAIL_LENGTH） */
  logTail: string;
  /** k6 结束摘要文本（关键指标行），未完成时 null */
  summaryText: string | null;
  exitCode: number | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}

/** 执行摘要（列表层，不含脚本快照与日志） */
export interface LoadTestRunSummary {
  id: string;
  projectId: string;
  status: LoadTestRunStatus;
  exitCode: number | null;
  error: string | null;
  summaryText: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface CreateRunInput {
  projectId: string;
  envSnapshot: Record<string, string>;
  scriptSnapshot: string;
}

export interface UpdateRunInput {
  status?: LoadTestRunStatus;
  logTail?: string;
  summaryText?: string | null;
  exitCode?: number | null;
  error?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
}

/** LoadTest Repository 接口：内存与 MySQL 双实现共用同一契约 */
export interface LoadTestRepository {
  /** 按 updatedAt 倒序分页；摘要不含脚本等大字段 */
  listProjects(limit?: number, offset?: number): Promise<LoadTestProjectSummary[]>;
  countProjects(): Promise<number>;
  getProject(id: string): Promise<LoadTestProject | null>;
  createProject(input: CreateProjectInput): Promise<LoadTestProject>;
  updateProject(id: string, input: UpdateProjectInput): Promise<LoadTestProject>;
  /** 级联删除项目下全部执行记录 */
  deleteProject(id: string): Promise<void>;

  /** 按 createdAt 倒序分页（最新执行在前） */
  listRuns(projectId: string, limit?: number, offset?: number): Promise<LoadTestRunSummary[]>;
  countRuns(projectId: string): Promise<number>;
  getRun(id: string): Promise<LoadTestRun | null>;
  createRun(input: CreateRunInput): Promise<LoadTestRun>;
  updateRun(id: string, input: UpdateRunInput): Promise<LoadTestRun>;
}
