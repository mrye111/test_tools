/** 运行管理器：运行生命周期、并发闸（全局 N + 同用例串行）、事件总线（SSE 直播与回放）、持久化。 */

import { randomUUID } from "node:crypto";
import { logger } from "../../logger.js";
import { writeRunInsight } from "./run-insight.js";
import { executePlan, type FastActRunner, type SessionFactory } from "./runner.js";
import type { UploadFileRef } from "./upload-inject.js";
import type {
  AutomationCase,
  AutomationRepository,
  AutomationStep,
  CompiledPlan,
  CompiledSetup,
  RunEvent,
  RunRecord,
  RunVerdict,
} from "./types.js";

export type StartRunInput =
  | { kind: "case"; automationCase: AutomationCase; batchId?: string; engine?: "auto" | "visual"; useCache?: boolean; environmentId?: string; runGroupId?: string; onDone?: (record: RunRecord) => void | Promise<void> }
  | { kind: "plan"; plan: CompiledPlan; caseId?: string; batchId?: string; engine?: "auto" | "visual"; entryUrl?: string; cacheId?: string; environmentId?: string; runGroupId?: string; onDone?: (record: RunRecord) => void | Promise<void> };

/** 执行视口（P4 记录）：对齐 browser-pool 的 VIEWPORT。 */
const RUN_VIEWPORT = "1440x900";

type PendingExecution = {
  steps: AutomationStep[];
  setup: CompiledSetup[];
  variables: Record<string, string>;
  /** P5 Test Files：启动时快照的项目附件（上传步骤注入用）。 */
  uploadFiles?: UploadFileRef[];
};

const MAX_BUFFERED_EVENTS = 500;
/** 完成后的回放保留窗口（超时逐出内存事件/截图/记录，防无界增长）。 */
const EVENT_TTL_MS = 30 * 60 * 1000;

/** varDefs 的值是服务端配置键名：从 process.env 解析真实值；未配置时保留占位（指令原样下发，便于人工排查）。 */
function resolveVarDefs(varDefs: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, configKey] of Object.entries(varDefs)) {
    const value = process.env[configKey];
    if (value !== undefined) resolved[name] = value;
  }
  return resolved;
}

export class RunManager {
  private runs = new Map<string, RunRecord>();
  private pending = new Map<string, PendingExecution>();
  private events = new Map<string, RunEvent[]>();
  private latestScreenshot = new Map<string, RunEvent & { kind: "screenshot" }>();
  private listeners = new Map<string, Set<(event: RunEvent) => void>>();
  private abortControllers = new Map<string, AbortController>();
  private onDoneCallbacks = new Map<string, (record: RunRecord) => void | Promise<void>>();
  private queue: string[] = [];
  private runningKeys = new Set<string>();
  private activeCount = 0;

  constructor(
    private deps: {
      repo: AutomationRepository;
      sessionFactory: SessionFactory;
      concurrency?: number;
      /** 执行缓存默认开关（路由可覆盖）。 */
      cacheDefault?: boolean;
      /** 运行参数对象（config-store 的 ExecutionSettings，按引用共享，界面改配置即热生效）。 */
      settings?: { concurrency: number; cacheDefault: boolean };
      /** 极速执行器（fast-engine 门面；null 表示不可用，auto 模式自动降级视觉）。 */
      fastRunner?: FastActRunner | null;
      /** 运行产物根目录（P4 run-data sidecar 落盘位置）。 */
      runDir?: string;
    },
  ) {}

  private get concurrency(): number {
    return this.deps.settings?.concurrency ?? this.deps.concurrency ?? 3;
  }

  private get cacheDefault(): boolean {
    return this.deps.settings?.cacheDefault ?? this.deps.cacheDefault ?? true;
  }

  async startRun(input: StartRunInput): Promise<RunRecord> {
    const now = new Date().toISOString();
    const record: RunRecord = {
      id: randomUUID(),
      caseId: input.kind === "case" ? input.automationCase.id : input.caseId,
      batchId: input.batchId,
      caseNo: input.kind === "case" ? input.automationCase.caseNo : input.plan.caseRef,
      title: input.kind === "case" ? input.automationCase.title : `功能用例直跑 · ${input.plan.caseRef}`,
      engine: input.engine ?? "visual",
      status: "queued",
      stepResults: [],
      manualItems: input.kind === "case" ? input.automationCase.manualItems : input.plan.manualItems,
      entryUrl: input.kind === "case" ? input.automationCase.entryUrl : (input.entryUrl ?? ""),
      cacheId:
        input.kind === "case"
          ? (input.useCache ?? this.cacheDefault)
            ? `case-${input.automationCase.id}`
            : undefined
          : input.cacheId,
      createdAt: now,
      environmentId: input.environmentId,
      viewport: RUN_VIEWPORT,
      runGroupId: input.runGroupId ?? input.batchId,
    };
    // P5 Test Files：启动时快照项目附件（附件库为空时注入器不安装）；失败不阻塞执行
    const uploadFiles =
      input.kind === "case"
        ? (await this.deps.repo.listTestFiles(input.automationCase.projectId).catch(() => [])).map((f) => ({ filename: f.filename, path: f.path }))
        : undefined;
    const pending: PendingExecution =
      input.kind === "case"
        ? {
            steps: input.automationCase.steps,
            setup: input.automationCase.entryUrl ? [{ type: "navigate", url: input.automationCase.entryUrl }] : [],
            variables: resolveVarDefs(input.automationCase.varDefs),
            uploadFiles,
          }
        : {
            steps: input.plan.instructions,
            setup: input.plan.setup,
            variables: Object.fromEntries(
              input.plan.variables.filter((v) => v.value !== null).map((v) => [v.name, v.value as string]),
            ),
          };
    this.pending.set(record.id, pending);
    this.runs.set(record.id, record);
    this.events.set(record.id, []);
    this.abortControllers.set(record.id, new AbortController());
    if (input.onDone) this.onDoneCallbacks.set(record.id, input.onDone);
    await this.deps.repo.createRunRecord(record);
    this.queue.push(record.id);
    this.emit(record.id, { kind: "status", status: "queued", at: now });
    this.pump();
    return record;
  }

  getRun(id: string): RunRecord | null {
    return this.runs.get(id) ?? null;
  }

  async listRuns(caseId?: string, limit = 50): Promise<RunRecord[]> {
    return this.deps.repo.listRunRecords(caseId, limit);
  }

  /** 中止：排队中直接取消；执行中触发 AbortController（aiAct/aiAssert 原生响应，其余 race 兜底）。 */
  abortRun(id: string): boolean {
    const record = this.runs.get(id);
    if (!record || record.status === "done") return false;
    if (record.status === "queued") {
      this.queue = this.queue.filter((queuedId) => queuedId !== id);
      void this.finish(id, "aborted", { error: "排队中被中止" });
      return true;
    }
    this.abortControllers.get(id)?.abort();
    return true;
  }

  /** 订阅运行事件：先回放缓冲（截图只回放最新一帧），再挂直播。 */
  subscribe(id: string, listener: (event: RunEvent) => void): () => void {
    for (const event of this.events.get(id) ?? []) {
      if (event.kind !== "screenshot") {
        try {
          listener(event);
        } catch {
          return () => undefined; // 回放段抛错（如连接已断）直接放弃订阅
        }
      }
    }
    const latest = this.latestScreenshot.get(id);
    if (latest) {
      try {
        listener(latest);
      } catch {
        return () => undefined;
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

  private emit(id: string, event: RunEvent): void {
    if (event.kind === "screenshot") {
      this.latestScreenshot.set(id, event as RunEvent & { kind: "screenshot" });
    } else {
      const buffer = this.events.get(id);
      if (buffer) {
        buffer.push(event);
        if (buffer.length > MAX_BUFFERED_EVENTS) buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
      }
    }
    for (const listener of this.listeners.get(id) ?? []) {
      try {
        listener(event);
      } catch (error) {
        logger.warn({ err: error }, "[automation] SSE 监听器异常");
      }
    }
  }

  private pump(): void {
    const concurrency = this.concurrency;
    while (this.activeCount < concurrency) {
      const nextId = this.queue.find((id) => {
        const record = this.runs.get(id);
        // 串行键：cacheId 优先（plan 直跑按用例集串行，保缓存文件写互斥，评审 H2）
        return record && !this.runningKeys.has(record.cacheId ?? record.caseId ?? record.id);
      });
      if (!nextId) return;
      this.queue = this.queue.filter((id) => id !== nextId);
      const record = this.runs.get(nextId);
      if (!record) continue;
      this.activeCount++;
      this.runningKeys.add(record.cacheId ?? record.caseId ?? record.id);
      void this.execute(record)
        .catch((error) => this.finish(record.id, "failed", { error: error instanceof Error ? error.message : String(error) }))
        .finally(() => {
          this.activeCount--;
          this.runningKeys.delete(record.cacheId ?? record.caseId ?? record.id);
          this.pump();
        });
    }
  }

  private async execute(record: RunRecord): Promise<void> {
    // startRun 持久化窗口内被 abort 的兜底：已 finish 的运行不再执行（评审 M5）
    if (record.status === "done") return;
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const pending = this.pending.get(record.id) ?? { steps: [], setup: [], variables: {} };
    const controller = this.abortControllers.get(record.id);
    try {
      // running 状态持久化放进 try：DB 抖动时拒付不逃逸为 unhandledRejection（评审 C1）
      record.status = "running";
      record.startedAt = startedAt;
      await this.deps.repo.updateRunRecord(record.id, { status: "running", startedAt });
      this.emit(record.id, { kind: "status", status: "running", at: startedAt });

      const result = await executePlan(
        {
          steps: pending.steps,
          manualItems: record.manualItems,
          setup: pending.setup,
          variables: pending.variables,
          entryUrl: record.entryUrl,
          cacheId: record.cacheId,
          engine: record.engine,
          fastRunner: this.deps.fastRunner,
          abortSignal: controller?.signal,
          onEvent: (event) => this.emit(record.id, event),
          reportTitle: record.title,
          reportCaseNo: record.caseNo,
          uploadFiles: pending.uploadFiles,
        },
        { createSession: this.deps.sessionFactory },
      );
      await this.finish(record.id, result.verdict, {
        stepResults: result.stepResults,
        reportFile: result.reportFile,
        error: result.error,
        durationMs: Date.now() - t0,
        fastFrames: result.fastFrames,
        pageTrail: result.pageTrail,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.finish(record.id, controller?.signal.aborted ? "aborted" : "failed", {
        error: message,
        durationMs: Date.now() - t0,
      });
    }
  }

  private async finish(id: string, verdict: RunVerdict, patch: Partial<RunRecord>): Promise<void> {
    const record = this.runs.get(id);
    const finishedAt = new Date().toISOString();
    const merged: RunRecord = {
      ...(record ?? ({ id, caseNo: "", title: "", engine: "visual", status: "queued", stepResults: [], manualItems: [], entryUrl: "", createdAt: finishedAt } as RunRecord)),
      ...patch,
      status: "done",
      verdict,
      finishedAt,
    };
    this.runs.set(id, merged);
    await this.deps.repo
      .updateRunRecord(id, {
        status: "done",
        verdict,
        stepResults: merged.stepResults,
        reportFile: merged.reportFile,
        error: merged.error,
        durationMs: merged.durationMs,
        finishedAt,
      })
      .catch((error) => logger.warn({ err: error }, "[automation] 运行结果持久化失败"));

    // P4 run-data sidecar：帧序列 + 页面轨迹落盘（站点图/帧画廊数据源；失败不阻塞收尾）
    if (this.deps.runDir && (merged.fastFrames?.length || merged.pageTrail?.length)) {
      await writeRunInsight(this.deps.runDir, id, {
        pageTrail: merged.pageTrail ?? [],
        frames: merged.fastFrames ?? [],
      }).catch((error) => logger.warn({ err: error }, "[automation] run-data sidecar 写入失败"));
    }

    // 回写用例最近运行状态（aborted 无对应档位，记 failed）；定点 SQL 避免覆盖用户并发编辑（评审 LOW-16）
    if (merged.caseId) {
      const lastRunStatus = verdict === "aborted" ? "failed" : verdict;
      await this.deps.repo.updateCaseRunStatus(merged.caseId, lastRunStatus, finishedAt).catch(() => undefined);
    }

    // onDone 先于 verdict 事件执行：SSE 到达前端时服务端回写已落库（评审 C2 时序保证）
    const onDone = this.onDoneCallbacks.get(id);
    this.cleanup(id);
    if (onDone) {
      try {
        await onDone(merged);
      } catch (error) {
        logger.warn({ err: error }, "[automation] onDone 回调失败");
      }
    }

    this.emit(id, { kind: "verdict", verdict, durationMs: merged.durationMs ?? 0, reportFile: merged.reportFile, at: finishedAt });
    this.emit(id, { kind: "status", status: "done", at: finishedAt });

    // 事件/截图/内存记录 TTL 逐出（回放窗口 30 分钟；历史记录由 repo 兜底，评审 H3）
    const evictTimer = setTimeout(() => this.evict(id), EVENT_TTL_MS);
    evictTimer.unref?.();
  }

  private evict(id: string): void {
    if ((this.listeners.get(id)?.size ?? 0) > 0) return; // 仍有直播订阅者时推迟逐出
    this.events.delete(id);
    this.latestScreenshot.delete(id);
    this.runs.delete(id);
  }

  private cleanup(id: string): void {
    this.abortControllers.delete(id);
    this.onDoneCallbacks.delete(id);
    this.pending.delete(id);
  }
}
