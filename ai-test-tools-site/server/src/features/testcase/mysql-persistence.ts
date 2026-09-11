/** 测试用例域 MySQL 持久化适配器：schema 初始化、快照水合与按表写穿透。 */

import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  GenerateJobRecord,
  ProjectRecord,
  TestCaseRecord,
  TestCaseStoreData,
  TestSetRecord,
} from "./types.js";

export type PersistTable = "projects" | "testSets" | "testCases" | "generationJobs";

export interface TestCasePersistenceAdapter {
  /** 读取全量快照；全部为空时返回 null（用于区分“空库”与“有数据”）。 */
  load(): Promise<TestCaseStoreData | null>;
  /** 仅写指定表：单事务内 DELETE + 批量 INSERT（镜像内存快照）。 */
  save(tables: PersistTable[], data: TestCaseStoreData): Promise<void>;
}

/** tc_* 四表：JSON 列承载数组/字典载荷；streamText 与运行中进度不入库（与文件存储语义一致）。 */
export const TESTCASE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tc_projects (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_at DATETIME(3) NOT NULL,
    owner_id BIGINT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tc_test_sets (
    id VARCHAR(96) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    feature_name VARCHAR(200) NOT NULL,
    test_type VARCHAR(20) NOT NULL,
    language VARCHAR(8) NOT NULL,
    prompt_preset VARCHAR(32),
    context MEDIUMTEXT,
    status VARCHAR(20) NOT NULL,
    generation_job_id VARCHAR(96),
    error TEXT,
    requirement MEDIUMTEXT,
    header JSON,
    case_rows JSON,
    execution_status JSON,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NULL,
    owner_id BIGINT NULL,
    INDEX idx_tc_sets_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tc_test_cases (
    id VARCHAR(128) PRIMARY KEY,
    test_set_id VARCHAR(96) NOT NULL,
    case_id VARCHAR(64),
    module VARCHAR(200),
    test_point VARCHAR(200),
    title VARCHAR(400),
    priority VARCHAR(16),
    precondition MEDIUMTEXT,
    steps MEDIUMTEXT,
    expected_result MEDIUMTEXT,
    case_row JSON,
    INDEX idx_tc_cases_set (test_set_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tc_generation_jobs (
    id VARCHAR(96) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    test_set_id VARCHAR(96) NOT NULL,
    mode VARCHAR(32) NOT NULL,
    status VARCHAR(20) NOT NULL,
    request JSON,
    generated_count INT NOT NULL DEFAULT 0,
    generated_count_raw INT NULL,
    added_count INT NULL,
    duplicates_filtered INT NULL,
    error TEXT,
    result_header JSON,
    result_rows JSON,
    selected_indices JSON,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    started_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    INDEX idx_tc_jobs_set (test_set_id),
    INDEX idx_tc_jobs_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function initTestcaseSchema(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    for (const statement of TESTCASE_SCHEMA_STATEMENTS) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

function toDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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

interface ProjectRow extends RowDataPacket {
  id: string;
  name: string;
  description: string | null;
  created_at: Date | string;
  owner_id: number | null;
}

interface TestSetRow extends RowDataPacket {
  id: string;
  project_id: string;
  name: string;
  feature_name: string;
  test_type: string;
  language: string;
  prompt_preset: string | null;
  context: string | null;
  status: string;
  generation_job_id: string | null;
  error: string | null;
  requirement: string | null;
  header: unknown;
  case_rows: unknown;
  execution_status: unknown;
  created_at: Date | string;
  updated_at: Date | string | null;
  owner_id: number | null;
}

interface TestCaseRow extends RowDataPacket {
  id: string;
  test_set_id: string;
  case_id: string | null;
  module: string | null;
  test_point: string | null;
  title: string | null;
  priority: string | null;
  precondition: string | null;
  steps: string | null;
  expected_result: string | null;
  case_row: unknown;
}

interface JobRow extends RowDataPacket {
  id: string;
  project_id: string;
  test_set_id: string;
  mode: string;
  status: string;
  request: unknown;
  generated_count: number;
  generated_count_raw: number | null;
  added_count: number | null;
  duplicates_filtered: number | null;
  error: string | null;
  result_header: unknown;
  result_rows: unknown;
  selected_indices: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    ownerId: row.owner_id,
  };
}

function toTestSet(row: TestSetRow): TestSetRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    featureName: row.feature_name,
    testType: row.test_type,
    language: row.language,
    promptPreset: row.prompt_preset ?? undefined,
    context: row.context ?? "",
    status: row.status,
    generationJobId: row.generation_job_id ?? undefined,
    error: row.error ?? undefined,
    requirement: row.requirement ?? undefined,
    header: toJsonValue<string[]>(row.header, []),
    rows: toJsonValue<string[][]>(row.case_rows, []),
    executionStatus: toJsonValue<TestSetRecord["executionStatus"]>(row.execution_status, undefined),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at),
    ownerId: row.owner_id,
  };
}

function toTestCase(row: TestCaseRow): TestCaseRecord {
  return {
    id: row.id,
    testSetId: row.test_set_id,
    caseId: row.case_id ?? "",
    module: row.module ?? "",
    testPoint: row.test_point ?? "",
    title: row.title ?? "",
    priority: row.priority ?? "中",
    precondition: row.precondition ?? "",
    steps: row.steps ?? "",
    expectedResult: row.expected_result ?? "",
    row: toJsonValue<string[]>(row.case_row, []),
  };
}

function toJob(row: JobRow): GenerateJobRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    testSetId: row.test_set_id,
    mode: row.mode as GenerateJobRecord["mode"],
    status: row.status as GenerateJobRecord["status"],
    request: toJsonValue<GenerateJobRecord["request"]>(row.request, {}),
    generatedCount: row.generated_count,
    generatedCountRaw: row.generated_count_raw ?? undefined,
    addedCount: row.added_count ?? undefined,
    duplicatesFiltered: row.duplicates_filtered ?? undefined,
    error: row.error ?? "",
    resultHeader: toJsonValue<string[]>(row.result_header, []),
    resultRows: toJsonValue<string[][]>(row.result_rows, []),
    selectedIndices: toJsonValue<number[]>(row.selected_indices, []),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  };
}

async function loadSnapshot(pool: Pool): Promise<TestCaseStoreData | null> {
  const [projects] = await pool.query<ProjectRow[]>("SELECT * FROM tc_projects");
  const [testSets] = await pool.query<TestSetRow[]>("SELECT * FROM tc_test_sets");
  const [testCases] = await pool.query<TestCaseRow[]>("SELECT * FROM tc_test_cases");
  const [jobs] = await pool.query<JobRow[]>("SELECT * FROM tc_generation_jobs");
  if (projects.length === 0 && testSets.length === 0 && testCases.length === 0 && jobs.length === 0) {
    return null;
  }
  return {
    projects: projects.map(toProject),
    testSets: testSets.map(toTestSet),
    testCases: testCases.map(toTestCase),
    generationJobs: jobs.map(toJob),
  };
}

const TABLE_SQL: Record<PersistTable, { deleteSql: string; insertSql: string; toParams: (data: TestCaseStoreData) => unknown[][] }> = {
  projects: {
    deleteSql: "DELETE FROM tc_projects",
    insertSql: "INSERT INTO tc_projects (id, name, description, created_at, owner_id) VALUES ?",
    toParams: (data) =>
      data.projects.map((item) => [
        item.id,
        item.name,
        item.description ?? null,
        toDate(item.createdAt) ?? new Date(),
        item.ownerId ?? null,
      ]),
  },
  testSets: {
    deleteSql: "DELETE FROM tc_test_sets",
    insertSql:
      "INSERT INTO tc_test_sets (id, project_id, name, feature_name, test_type, language, prompt_preset, context, status, generation_job_id, error, requirement, header, case_rows, execution_status, created_at, updated_at, owner_id) VALUES ?",
    toParams: (data) =>
      data.testSets.map((item) => [
        item.id,
        item.projectId,
        item.name,
        item.featureName,
        item.testType,
        item.language,
        item.promptPreset ?? null,
        item.context,
        item.status,
        item.generationJobId ?? null,
        item.error ?? null,
        item.requirement ?? null,
        JSON.stringify(item.header ?? []),
        JSON.stringify(item.rows ?? []),
        item.executionStatus ? JSON.stringify(item.executionStatus) : null,
        toDate(item.createdAt) ?? new Date(),
        toDate(item.updatedAt),
        item.ownerId ?? null,
      ]),
  },
  testCases: {
    deleteSql: "DELETE FROM tc_test_cases",
    insertSql:
      "INSERT INTO tc_test_cases (id, test_set_id, case_id, module, test_point, title, priority, precondition, steps, expected_result, case_row) VALUES ?",
    toParams: (data) =>
      data.testCases.map((item) => [
        item.id,
        item.testSetId,
        item.caseId,
        item.module,
        item.testPoint,
        item.title,
        item.priority,
        item.precondition,
        item.steps,
        item.expectedResult,
        JSON.stringify(item.row ?? []),
      ]),
  },
  generationJobs: {
    deleteSql: "DELETE FROM tc_generation_jobs",
    insertSql:
      "INSERT INTO tc_generation_jobs (id, project_id, test_set_id, mode, status, request, generated_count, generated_count_raw, added_count, duplicates_filtered, error, result_header, result_rows, selected_indices, created_at, updated_at, started_at, finished_at) VALUES ?",
    toParams: (data) =>
      data.generationJobs.map((item) => [
        item.id,
        item.projectId,
        item.testSetId,
        item.mode,
        item.status,
        JSON.stringify(item.request ?? {}),
        item.generatedCount,
        item.generatedCountRaw ?? null,
        item.addedCount ?? null,
        item.duplicatesFiltered ?? null,
        item.error,
        JSON.stringify(item.resultHeader ?? []),
        JSON.stringify(item.resultRows ?? []),
        JSON.stringify(item.selectedIndices ?? []),
        toDate(item.createdAt) ?? new Date(),
        toDate(item.updatedAt) ?? new Date(),
        toDate(item.startedAt),
        toDate(item.finishedAt),
      ]),
  },
};

async function saveTables(pool: Pool, tables: PersistTable[], data: TestCaseStoreData): Promise<void> {
  if (tables.length === 0) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const table of tables) {
      const spec = TABLE_SQL[table];
      await connection.query(spec.deleteSql);
      const params = spec.toParams(data);
      if (params.length > 0) {
        await connection.query<ResultSetHeader>(spec.insertSql, [params]);
      }
    }
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // 回滚失败不掩盖原始错误
    }
    throw error;
  } finally {
    connection.release();
  }
}

/** 基于共享连接池构造 testcase 域 MySQL 适配器。 */
export function createMysqlTestcaseAdapter(pool: Pool): TestCasePersistenceAdapter {
  return {
    load: () => loadSnapshot(pool),
    save: (tables, data) => saveTables(pool, tables, data),
  };
}
