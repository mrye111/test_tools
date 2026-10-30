/** 交互执行台管理器：持久浏览器会话（跨指令共享页面状态）、逐指令执行、步骤累积、闲置回收。 */

import { randomUUID } from "node:crypto";
import { logger } from "../../logger.js";
import { executePlan, type AgentSession, type SessionFactory } from "./runner.js";
import type { AutomationStep, RunEvent } from "./types.js";

export type BenchInstructionType = "act" | "assert" | "query";

export type BenchInstructResult = {
  ok: boolean;
  error?: string;
  events: RunEvent[];
  /** 最近一次规划截图（plan_thinking 事件），无则空。 */
  screenshot?: string;
  extractedValue?: string;
  durationMs: number;
};

type BenchSessionEntry = {
  id: string;
  url: string;
  session: AgentSession;
  steps: AutomationStep[];
  createdAt: string;
  lastUsedAt: number;
  expireTimer: NodeJS.Timeout;
  busy: boolean;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class BenchManager {
  private sessions = new Map<string, BenchSessionEntry>();

  constructor(
    private deps: {
      sessionFactory: SessionFactory;
      sessionTtlMs?: number;
    },
  ) {}

  /** 会话不存在或已回收时抛错（路由映射 404）。 */
  private require(id: string): BenchSessionEntry {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error("执行台会话不存在或已过期");
    return entry;
  }

  private touch(entry: BenchSessionEntry): void {
    entry.lastUsedAt = Date.now();
    entry.expireTimer.refresh();
  }

  async create(url: string): Promise<{ id: string; url: string }> {
    const session = await this.deps.sessionFactory({});
    const id = randomUUID();
    try {
      await session.goto(url);
    } catch (error) {
      await session.close().catch(() => undefined);
      throw new Error(`打开目标页面失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    const ttl = this.deps.sessionTtlMs ?? DEFAULT_TTL_MS;
    const entry: BenchSessionEntry = {
      id,
      url,
      session,
      steps: [],
      createdAt: new Date().toISOString(),
      lastUsedAt: Date.now(),
      expireTimer: setTimeout(() => void this.expire(id), ttl),
      busy: false,
    };
    entry.expireTimer.unref?.();
    this.sessions.set(id, entry);
    return { id, url };
  }

  /** 执行一条指令（同一会话内串行；步骤累积进会话供后续"存为用例"）。 */
  async instruct(id: string, input: { type: BenchInstructionType; text: string }): Promise<BenchInstructResult> {
    const entry = this.require(id);
    if (entry.busy) throw new Error("上一条指令仍在执行中");
    entry.busy = true;
    this.touch(entry);
    const events: RunEvent[] = [];
    const t0 = Date.now();
    const stepType = input.type === "query" ? "extract" : input.type;
    const step: AutomationStep = {
      id: entry.steps.length + 1,
      type: stepType,
      text: input.text,
      saveAs: stepType === "extract" ? `benchVar${entry.steps.length + 1}` : undefined,
      enabled: true,
    };
    try {
      const result = await executePlan(
        {
          steps: [step],
          manualItems: [],
          existingSession: entry.session,
          onEvent: (event) => events.push(event),
        },
        { createSession: this.deps.sessionFactory },
      );
      const screenshot = [...events].reverse().find((e) => e.kind === "screenshot");
      const stepResult = result.stepResults[0];
      const ok = result.verdict === "passed";
      // query 是探测性提取，不计入用例步骤；act/assert 累积
      if (ok && stepType !== "extract") entry.steps.push(step);
      return {
        ok,
        error: ok ? undefined : (stepResult?.error ?? result.error ?? "执行失败"),
        events,
        screenshot: screenshot?.kind === "screenshot" ? screenshot.data : undefined,
        extractedValue: stepResult?.extractedValue,
        durationMs: Date.now() - t0,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        events,
        durationMs: Date.now() - t0,
      };
    } finally {
      entry.busy = false;
      this.touch(entry);
    }
  }

  /** 取会话累积步骤（"存为用例"时由路由写入仓储）。 */
  getSteps(id: string): { url: string; steps: AutomationStep[] } {
    const entry = this.require(id);
    return { url: entry.url, steps: entry.steps.map((s, i) => ({ ...s, id: i + 1 })) };
  }

  async close(id: string): Promise<boolean> {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    // 指令在途时不允许关闭：浏览器不能从执行中被抽走（评审 L16）
    if (entry.busy) throw new Error("指令执行中，不能关闭会话");
    clearTimeout(entry.expireTimer);
    this.sessions.delete(id);
    await entry.session.close().catch(() => undefined);
    return true;
  }

  private async expire(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry || entry.busy) {
      // 执行中的会话不回收，顺延一个 TTL（评审 L16：长指令超 TTL 也不能被抽走浏览器）
      entry?.expireTimer.refresh();
      return;
    }
    logger.info(`[automation] 执行台会话闲置回收: ${id}`);
    clearTimeout(entry.expireTimer);
    this.sessions.delete(id);
    await entry.session.close().catch(() => undefined);
  }
}
