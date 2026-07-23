import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { healCsvRow, renumberCaseRows } from "./csv.js";
import type { GenerateJobRecord, ProjectRecord, TestCaseRecord, TestCaseStoreData, TestSetRecord } from "./types.js";
import { nowIso } from "./utils.js";
import { withSpanSync } from "../../middleware/trace.js";
import { logger } from "../../logger.js";
import { storeError } from "../../app-error.js";

type WriteTextFileOptions = {
  attempts?: number;
  retryDelayMs?: number;
  writeFile?: typeof writeFileSync;
  renameFile?: typeof renameSync;
  removeFile?: typeof rmSync;
  wait?: (milliseconds: number) => void;
};

export type TestCaseStoreOptions = WriteTextFileOptions & {
  /** 目录类写入的合并落盘间隔（毫秒）；<= 0 表示每次变更立即同步落盘（测试用）。 */
  persistDebounceMs?: number;
};

const RETRYABLE_WRITE_ERROR_CODES = new Set(["UNKNOWN", "EBUSY", "EPERM", "EACCES", "EMFILE", "ENFILE"]);

const DEFAULT_PERSIST_DEBOUNCE_MS = 250;

function waitSync(milliseconds: number): void {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isRetryableWriteError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return Boolean(code && RETRYABLE_WRITE_ERROR_CODES.has(code));
}

export function writeTextFileWithRetry(path: string, content: string, options: WriteTextFileOptions = {}): void {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 6));
  const retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 25));
  const writeFile = options.writeFile ?? writeFileSync;
  const renameFile = options.renameFile ?? renameSync;
  const removeFile = options.removeFile ?? rmSync;
  const wait = options.wait ?? waitSync;
  let lastError: unknown;

  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const tempPath = `${path}.${process.pid}.${Date.now()}.${attempt}.tmp`;
    try {
      writeFile(tempPath, content, "utf8");
      renameFile(tempPath, path);
      return;
    } catch (error) {
      lastError = error;
      try {
        removeFile(tempPath, { force: true });
      } catch {
        // 清理临时文件失败不应覆盖原始写入错误。
      }
      if (!isRetryableWriteError(error) || attempt === attempts - 1) break;
      wait(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("写入本地存储失败");
}

function defaultData(): TestCaseStoreData {
  return {
    projects: [],
    testSets: [],
    testCases: [],
    generationJobs: [],
  };
}

function cloneEntity<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class TestCaseStore {
  private readonly path: string;
  private readonly writeOptions: WriteTextFileOptions;
  private readonly persistDebounceMs: number;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private data: TestCaseStoreData;

  constructor(
    path = resolve(process.cwd(), "server", "data", "testcase-store.json"),
    options: TestCaseStoreOptions = {},
  ) {
    this.path = path;
    const { persistDebounceMs, ...writeOptions } = options;
    this.persistDebounceMs = Math.max(0, Math.floor(persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS));
    this.writeOptions = writeOptions;
    this.data = this.load();
  }

  private load(): TestCaseStoreData {
    if (!existsSync(this.path)) {
      const initial = defaultData();
      this.persistQuietly(initial);
      return initial;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<TestCaseStoreData>;
      return {
        ...defaultData(),
        ...parsed,
        projects: parsed.projects ?? defaultData().projects,
        testSets: parsed.testSets ?? [],
        testCases: parsed.testCases ?? [],
        generationJobs: parsed.generationJobs ?? [],
      };
    } catch {
      return defaultData();
    }
  }

  /**
   * 立即同步落盘。失败抛出 storeError，不再静默吞掉：
   * 任务终态（completed/failed）走这条路径，确保持久化失败能被任务生命周期感知并标记为失败。
   */
  private persistNow(data = this.data): void {
    withSpanSync({ name: "store.write", type: "store", attributes: { file: this.path } }, () => {
      try {
        writeTextFileWithRetry(this.path, JSON.stringify(data, null, 2), this.writeOptions);
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        throw storeError(`写入本地存储失败：${cause.message}`, cause);
      }
    });
  }

  /** 后台/合并落盘路径的失败无法抛给调用方，记录日志并保留内存状态，等待下一次写入带上全量数据。 */
  private persistQuietly(data = this.data): void {
    try {
      this.persistNow(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ file: this.path, error: message }, "写入本地存储失败，已保留内存状态，将在下次写入时重试");
    }
  }

  /**
   * 目录类变更（项目/用例集/用例 CRUD、任务创建）合并落盘：
   * 同一防抖窗口内的多次变更只写一次磁盘，避免流式生成期间每个 chunk 都全量写文件。
   * 持久化折衷：进程崩溃最多丢失最近 persistDebounceMs 毫秒的目录写入；
   * 任务进度（streamText/resultRows）本就只驻留内存、可由终态重建，不参与落盘。
   */
  private schedulePersist(): void {
    if (this.persistDebounceMs <= 0) {
      this.persistQuietly();
      return;
    }
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistQuietly();
    }, this.persistDebounceMs);
    this.persistTimer.unref?.();
  }

  private caseRow(testCase: TestCaseRecord): string[] {
    const existingRow = healCsvRow(Array.isArray(testCase.row) ? testCase.row.map((cell) => String(cell ?? "")) : []);
    return [
      String(testCase.caseId || existingRow[0] || ""),
      String(testCase.module || existingRow[1] || ""),
      String(testCase.testPoint || existingRow[2] || ""),
      String(testCase.title || existingRow[3] || ""),
      String(testCase.priority || existingRow[4] || "中"),
      String(testCase.precondition || existingRow[5] || ""),
      String(testCase.steps || existingRow[6] || ""),
      String(testCase.expectedResult || existingRow[7] || ""),
    ];
  }

  private syncTestSetCases(testSetId: string): void {
    const setIndex = this.data.testSets.findIndex((item) => item.id === testSetId);
    if (setIndex < 0) return;
    const cases = this.data.testCases.filter((item) => item.testSetId === testSetId);
    const rows = renumberCaseRows(cases.map((item) => this.caseRow(item)), this.data.testSets[setIndex].testType === "api");
    rows.forEach((row, index) => {
      cases[index].caseId = row[0] ?? "";
      cases[index].module = row[1] ?? "";
      cases[index].testPoint = row[2] ?? "";
      cases[index].title = row[3] ?? "";
      cases[index].priority = row[4] ?? "";
      cases[index].precondition = row[5] ?? "";
      cases[index].steps = row[6] ?? "";
      cases[index].expectedResult = row[7] ?? "";
      cases[index].row = row;
    });
    this.data.testSets[setIndex].rows = rows;
    this.data.testSets[setIndex].updatedAt = nowIso();
  }

  snapshot(): TestCaseStoreData {
    return cloneEntity(this.data);
  }

  listProjects(): ProjectRecord[] {
    return cloneEntity(this.data.projects);
  }

  upsertProject(project: ProjectRecord): ProjectRecord {
    const index = this.data.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) this.data.projects[index] = { ...this.data.projects[index], ...project };
    else this.data.projects.push(project);
    this.schedulePersist();
    return project;
  }

  deleteProject(projectId: string): void {
    this.data.projects = this.data.projects.filter((item) => item.id !== projectId);
    const removedSetIds = new Set(this.data.testSets.filter((item) => item.projectId === projectId).map((item) => item.id));
    this.data.testSets = this.data.testSets.filter((item) => item.projectId !== projectId);
    this.data.testCases = this.data.testCases.filter((item) => !removedSetIds.has(item.testSetId));
    this.data.generationJobs = this.data.generationJobs.filter((item) => item.projectId !== projectId);
    this.schedulePersist();
  }

  projectExists(projectId: string): boolean {
    return this.data.projects.some((item) => item.id === projectId);
  }

  listTestSets(projectId: string): TestSetRecord[] {
    return cloneEntity(this.data.testSets.filter((item) => item.projectId === projectId));
  }

  getTestSet(testSetId: string): TestSetRecord | undefined {
    const found = this.data.testSets.find((item) => item.id === testSetId);
    return found ? cloneEntity(found) : undefined;
  }

  upsertTestSet(testSet: TestSetRecord): TestSetRecord {
    const index = this.data.testSets.findIndex((item) => item.id === testSet.id);
    const next = { ...testSet, updatedAt: nowIso() };
    if (index >= 0) this.data.testSets[index] = { ...this.data.testSets[index], ...next };
    else this.data.testSets.push(next);
    if (!this.projectExists(testSet.projectId)) {
      this.data.projects.push({
        id: testSet.projectId,
        name: testSet.projectId,
        createdAt: nowIso(),
        ownerId: null,
      });
    }
    this.schedulePersist();
    return next;
  }

  deleteTestSet(testSetId: string): void {
    this.data.testSets = this.data.testSets.filter((item) => item.id !== testSetId);
    this.data.testCases = this.data.testCases.filter((item) => item.testSetId !== testSetId);
    this.data.generationJobs = this.data.generationJobs.filter((item) => item.testSetId !== testSetId);
    this.schedulePersist();
  }

  upsertTestCase(testCase: TestCaseRecord): void {
    const index = this.data.testCases.findIndex((item) => item.id === testCase.id);
    const next = { ...testCase, row: this.caseRow(testCase) };
    if (index >= 0) this.data.testCases[index] = { ...this.data.testCases[index], ...next };
    else this.data.testCases.push(next);
    this.syncTestSetCases(testCase.testSetId);
    this.schedulePersist();
  }

  replaceTestSetCases(testSetId: string, cases: TestCaseRecord[]): void {
    this.data.testCases = this.data.testCases.filter((item) => item.testSetId !== testSetId);
    this.data.testCases.push(...cases);
    this.syncTestSetCases(testSetId);
    this.schedulePersist();
  }

  getTestCase(caseId: string, testSetId?: string): TestCaseRecord | undefined {
    const found = this.data.testCases.find((item) => {
      if (testSetId && item.testSetId !== testSetId) return false;
      return item.id === caseId || item.caseId === caseId;
    });
    return found ? cloneEntity(found) : undefined;
  }

  getTestSetIdForCase(caseId: string, testSetId?: string): string | undefined {
    return this.getTestCase(caseId, testSetId)?.testSetId;
  }

  deleteTestCase(caseId: string, testSetId?: string): void {
    const target = this.data.testCases.find((item) => {
      if (testSetId && item.testSetId !== testSetId) return false;
      return item.id === caseId || item.caseId === caseId;
    });
    this.data.testCases = this.data.testCases.filter((item) => {
      if (testSetId && item.testSetId !== testSetId) return true;
      return item.id !== caseId && item.caseId !== caseId;
    });
    if (target) this.syncTestSetCases(target.testSetId);
    this.schedulePersist();
  }

  createJob(job: GenerateJobRecord): void {
    this.data.generationJobs.push(job);
    this.schedulePersist();
  }

  updateJob(jobId: string, patch: Partial<GenerateJobRecord>): GenerateJobRecord | undefined {
    const index = this.data.generationJobs.findIndex((item) => item.id === jobId);
    if (index < 0) return undefined;
    this.data.generationJobs[index] = { ...this.data.generationJobs[index], ...patch, updatedAt: nowIso() };
    const job = this.data.generationJobs[index];
    // 运行中进度（streamText/部分 resultRows）只驻留内存，不入盘；
    // 终态立即同步落盘，持久化失败会抛 storeError，由任务生命周期兜底标记为失败。
    if (job.status === "completed" || job.status === "failed") {
      this.persistNow();
    }
    return cloneEntity(job);
  }

  getJob(jobId: string): GenerateJobRecord | undefined {
    // 轮询热路径：只克隆目标任务，避免每次 getJob 都深拷贝整个 Store。
    const found = this.data.generationJobs.find((item) => item.id === jobId);
    return found ? cloneEntity(found) : undefined;
  }

  findActiveJob(testSetId: string): GenerateJobRecord | undefined {
    const found = this.data.generationJobs.find((item) => item.testSetId === testSetId && ["queued", "running"].includes(item.status));
    return found ? cloneEntity(found) : undefined;
  }

  listActiveJobs(projectId?: string, testSetId?: string): GenerateJobRecord[] {
    return cloneEntity(this.data.generationJobs.filter((item) => {
      if (!["queued", "running"].includes(item.status)) return false;
      if (projectId && item.projectId !== projectId) return false;
      if (testSetId && item.testSetId !== testSetId) return false;
      return true;
    }));
  }
}
