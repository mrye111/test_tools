import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { GenerateJobRecord, ProjectRecord, TestCaseRecord, TestCaseStoreData, TestSetRecord } from "./types.js";
import { nowIso } from "./utils.js";

type WriteTextFileOptions = {
  attempts?: number;
  retryDelayMs?: number;
  writeFile?: typeof writeFileSync;
  renameFile?: typeof renameSync;
  removeFile?: typeof rmSync;
  wait?: (milliseconds: number) => void;
};

const RETRYABLE_WRITE_ERROR_CODES = new Set(["UNKNOWN", "EBUSY", "EPERM", "EACCES", "EMFILE", "ENFILE"]);

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
  const now = nowIso();
  return {
    projects: [
      {
        id: "default-project",
        name: "默认项目",
        description: "TestCase 兼容接口默认项目",
        createdAt: now,
        ownerId: null,
      },
    ],
    testSets: [],
    testCases: [],
    generationJobs: [],
  };
}

export class TestCaseStore {
  private readonly path: string;
  private data: TestCaseStoreData;

  constructor(path = resolve(process.cwd(), "server", "data", "testcase-store.json")) {
    this.path = path;
    this.data = this.load();
  }

  private load(): TestCaseStoreData {
    if (!existsSync(this.path)) {
      const initial = defaultData();
      this.saveData(initial);
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

  private saveData(data = this.data): void {
    try {
      writeTextFileWithRetry(this.path, JSON.stringify(data, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[testcase-store] 写入本地存储失败，已保留内存状态：${message}`);
    }
  }

  snapshot(): TestCaseStoreData {
    return JSON.parse(JSON.stringify(this.data)) as TestCaseStoreData;
  }

  listProjects(): ProjectRecord[] {
    return this.snapshot().projects;
  }

  upsertProject(project: ProjectRecord): ProjectRecord {
    const index = this.data.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) this.data.projects[index] = { ...this.data.projects[index], ...project };
    else this.data.projects.push(project);
    this.saveData();
    return project;
  }

  deleteProject(projectId: string): void {
    this.data.projects = this.data.projects.filter((item) => item.id !== projectId);
    const removedSetIds = new Set(this.data.testSets.filter((item) => item.projectId === projectId).map((item) => item.id));
    this.data.testSets = this.data.testSets.filter((item) => item.projectId !== projectId);
    this.data.testCases = this.data.testCases.filter((item) => !removedSetIds.has(item.testSetId));
    this.saveData();
  }

  projectExists(projectId: string): boolean {
    return this.data.projects.some((item) => item.id === projectId);
  }

  listTestSets(projectId: string): TestSetRecord[] {
    return this.snapshot().testSets.filter((item) => item.projectId === projectId);
  }

  getTestSet(testSetId: string): TestSetRecord | undefined {
    return this.snapshot().testSets.find((item) => item.id === testSetId);
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
    this.saveData();
    return next;
  }

  deleteTestSet(testSetId: string): void {
    this.data.testSets = this.data.testSets.filter((item) => item.id !== testSetId);
    this.data.testCases = this.data.testCases.filter((item) => item.testSetId !== testSetId);
    this.saveData();
  }

  upsertTestCase(testCase: TestCaseRecord): void {
    const index = this.data.testCases.findIndex((item) => item.id === testCase.id);
    if (index >= 0) this.data.testCases[index] = { ...this.data.testCases[index], ...testCase };
    else this.data.testCases.push(testCase);
    this.saveData();
  }

  replaceTestSetCases(testSetId: string, cases: TestCaseRecord[]): void {
    this.data.testCases = this.data.testCases.filter((item) => item.testSetId !== testSetId);
    this.data.testCases.push(...cases);
    const rows = cases.map((item) => item.row);
    const setIndex = this.data.testSets.findIndex((item) => item.id === testSetId);
    if (setIndex >= 0) {
      this.data.testSets[setIndex].rows = rows;
      this.data.testSets[setIndex].updatedAt = nowIso();
    }
    this.saveData();
  }

  getTestCase(caseId: string): TestCaseRecord | undefined {
    return this.snapshot().testCases.find((item) => item.id === caseId || item.caseId === caseId);
  }

  getTestSetIdForCase(caseId: string): string | undefined {
    return this.getTestCase(caseId)?.testSetId;
  }

  deleteTestCase(caseId: string): void {
    const target = this.data.testCases.find((item) => item.id === caseId || item.caseId === caseId);
    this.data.testCases = this.data.testCases.filter((item) => item.id !== caseId && item.caseId !== caseId);
    if (target) {
      const rows = this.data.testCases.filter((item) => item.testSetId === target.testSetId).map((item) => item.row);
      const setIndex = this.data.testSets.findIndex((item) => item.id === target.testSetId);
      if (setIndex >= 0) this.data.testSets[setIndex].rows = rows;
    }
    this.saveData();
  }

  createJob(job: GenerateJobRecord): void {
    this.data.generationJobs.push(job);
    this.saveData();
  }

  updateJob(jobId: string, patch: Partial<GenerateJobRecord>): GenerateJobRecord | undefined {
    const index = this.data.generationJobs.findIndex((item) => item.id === jobId);
    if (index < 0) return undefined;
    this.data.generationJobs[index] = { ...this.data.generationJobs[index], ...patch, updatedAt: nowIso() };
    this.saveData();
    return this.snapshot().generationJobs.find((item) => item.id === jobId);
  }

  getJob(jobId: string): GenerateJobRecord | undefined {
    return this.snapshot().generationJobs.find((item) => item.id === jobId);
  }

  findActiveJob(testSetId: string): GenerateJobRecord | undefined {
    return this.snapshot().generationJobs.find((item) => item.testSetId === testSetId && ["queued", "running"].includes(item.status));
  }

  listActiveJobs(projectId?: string, testSetId?: string): GenerateJobRecord[] {
    return this.snapshot().generationJobs.filter((item) => {
      if (!["queued", "running"].includes(item.status)) return false;
      if (projectId && item.projectId !== projectId) return false;
      if (testSetId && item.testSetId !== testSetId) return false;
      return true;
    });
  }
}
