/** 规划编排（P3）：捕获页 + PRD → LLM 提案 → 确定性校验 → 批量落库（import-manager 同款任务编排）。 */

import { randomUUID } from "node:crypto";
import { logger } from "../../logger.js";
import type { AiRequestConfig } from "../testcase/types.js";
import type { ChatCaller } from "./compiler.js";
import { extractJsonObject } from "./compiler.js";
import { buildPlanRetryMessage, buildPlanUserMessage, PLAN_SYSTEM_PROMPT } from "./plan-prompts.js";
import { validateProposals, type ProposalDraft } from "./plan-proposals.js";
import type { AutomationRepository, NewPlanProposal, PlanProposal } from "./types.js";

export type PlanStage = "generate" | "validate" | "done";

export type PlanSummary = {
  created: number;
  dropped: number;
  useCases: number;
  notes: string[];
};

export type PlanJob = {
  id: string;
  projectId: string;
  sourceId?: string;
  /** 同批提案共享批次号（评审页按批展示）。 */
  batchId: string;
  stage: PlanStage;
  summary?: PlanSummary;
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

export type PlanEvent =
  | { kind: "stage"; stage: PlanStage; at: string }
  | { kind: "log"; level: "info" | "warn"; text: string; at: string }
  | { kind: "done"; batchId: string; summary?: PlanSummary; at: string }
  | { kind: "error"; message: string; at: string };

export type PlanPageInput = {
  url: string;
  title: string;
  aiSummary: string;
  /** 元素名清单（截取后的轻量形态，进 prompt）。 */
  elementNames: string[];
};

export type StartPlanInput = {
  projectId: string;
  sourceId?: string;
  entryUrl: string;
  prdText: string;
  extraInstructions: string;
  pages: PlanPageInput[];
  aiConfig: AiRequestConfig;
};

export type PlanManagerDeps = {
  automationRepo: Pick<AutomationRepository, "createProposals">;
  /** 构造 LLM 调用器（生产接 callChatCompletion；测试接替身）。 */
  createChatCaller: (aiConfig: AiRequestConfig) => ChatCaller;
  /** 完成后的回放保留窗口。 */
  jobTtlMs?: number;
};

const MAX_BUFFERED_EVENTS = 500;
const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

export class PlanManager {
  private jobs = new Map<string, PlanJob>();
  private events = new Map<string, PlanEvent[]>();
  private listeners = new Map<string, Set<(event: PlanEvent) => void>>();

  constructor(private deps: PlanManagerDeps) {}

  getJob(id: string): PlanJob | null {
    return this.jobs.get(id) ?? null;
  }

  /** 任务是否仍在跑（SSE 路由防挂死：已结束/已逐出直接收尾）。 */
  isActive(id: string): boolean {
    const job = this.jobs.get(id);
    return job !== undefined && job.stage !== "done";
  }

  /** 订阅进度：先回放缓冲事件，再挂直播。返回退订函数。 */
  subscribe(id: string, listener: (event: PlanEvent) => void): () => void {
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

  /** 启动生成任务（立即返回 job，编排在后台跑）。 */
  startGenerate(input: StartPlanInput): PlanJob {
    const id = randomUUID();
    const job: PlanJob = {
      id,
      projectId: input.projectId,
      sourceId: input.sourceId,
      batchId: randomUUID(),
      stage: "generate",
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

  private async run(job: PlanJob, input: StartPlanInput): Promise<void> {
    this.setStage(job, "generate");
    this.emit(job.id, {
      kind: "log",
      level: "info",
      text: `规划输入：${input.pages.length} 个捕获页${input.prdText ? " + PRD" : ""}${input.extraInstructions ? " + 额外指令" : ""}`,
      at: nowIso(),
    });

    const callChat = this.deps.createChatCaller(input.aiConfig);
    const baseMessages = [
      { role: "system" as const, content: PLAN_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: buildPlanUserMessage({
          entryUrl: input.entryUrl,
          prdText: input.prdText,
          extraInstructions: input.extraInstructions,
          pages: input.pages,
        }),
      },
    ];

    let lastErrors: string[] = [];
    let drafts: ProposalDraft[] = [];
    let dropped = 0;
    let notes: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages =
        attempt === 0 ? baseMessages : [...baseMessages, { role: "user" as const, content: buildPlanRetryMessage(lastErrors) }];
      const raw = await callChat(messages);
      const parsed = extractJsonObject(raw);
      const validation = validateProposals(parsed);
      if (validation.ok) {
        drafts = validation.proposals;
        dropped = validation.dropped;
        notes = validation.notes;
        break;
      }
      lastErrors = validation.errors;
    }
    if (drafts.length === 0) {
      throw new Error(`提案生成失败：${lastErrors.join("；") || "模型输出不可用"}`);
    }

    // validate 阶段：落库（caseNo 按项目内 ATP-N 分配）
    this.setStage(job, "validate");
    for (const note of notes) this.emit(job.id, { kind: "log", level: "warn", text: note, at: nowIso() });
    const inputs: NewPlanProposal[] = drafts.map((draft) => ({
      projectId: input.projectId,
      batchId: job.batchId,
      sourceId: input.sourceId,
      useCase: draft.useCase,
      title: draft.title,
      goal: draft.goal,
      expected: draft.expected,
      priority: draft.priority,
      estSteps: draft.estSteps,
      included: true,
      status: "proposed",
    }));
    const created = await this.deps.automationRepo.createProposals(inputs);

    const summary: PlanSummary = {
      created: created.length,
      dropped,
      useCases: new Set(created.map((p) => p.useCase)).size,
      notes,
    };
    job.summary = summary;
    this.setStage(job, "done");
    job.finishedAt = nowIso();
    this.emit(job.id, { kind: "done", batchId: job.batchId, summary, at: job.finishedAt });
    logger.info(
      { planJobId: job.id, batchId: job.batchId, created: summary.created, dropped: summary.dropped, useCases: summary.useCases },
      "[automation] 规划提案生成完成",
    );
  }

  private setStage(job: PlanJob, stage: PlanStage): void {
    job.stage = stage;
    this.emit(job.id, { kind: "stage", stage, at: nowIso() });
  }

  private fail(job: PlanJob, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    job.error = message;
    job.stage = "done";
    job.finishedAt = nowIso();
    this.emit(job.id, { kind: "error", message, at: job.finishedAt });
    this.emit(job.id, { kind: "done", batchId: job.batchId, at: job.finishedAt });
    logger.warn({ planJobId: job.id, err: error }, "[automation] 规划提案生成失败");
  }

  private emit(id: string, event: PlanEvent): void {
    const buffer = this.events.get(id);
    if (buffer) {
      buffer.push(event);
      if (buffer.length > MAX_BUFFERED_EVENTS) buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
    }
    for (const listener of this.listeners.get(id) ?? []) {
      try {
        listener(event);
      } catch (error) {
        logger.warn({ err: error }, "[automation] 规划 SSE 监听器异常");
      }
    }
  }

  private evict(id: string): void {
    if ((this.listeners.get(id)?.size ?? 0) > 0) return; // 仍有直播订阅者时推迟逐出
    this.events.delete(id);
    this.jobs.delete(id);
  }
}
