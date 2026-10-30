/**
 * 压测执行管理器：全局串行队列（同一时刻仅一个执行），事件扇出供 SSE 订阅，
 * 断线恢复靠每执行的环形事件缓冲（订阅时先回放）。
 * 术语：CONTEXT.md「压测执行」；执行架构决策见 docs/adr/0011。
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { logger } from "../../logger.js";
import { ProcessK6Runner, resolveK6Binary, type K6Runner } from "./k6-runner.js";
import { acquireExecutionLock, assertNoExistingK6 } from './execution-lock.js';
import { querySeries, queryErrorSamples, type MonitorService } from './monitor.js';
import {
  type LoadTestProject,
  type LoadTestRepository,
  type LoadTestRun,
  MAX_LOG_TAIL_LENGTH,
} from "./types.js";

export type LoadTestEvent =
  | { type: "log"; line: string }
  | { type: "status"; status: LoadTestRun["status"]; exitCode: number | null; error: string | null }
  | { type: "summary"; text: string };

/** 每个执行保留的事件缓冲条数（SSE 重连回放用） */
const EVENT_BUFFER_LIMIT = 500;

/** 环境变量键白名单格式（大写蛇形），且不允许覆盖框架管理键 */
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const MANAGED_ENV_KEYS = new Set(["TEST_ID", "PAYLOAD_FILE"]);

/** k6 摘要提取：从日志尾部取关键指标行（check / 请求 / 迭代 / VU / 自定义计数器） */
const SUMMARY_LINE = /^\s*(✓|✗|\s)*(checks_|http_req_|iterations\.|vus|data_received|data_sent|survey_|[a-z_]+\.{2,}:)/i;
/** 进度行（如 `survey_submit   [  69% ] 4/5 VUs`）不视为指标行 */
const PROGRESS_LINE = /\[\s*\d+(\.\d+)?%\s*\]/;

export function extractSummary(logTail: string): string | null {
  const lines = logTail.split("\n");
  const picked: string[] = [];
  // 从尾部向前收集指标行，最多回看 200 行
  for (let i = lines.length - 1; i >= 0 && lines.length - i <= 200; i -= 1) {
    const line = lines[i];
    if (SUMMARY_LINE.test(line) && !PROGRESS_LINE.test(line) && !line.includes("running (")) picked.unshift(line.trimEnd());
    if (picked.length >= 40) break;
  }
  return picked.length > 0 ? picked.join("\n") : null;
}

interface RunManagerDeps {
  repo: LoadTestRepository;
  runner: K6Runner;
  /** 执行产物根目录（script.js / payload.json / 日志按 runId 分目录） */
  workDirRoot: string;
  monitor?: MonitorService;
}

export class RunManager {
  private queue: string[] = [];
  private currentRunId: string | null = null;
  private stopRequested = new Set<string>();
  private listeners = new Map<string, Set<(event: LoadTestEvent) => void>>();
  private eventBuffers = new Map<string, LoadTestEvent[]>();
  private progressSamples = new Map<string, { time: number; value: number }[]>();
  private collecting = new Set<string>();

  constructor(private deps: RunManagerDeps) {}

  /** 发起执行：落库为 queued 后入队；串行，当前有执行时排队等待。 */
  async enqueue(project: LoadTestProject, overrides: Record<string, string>): Promise<LoadTestRun> {
    for (const key of Object.keys(overrides)) {
      if (!ENV_KEY_PATTERN.test(key)) throw new Error(`环境变量名不合法：${key}`);
      if (MANAGED_ENV_KEYS.has(key)) throw new Error(`环境变量 ${key} 由框架管理，不可覆盖`);
    }
    const run = await this.deps.repo.createRun({
      projectId: project.id,
      envSnapshot: { ...project.envVars, ...overrides },
      scriptSnapshot: project.scriptSource,
    });
    const workDir = join(resolve(this.deps.workDirRoot), run.id);
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, 'payload-snapshot.json'), JSON.stringify(project.payloadTemplate), 'utf8');
    this.queue.push(run.id);
    this.emit(run.id, { type: "status", status: "queued", exitCode: null, error: null });
    void this.pump();
    return run;
  }

  /** 停止执行：排队中直接标记 stopped 出队；运行中请求 k6 优雅停止。 */
  async stop(runId: string): Promise<LoadTestRun> {
    const run = await this.deps.repo.getRun(runId);
    if (!run) throw new Error("压测执行不存在");
    if ((run.status === "queued" || run.status === "running") && this.currentRunId !== runId && !this.queue.includes(runId)) {
      throw new Error("该执行由其他服务实例管理，当前实例无法停止；请连接发起执行的实例");
    }
    if (run.status === "queued") {
      this.queue = this.queue.filter((id) => id !== runId);
      const updated = await this.deps.repo.updateRun(runId, { status: "stopped", endedAt: new Date() });
      this.emit(runId, { type: "status", status: "stopped", exitCode: null, error: null });
      return updated;
    }
    if (run.status !== "running") throw new Error("执行已结束，无需停止");
    this.stopRequested.add(runId);
    this.deps.runner.stop(runId);
    return run;
  }

  /** 订阅执行事件：先回放缓冲（断线恢复），再推送增量；返回退订函数。 */
  subscribe(runId: string, listener: (event: LoadTestEvent) => void): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    for (const event of this.eventBuffers.get(runId) ?? []) listener(event);
    return () => {
      const current = this.listeners.get(runId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(runId);
    };
  }

  /** 当前正在运行或排队中的执行 id（前端恢复入口）。 */
  activeRunIds(): { running: string | null; queued: string[] } {
    return { running: this.currentRunId, queued: [...this.queue] };
  }

  progress(runId: string) { return this.progressSamples.get(runId) ?? []; }
  isCollecting(runId: string) { return this.collecting.has(runId); }

  private emit(runId: string, event: LoadTestEvent): void {
    let buffer = this.eventBuffers.get(runId);
    if (!buffer) {
      buffer = [];
      this.eventBuffers.set(runId, buffer);
    }
    buffer.push(event);
    if (buffer.length > EVENT_BUFFER_LIMIT) buffer.splice(0, buffer.length - EVENT_BUFFER_LIMIT);
    for (const listener of this.listeners.get(runId) ?? []) {
      try {
        listener(event);
      } catch (error) {
        logger.warn({ err: error }, "[loadtest] SSE 监听器回调异常");
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.currentRunId) return;
    const nextId = this.queue.shift();
    if (!nextId) return;
    this.currentRunId = nextId;
    let release: (() => Promise<void>) | undefined;
    try {
      try {
        release = await acquireExecutionLock();
      } catch {
        throw new Error('本机压测执行锁端口 39841 已占用，另一实例可能正在运行，请稍后重试');
      }
      if (this.deps.runner instanceof ProcessK6Runner) await assertNoExistingK6(resolveK6Binary(process.cwd()));
      await this.execute(nextId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法取得压测执行锁';
      const run = await this.deps.repo.getRun(nextId);
      if (run?.status === 'queued') {
        await this.deps.repo.updateRun(nextId, { status: 'failed', error: message, endedAt: new Date() });
        this.emit(nextId, { type: 'status', status: 'failed', exitCode: null, error: message });
      } else logger.error({ err: error }, '[loadtest] 执行队列异常');
    } finally {
      if (release) await release().catch(error => logger.error({ err: error }, '[loadtest] 释放执行锁失败'));
      this.currentRunId = null;
      this.stopRequested.delete(nextId);
      // 缓冲保留供历史回看页冷启动回放；listeners 已无订阅者时清理解
      this.listeners.delete(nextId);
      void this.pump();
    }
  }

  private async execute(runId: string): Promise<void> {
    const repo = this.deps.repo;
    const run = await repo.getRun(runId);
    if (!run) return;
    if (run.status !== "queued") return;

    await repo.updateRun(runId, { status: "running", startedAt: new Date() });
    this.emit(runId, { type: "status", status: "running", exitCode: null, error: null });

    const workDir = join(resolve(this.deps.workDirRoot), runId);
    let logTail = "";
    const progress: { time: number; value: number }[] = [];
    this.progressSamples.set(runId, progress);
    const appendLog = (line: string): void => {
      logTail = (logTail + line + "\n").slice(-MAX_LOG_TAIL_LENGTH);
      const match = line.match(/running\s*\([^)]*\),\s*(\d+)\/(\d+)\s+VUs/i);
      if (match) progress.push({ time: Date.now(), value: Number(match[1]) });
      this.emit(runId, { type: "log", line });
    };

    try {
      await mkdir(workDir, { recursive: true });
      const prometheusUrl = this.deps.monitor?.activeUrl();
      const monitorConfig = this.deps.monitor?.get().config;
      const targets = monitorConfig?.targets ?? [];
      if (prometheusUrl) await writeFile(join(workDir, 'monitor.json'), JSON.stringify({ prometheusUrl, targets, loadGeneratorTarget: monitorConfig?.loadGeneratorTarget ?? null }), 'utf8');
      const scriptPath = join(workDir, "script.js");
      await writeFile(scriptPath, run.scriptSnapshot, "utf8");
      const payload = JSON.parse(await readFile(join(workDir, 'payload-snapshot.json'), 'utf8')) as string | null;
      const payloadPath = payload ? join(workDir, "payload.json") : null;
      if (payloadPath) await writeFile(payloadPath, payload!, "utf8");

      const result = await this.deps.runner.start(
        { runId, scriptPath, payloadPath, env: run.envSnapshot, workDir, prometheusUrl },
        appendLog,
      );
      const stopped = this.stopRequested.has(runId);
      const status: LoadTestRun["status"] = stopped ? "stopped" : result.exitCode === 0 ? "succeeded" : "failed";
      const summaryText = extractSummary(logTail);
      try { await writeFile(join(workDir, 'progress.json'), JSON.stringify(progress), 'utf8'); }
      catch (error) { logger.warn({ err: error }, '[loadtest] 保存进度曲线失败'); }
      this.progressSamples.delete(runId);
      if (summaryText) this.emit(runId, { type: "summary", text: summaryText });
      if (prometheusUrl) this.collecting.add(runId);
      await repo.updateRun(runId, {
        status,
        logTail,
        summaryText,
        exitCode: result.exitCode,
        error: status === "failed" ? `k6 退出码 ${result.exitCode}` : null,
        endedAt: new Date(),
      });
      this.emit(runId, { type: "status", status, exitCode: result.exitCode, error: null });
      if (prometheusUrl) try {
        const finished = await repo.getRun(runId);
        if (finished?.startedAt && finished.endedAt) {
          const [series, errors] = await Promise.all([querySeries(prometheusUrl, runId, finished.startedAt, finished.endedAt, targets), queryErrorSamples(prometheusUrl, runId, finished.endedAt)]);
          await writeFile(join(workDir, 'series.json'), JSON.stringify(series), 'utf8');
          await writeFile(join(workDir, 'errors.json'), JSON.stringify(errors), 'utf8');
        }
      } catch (error) { logger.warn({ err: error }, '[loadtest] 保存监控曲线失败'); }
      finally { this.collecting.delete(runId); }
    } catch (error) {
      this.progressSamples.delete(runId);
      this.collecting.delete(runId);
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, `[loadtest] 执行失败 ${runId}`);
      appendLog(`[loadtest] 执行器异常：${message}`);
      await repo.updateRun(runId, { status: "failed", logTail, error: message, endedAt: new Date() });
      this.emit(runId, { type: "status", status: "failed", exitCode: null, error: message });
    }
  }
}
