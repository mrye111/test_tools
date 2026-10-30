/** 计划执行器：把 CompiledPlan/用例步骤映射为 Midscene 调用，产出逐步结果与运行结论。 */

import type { Page } from "playwright";
import { logger } from "../../logger.js";
import type { FastFrame, FastLoopResult } from "./fast/fast-loop.js";
import { writeFastReplayReport, type FastReplayFrame } from "./fast-replay.js";
import { installUploadInjector, type UploadFileRef } from "./upload-inject.js";
import type {
  AutomationStep,
  CompiledSetup,
  ManualItem,
  PageTrailEntry,
  RunEvent,
  RunVerdict,
  StepResult,
} from "./types.js";

/** Midscene Agent 的最小抽象（测试注入替身；生产为 PlaywrightAgent 包装）。 */
export interface ExecutionAgent {
  aiAct(text: string, opts?: { abortSignal?: AbortSignal }): Promise<unknown>;
  aiAssert(text: string, opts?: { abortSignal?: AbortSignal }): Promise<unknown>;
  aiQuery(shape: string, demand: string): Promise<unknown>;
  aiWaitFor(text: string, opts?: { timeout?: number }): Promise<unknown>;
  addProgressListener?(listener: (event: AgentProgressLike) => void): () => void;
  destroy(): Promise<void>;
  reportFile?: string;
}

/** addProgressListener 事件的最小结构（@midscene/core AgentProgressEvent 的子集）。 */
export type AgentProgressLike = {
  scope?: string;
  phase?: string;
  data?: {
    thought?: string;
    screenshot?: string;
    action?: { name?: string; target?: string; point?: [number, number] };
    durationMs?: number;
    error?: unknown;
  };
};

export interface AgentSession {
  agent: ExecutionAgent;
  goto(url: string): Promise<void>;
  /** destroy agent（flush 报告）并关闭浏览器上下文；返回报告文件路径。 */
  close(): Promise<string | undefined>;
  /** 极速引擎需要直接操作页面（视觉引擎的 fake/测试会话可没有）。 */
  page?: Page;
}

export type SessionFactory = (opts: {
  cacheId?: string;
  onProgress?: (event: AgentProgressLike) => void;
}) => Promise<AgentSession>;

/** act 指令的极速执行器（fast-engine 门面注入；不可用为 null）。 */
export type FastActRunner = (goal: string, page: Page) => Promise<FastLoopResult>;

export type ExecutePlanInput = {
  steps: AutomationStep[];
  manualItems: ManualItem[];
  setup?: CompiledSetup[];
  /** 输入变量（凭据键名已解析为真实值之前的占位文本也在此替换）。 */
  variables?: Record<string, string>;
  entryUrl?: string;
  cacheId?: string;
  stepTimeoutMs?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  /** 复用既有会话（执行台）：跳过 createSession 与结束时的 close。 */
  existingSession?: AgentSession;
  /** 执行引擎：auto=act 优先极速（失败降级视觉）；visual=全部视觉。默认 visual。 */
  engine?: "auto" | "visual";
  /** 极速执行器（fast-engine 门面；auto 模式下有 page 且非空才生效）。 */
  fastRunner?: FastActRunner | null;
  /** 极速回放报告的标题/编号（RunManager 传运行记录字段）。 */
  reportTitle?: string;
  reportCaseNo?: string;
  /** P5 Test Files：上传类步骤弹出文件选择对话框时注入的项目附件（服务端路径）。 */
  uploadFiles?: UploadFileRef[];
};

export type ExecutePlanResult = {
  verdict: RunVerdict;
  stepResults: StepResult[];
  variables: Record<string, string>;
  reportFile?: string;
  error?: string;
  /** 极速回放帧（P4 站点图/帧画廊；由调用方写 run-data sidecar）。 */
  fastFrames?: FastReplayFrame[];
  /** 步骤边界页面轨迹（P4 站点图节点/边）。 */
  pageTrail?: PageTrailEntry[];
};

const DEFAULT_STEP_TIMEOUT = 120_000;

/** {{var}} 与 ${VAR} 单次替换（评审 M6：两遍替换会重扫已注入的值——密码含 ${ 会被改坏，页面内容含 ${PASSWORD} 会泄密）。 */
export function substituteVars(text: string, variables: Record<string, string>): string {
  return text.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (match, doubleBrace: string | undefined, dollarBrace: string | undefined) => {
      const name = doubleBrace ?? dollarBrace ?? "";
      return variables[name] !== undefined ? variables[name] : match;
    },
  );
}

/** 错误脱敏（评审 H4）：解析出的真实值（密码等）不进事件/落库/报告，替换为 ***。 */
function sanitizeErrorMessage(message: string, variables: Record<string, string>): string {
  let sanitized = message;
  for (const value of Object.values(variables)) {
    if (value && value.length >= 4 && sanitized.includes(value)) {
      sanitized = sanitized.split(value).join("***");
    }
  }
  return sanitized;
}

/** aiQuery/aiWaitFor 不支持 abortSignal（票据 01），外层 race 兜底；各结算路径都做清理（评审 LOW-10/11）。 */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error("已中止"));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const timer = setTimeout(() => settle(() => reject(new Error(`步骤超时（${Math.round(timeoutMs / 1000)}s）`))), timeoutMs);
    const onAbort = () => settle(() => reject(new Error("已中止")));
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
  });
}

/** 把 Midscene 进度事件映射为运行事件（截图帧单独成类，回放只保留最新一帧）。 */
export function mapProgressEvent(event: AgentProgressLike, at: () => string): RunEvent | null {
  if (event.scope !== "aiAct") return null;
  switch (event.phase) {
    case "plan_thinking":
      return event.data?.screenshot ? { kind: "screenshot", data: event.data.screenshot, at: at() } : null;
    case "plan_planned":
      return event.data?.thought ? { kind: "thought", text: event.data.thought, at: at() } : null;
    case "action_running":
      return { kind: "action", name: event.data?.action?.name ?? "action", point: event.data?.action?.point, phase: "start", at: at() };
    case "action_done":
      return { kind: "action", name: event.data?.action?.name ?? "action", point: event.data?.action?.point, phase: "done", durationMs: event.data?.durationMs, at: at() };
    case "action_failed":
      return { kind: "action", name: event.data?.action?.name ?? "action", point: event.data?.action?.point, phase: "failed", durationMs: event.data?.durationMs, at: at() };
    default:
      return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 执行一份计划。失败即停（测试语义：后续步骤无意义）；人工项与 external 前置记 skipped-manual；
 * 中止（abortSignal）使结论为 aborted。报告路径在会话关闭时从 agent.reportFile 取回。
 */
export async function executePlan(input: ExecutePlanInput, deps: { createSession: SessionFactory }): Promise<ExecutePlanResult> {
  const now = () => new Date().toISOString();
  const emit = (event: RunEvent) => input.onEvent?.(event);
  const stepResults: StepResult[] = [];
  const variables: Record<string, string> = { ...(input.variables ?? {}) };
  const stepTimeout = input.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT;
  let reportFile: string | undefined;
  let aborted = false;

  const session = input.existingSession ?? (await deps.createSession({
    cacheId: input.cacheId,
    onProgress: (event) => {
      const mapped = mapProgressEvent(event, now);
      if (mapped) emit(mapped);
    },
  }));
  const ownsSession = !input.existingSession;

  // P5 Test Files 注入：文件选择对话框弹出时按当前步骤文本从附件库取文件填入（共享会话退出时必须 dispose）
  let currentStepText = "";
  const disposeUpload =
    input.uploadFiles?.length && session.page
      ? installUploadInjector(session.page, input.uploadFiles, () => currentStepText)
      : undefined;

  // 极速回放帧（运行级汇总；帧内文本先经凭据脱敏再进报告，评审 H4 同防线）
  const fastFrames: FastReplayFrame[] = [];
  const collectFastFrames = (frames: FastFrame[] | undefined, stepId: number): void => {
    for (const frame of frames ?? []) {
      fastFrames.push({
        ...frame,
        stepId,
        targetLabel: frame.targetLabel ? sanitizeErrorMessage(frame.targetLabel, variables) : undefined,
        text: frame.text ? sanitizeErrorMessage(frame.text, variables) : undefined,
        reason: frame.reason ? sanitizeErrorMessage(frame.reason, variables) : undefined,
      });
    }
  };

  // 页面轨迹（P4）：步骤开始时刻的页面 URL 采样，站点图节点/边的数据源
  const pageTrail: PageTrailEntry[] = [];
  const sampleTrail = (stepId: number): void => {
    try {
      const url = session.page?.url();
      if (url) pageTrail.push({ stepId, url, at: now() });
    } catch {
      // 页面已关闭等异常：该边界无采样，站点图按已有轨迹兜底
    }
  };

  /** Midscene 没产出报告（全程极速）时，用帧序列写一份原生格式的极速回放。 */
  const writeFastReplayIfNeeded = (verdict: RunVerdict): string | undefined => {
    if (!ownsSession || fastFrames.length === 0) return undefined;
    try {
      return writeFastReplayReport({
        caseNo: input.reportCaseNo ?? "",
        title: input.reportTitle ?? "极速回放",
        entryUrl: input.entryUrl ?? "",
        verdict,
        steps: stepResults.filter((r) => r.engine === "fast"),
        frames: fastFrames,
      });
    } catch (error) {
      logger.warn({ err: error }, "[automation] 极速回放报告生成失败");
      return undefined;
    }
  };

  try {
    for (const setup of input.setup ?? []) {
      if (setup.type === "external") {
        stepResults.push({ stepId: 0, type: "external", text: setup.text ?? "", status: "skipped-manual", durationMs: 0, error: setup.reason });
      }
    }

    const entryUrl = input.entryUrl ?? input.setup?.find((s) => s.type === "navigate")?.url;
    if (entryUrl && !input.abortSignal?.aborted) {
      await withAbort(session.goto(substituteVars(entryUrl, variables)), input.abortSignal, 30_000);
      sampleTrail(0);
    }

    for (const step of input.steps) {
      if (!step.enabled) {
        stepResults.push({ stepId: step.id, type: step.type, text: step.text, status: "skipped", durationMs: 0 });
        continue;
      }
      if (input.abortSignal?.aborted) {
        aborted = true;
        break;
      }
      // 事件与结果保留原始文本（含 ${KEY} 占位）；替换后的真实值只传给 agent，不进 SSE/落库/报告（评审 H4）
      const resolvedText = substituteVars(step.text, variables);
      currentStepText = resolvedText;
      emit({ kind: "step-start", stepId: step.id, stepType: step.type, text: step.text, at: now() });
      sampleTrail(step.id);
      const t0 = Date.now();
      try {
        switch (step.type) {
          case "act": {
            // 极速引擎优先（auto 模式 + 有页面 + 执行器可用），未达成则降级视觉引擎（票据 09）
            let fastDone = false;
            if ((input.engine ?? "visual") === "auto" && input.fastRunner && session.page) {
              const fast = await input.fastRunner(resolvedText, session.page);
              collectFastFrames(fast.frames, step.id);
              if (fast.ok) {
                fastDone = true;
              } else if (fast.fallback) {
                emit({ kind: "thought", text: `极速引擎未达成（${fast.reason ?? "未知原因"}），降级视觉引擎`, at: now() });
              } else {
                throw new Error(fast.reason ?? "极速引擎执行失败");
              }
            }
            if (fastDone) {
              stepResults.push({ stepId: step.id, type: step.type, text: step.text, status: "passed", durationMs: Date.now() - t0, engine: "fast" });
              emit({ kind: "step-done", stepId: step.id, status: "passed", durationMs: Date.now() - t0, engine: "fast", at: now() });
              continue;
            }
            await withAbort(session.agent.aiAct(resolvedText, { abortSignal: input.abortSignal }), input.abortSignal, stepTimeout);
            break;
          }
          case "assert":
            await withAbort(session.agent.aiAssert(resolvedText, { abortSignal: input.abortSignal }), input.abortSignal, stepTimeout);
            break;
          case "extract": {
            const result = await withAbort(session.agent.aiQuery("{value: string}", resolvedText), input.abortSignal, stepTimeout);
            const value = String((result as { value?: unknown })?.value ?? "");
            if (step.saveAs) {
              variables[step.saveAs] = value;
              emit({ kind: "variable", name: step.saveAs, value, at: now() });
            }
            stepResults.push({ stepId: step.id, type: step.type, text: step.text, status: "passed", durationMs: Date.now() - t0, extractedValue: value, engine: "visual" });
            emit({ kind: "step-done", stepId: step.id, status: "passed", durationMs: Date.now() - t0, at: now() });
            continue;
          }
          case "wait":
            await withAbort(session.agent.aiWaitFor(resolvedText, { timeout: stepTimeout }), input.abortSignal, stepTimeout);
            break;
        }
        stepResults.push({ stepId: step.id, type: step.type, text: step.text, status: "passed", durationMs: Date.now() - t0, engine: "visual" });
        emit({ kind: "step-done", stepId: step.id, status: "passed", durationMs: Date.now() - t0, at: now() });
      } catch (error) {
        const message = sanitizeErrorMessage(errorMessage(error), variables);
        if (input.abortSignal?.aborted || message === "已中止") {
          // 被中止的步骤补终态（评审 LOW-12：否则 SSE 端永远显示"执行中"）
          stepResults.push({ stepId: step.id, type: step.type, text: step.text, status: "failed", durationMs: Date.now() - t0, error: "已中止" });
          emit({ kind: "step-done", stepId: step.id, status: "failed", durationMs: Date.now() - t0, error: "已中止", at: now() });
          aborted = true;
          break;
        }
        stepResults.push({ stepId: step.id, type: step.type, text: step.text, status: "failed", durationMs: Date.now() - t0, error: message });
        emit({ kind: "step-done", stepId: step.id, status: "failed", durationMs: Date.now() - t0, error: message, at: now() });
        break;
      }
    }
  } catch (error) {
    const message = errorMessage(error);
    if (input.abortSignal?.aborted || message === "已中止") {
      aborted = true;
    } else {
      // 导航/会话级失败：整个运行无法开始
      disposeUpload?.();
      reportFile = ownsSession ? await safeClose(session) : undefined;
      reportFile ??= writeFastReplayIfNeeded("failed");
      return { verdict: "failed", stepResults, variables, reportFile, error: message, fastFrames, pageTrail };
    }
  }

  disposeUpload?.();
  reportFile = ownsSession ? await safeClose(session) : undefined;

  for (const item of input.manualItems) {
    stepResults.push({ stepId: item.fromStep ?? 0, type: "external", text: item.text, status: "skipped-manual", durationMs: 0, error: item.reason });
  }

  const verdict: RunVerdict = aborted
    ? "aborted"
    : stepResults.some((r) => r.status === "failed")
      ? "failed"
      : input.manualItems.length > 0
        ? "partial"
        : "passed";
  reportFile ??= writeFastReplayIfNeeded(verdict);
  return { verdict, stepResults, variables, reportFile, fastFrames, pageTrail };
}

async function safeClose(session: AgentSession): Promise<string | undefined> {
  try {
    return await session.close();
  } catch {
    return undefined;
  }
}
