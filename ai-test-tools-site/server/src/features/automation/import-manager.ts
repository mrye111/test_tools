/**
 * 需求导入编排（票据 16）：测试条件 → 生成功能用例集 → 回写 RTM → 批量编译落库为自动化用例。
 * 只做编排与追溯，不新建生成能力；三段各自复用既有实现。
 * 失败继续（票据 11）：单条编译/落库失败进汇总，不中断整批。
 */

import { randomUUID } from "node:crypto";
import { logger } from "../../logger.js";
import { buildConditionsHandoffText } from "../requirement-v2/handoff-text.js";
import type { AnalysisRepository, TestCondition } from "../requirement-v2/types.js";
import { parseSetCases, type FunctionalCaseRow } from "../testcase/functional-case-rows.js";
import type { TestCaseStore } from "../testcase/store.js";
import type { AiRequestConfig, GenerateJobRecord, TestSetRecord } from "../testcase/types.js";
import { makeId, nowIso } from "../testcase/utils.js";
import { compileFunctionalCase, type ChatCaller } from "./compiler.js";
import type { AutomationRepository, ExecutableLevel } from "./types.js";

export type ImportStage = "generate" | "link" | "compile" | "done";

export type ImportSummary = {
  /** 生成的功能用例行数（可编译的）。 */
  generatedCases: number;
  /** 落库的自动化用例数。 */
  created: number;
  byExecutable: { full: number; partial: number; manual: number };
  /** 两次校验未过、降级直映的条数。 */
  fallback: number;
  cacheHit: number;
  failed: Array<{ caseId: string; title: string; error: string }>;
};

export type ImportJob = {
  id: string;
  stage: ImportStage;
  recordId: string;
  testSetId?: string;
  progress: { done: number; total: number };
  summary?: ImportSummary;
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

export type ImportEvent =
  | { kind: "stage"; stage: ImportStage; at: string }
  | { kind: "progress"; done: number; total: number; at: string }
  | { kind: "item"; caseId: string; title: string; executable: ExecutableLevel; at: string }
  | { kind: "item-failed"; caseId: string; title: string; error: string; at: string }
  | { kind: "done"; at: string }
  | { kind: "error"; message: string; at: string };

export type StartImportInput = {
  recordId: string;
  conditionIds: string[];
  projectId: string;
  setId?: string;
  entryUrl: string;
  testType?: string;
  language?: string;
  promptPreset?: string;
  aiConfig: AiRequestConfig;
  /** 云端引用：生成任务 request 只留 cloudConfigId（密钥不落库，运行起点按引用重取）；编译走内存态 aiConfig。 */
  aiConfigRef?: { cloudConfigId: string; userId: string };
};

export type ImportManagerDeps = {
  analysisRepo: Pick<AnalysisRepository, "getRecord" | "markConditionsGenerated">;
  automationRepo: Pick<AutomationRepository, "createCase" | "getCompiledCache" | "putCompiledCache">;
  testcaseStore: TestCaseStore;
  /** 进程内跑生成 job（生产接 generation.ts 的 runGenerationJob；测试接替身）。 */
  runGeneration: (jobId: string, store: TestCaseStore) => Promise<void>;
  /** 构造 LLM 调用器（生产接 callChatCompletion；测试接替身）。 */
  createChatCaller: (aiConfig: AiRequestConfig) => ChatCaller;
  /** 编译并发闸（票据 03 节流参数）。 */
  compileConcurrency?: number;
  /** 完成后的回放保留窗口。 */
  jobTtlMs?: number;
};

const MAX_BUFFERED_EVENTS = 500;
const DEFAULT_COMPILE_CONCURRENCY = 3;
const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000;

/** 全局并发闸：多任务叠加时也不让 LLM 调用超过配额。 */
function createGate(limit: number): { acquire: () => Promise<void>; release: () => void } {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    acquire: () =>
      new Promise<void>((resolve) => {
        const enter = (): void => {
          if (active < limit) {
            active += 1;
            resolve();
          } else {
            waiters.push(enter);
          }
        };
        enter();
      }),
    release: () => {
      active -= 1;
      waiters.shift()?.();
    },
  };
}

export class ImportManager {
  private jobs = new Map<string, ImportJob>();
  private events = new Map<string, ImportEvent[]>();
  private listeners = new Map<string, Set<(event: ImportEvent) => void>>();
  private gate: ReturnType<typeof createGate>;

  constructor(private deps: ImportManagerDeps) {
    this.gate = createGate(deps.compileConcurrency ?? DEFAULT_COMPILE_CONCURRENCY);
  }

  getJob(id: string): ImportJob | null {
    return this.jobs.get(id) ?? null;
  }

  /** 订阅进度：先回放缓冲事件，再挂直播。返回退订函数。 */
  subscribe(id: string, listener: (event: ImportEvent) => void): () => void {
    for (const event of this.events.get(id) ?? []) {
      try {
        listener(event);
      } catch {
        return () => undefined; // 回放段抛错（如连接已断）直接放弃订阅
      }
    }
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  /** 启动导入任务（立即返回 importId，编排在后台跑）。 */
  startImport(input: StartImportInput): ImportJob {
    const id = randomUUID();
    const job: ImportJob = {
      id,
      stage: "generate",
      recordId: input.recordId,
      progress: { done: 0, total: 0 },
      createdAt: nowIso(),
    };
    this.jobs.set(id, job);
    this.events.set(id, []);
    void this.run(job, input)
      .catch((error) => this.fail(job, error))
      .finally(() => {
        const timer = setTimeout(() => this.evict(id), this.deps.jobTtlMs ?? DEFAULT_JOB_TTL_MS);
        timer.unref?.();
      });
    return job;
  }

  private async run(job: ImportJob, input: StartImportInput): Promise<void> {
    // 1/4 生成：测试条件 → 功能用例集
    this.setStage(job, "generate");
    const record = await this.deps.analysisRepo.getRecord(input.recordId);
    if (!record) throw new Error(`需求分析记录不存在: ${input.recordId}`);
    const selected = new Set(input.conditionIds);
    const conditions: TestCondition[] = record.conditions.filter((c) => selected.has(c.id));
    if (conditions.length === 0) throw new Error("没有可用的测试条件（可能已被接力或生成）");

    const testSetId = makeId("ts");
    const testSetName = record.title.trim() || "未命名用例集";
    const promptPreset = input.promptPreset?.trim() || "standard";
    const context = buildConditionsHandoffText(record, conditions);
    const now = nowIso();

    this.deps.testcaseStore.upsertTestSet({
      id: testSetId,
      projectId: input.projectId,
      name: testSetName,
      featureName: testSetName,
      testType: input.testType?.trim() || "functional",
      language: input.language?.trim() || "zh",
      promptPreset,
      context,
      status: "queued",
      generationJobId: job.id,
      error: "",
      header: [],
      rows: [],
      createdAt: now,
      updatedAt: now,
      ownerId: null,
    } satisfies TestSetRecord);

    // request 形状与 POST /api/generate-jobs 的 create 模式一致（streamGenerateCsvText 按这些键取值）
    const request = {
      mode: "create",
      projectId: input.projectId,
      testSetId,
      testSetName,
      featureName: testSetName,
      context,
      testType: input.testType?.trim() || "functional",
      language: input.language?.trim() || "zh",
      promptPreset,
      aiConfig: input.aiConfigRef ? { cloudConfigId: input.aiConfigRef.cloudConfigId } : input.aiConfig,
      ...(input.aiConfigRef ? { cloudConfigUserId: input.aiConfigRef.userId } : {}),
    };
    const generateJob: GenerateJobRecord = {
      id: job.id,
      projectId: input.projectId,
      testSetId,
      mode: "create",
      status: "queued",
      request,
      generatedCount: 0,
      error: "",
      streamText: "",
      resultHeader: [],
      resultRows: [],
      selectedIndices: [],
      createdAt: now,
      updatedAt: now,
    };
    this.deps.testcaseStore.createJob(generateJob);
    job.testSetId = testSetId;

    await this.deps.runGeneration(generateJob.id, this.deps.testcaseStore);
    const finished = this.deps.testcaseStore.getJob(generateJob.id);
    if (!finished || finished.status !== "completed") {
      throw new Error(`功能用例生成失败：${finished?.error || "生成任务未完成"}`);
    }

    // 2/4 回写 RTM：生成功能用例集即算覆盖（与既有 onCompleted 语义一致）
    this.setStage(job, "link");
    const linked = await this.deps.analysisRepo.markConditionsGenerated(
      conditions.map((c) => c.id),
      testSetId,
    );
    logger.info({ importId: job.id, testSetId, linked }, "[automation] 需求导入：条件回写完成");

    // 3/4 批量编译落库
    const rows = parseSetCases({ header: finished.resultHeader, rows: finished.resultRows });
    const summary: ImportSummary = {
      generatedCases: rows.length,
      created: 0,
      byExecutable: { full: 0, partial: 0, manual: 0 },
      fallback: 0,
      cacheHit: 0,
      failed: [],
    };
    job.summary = summary;
    job.progress = { done: 0, total: rows.length };
    this.setStage(job, "compile");
    this.emit(job.id, { kind: "progress", ...job.progress, at: nowIso() });

    const callChat = this.deps.createChatCaller(input.aiConfig);
    let done = 0;
    const compileOne = async (row: FunctionalCaseRow): Promise<void> => {
      await this.gate.acquire();
      try {
        const compiled = await compileFunctionalCase(
          {
            caseRef: row.caseId,
            title: row.title,
            precondition: row.precondition,
            steps: row.steps,
            expectedResult: row.expectedResult,
            env: { entryUrl: input.entryUrl },
          },
          { callChat, cache: this.deps.automationRepo },
        );
        await this.deps.automationRepo.createCase({
          projectId: input.projectId,
          setId: input.setId,
          title: row.title,
          source: "functional-import",
          entryUrl: input.entryUrl,
          preconditionText: row.precondition,
          steps: compiled.plan.instructions,
          manualItems: compiled.plan.manualItems,
          sourceFunctionalCaseId: row.caseId,
          compileHash: compiled.plan.compileHash,
        });
        summary.created += 1;
        summary.byExecutable[compiled.plan.executable] += 1;
        if (compiled.plan.compileFailed) summary.fallback += 1;
        if (compiled.cacheHit) summary.cacheHit += 1;
        this.emit(job.id, {
          kind: "item",
          caseId: row.caseId,
          title: row.title,
          executable: compiled.plan.executable,
          at: nowIso(),
        });
      } catch (error) {
        summary.failed.push({
          caseId: row.caseId,
          title: row.title,
          error: error instanceof Error ? error.message : String(error),
        });
        this.emit(job.id, {
          kind: "item-failed",
          caseId: row.caseId,
          title: row.title,
          error: error instanceof Error ? error.message : String(error),
          at: nowIso(),
        });
      } finally {
        this.gate.release();
        done += 1;
        job.progress = { done, total: rows.length };
        this.emit(job.id, { kind: "progress", ...job.progress, at: nowIso() });
      }
    };

    // 按并发闸分批排队，避免一次性把整批 Promise 压上去
    const width = this.deps.compileConcurrency ?? DEFAULT_COMPILE_CONCURRENCY;
    for (let i = 0; i < rows.length; i += width) {
      await Promise.all(rows.slice(i, i + width).map(compileOne));
    }

    // 4/4 汇总
    job.stage = "done";
    job.finishedAt = nowIso();
    this.emit(job.id, { kind: "stage", stage: "done", at: job.finishedAt });
    this.emit(job.id, { kind: "done", at: job.finishedAt });
    logger.info({ importId: job.id, testSetId, ...summary, failed: summary.failed.length }, "[automation] 需求导入完成");
  }

  private setStage(job: ImportJob, stage: ImportStage): void {
    job.stage = stage;
    this.emit(job.id, { kind: "stage", stage, at: nowIso() });
  }

  private fail(job: ImportJob, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    job.error = message;
    job.stage = "done";
    job.finishedAt = nowIso();
    this.emit(job.id, { kind: "error", message, at: job.finishedAt });
    this.emit(job.id, { kind: "done", at: job.finishedAt });
    logger.warn({ importId: job.id, err: error }, "[automation] 需求导入失败");
  }

  private emit(id: string, event: ImportEvent): void {
    const buffer = this.events.get(id);
    if (buffer) {
      buffer.push(event);
      if (buffer.length > MAX_BUFFERED_EVENTS) buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
    }
    for (const listener of this.listeners.get(id) ?? []) {
      try {
        listener(event);
      } catch (error) {
        logger.warn({ err: error }, "[automation] 导入 SSE 监听器异常");
      }
    }
  }

  private evict(id: string): void {
    if ((this.listeners.get(id)?.size ?? 0) > 0) return; // 仍有直播订阅者时推迟逐出
    this.events.delete(id);
    this.jobs.delete(id);
  }
}
