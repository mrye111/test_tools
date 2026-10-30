/** 规划提案校验（P3）：LLM 输出的确定性清洗（compiler.ts 同款风格）+ accept 时的占位步骤直映。 */

import type { AutomationStep, PlanProposalPriority } from "./types.js";

export type ProposalDraft = {
  useCase: string;
  title: string;
  goal: string;
  expected: string[];
  priority: PlanProposalPriority;
  estSteps: string[];
};

export type ProposalValidation =
  | { ok: true; proposals: ProposalDraft[]; dropped: number; notes: string[] }
  | { ok: false; errors: string[] };

/** 上限（防幻觉/防刷屏的确定性封顶）。 */
export const MAX_PROPOSALS = 40;
export const MAX_EST_STEPS = 20;
export const MAX_EXPECTED = 10;

const TITLE_MAX = 200;
const GOAL_MAX = 1000;
const ITEM_MAX = 500;

const PRIORITIES: Record<string, PlanProposalPriority> = {
  high: "high",
  medium: "medium",
  low: "low",
  p0: "high",
  p1: "medium",
  p2: "low",
  高: "high",
  中: "medium",
  低: "low",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textList(value: unknown, maxItems: number, notes: string[], label: string): string[] {
  if (!Array.isArray(value)) return [];
  const out = value
    .map((item) => text(item, ITEM_MAX))
    .filter((item) => item.length > 0);
  if (out.length > maxItems) {
    notes.push(`${label} 超出 ${maxItems} 条上限，已截断`);
    return out.slice(0, maxItems);
  }
  return out;
}

/**
 * 校验并清洗提案输出。整体形状非法（非对象/无数组/空数组）判 ok:false 由调用方带错误重试；
 * 逐项非法则丢弃该项记 note（部分产出优于全丢）。
 */
export function validateProposals(raw: unknown): ProposalValidation {
  const items = Array.isArray(raw) ? raw : isObject(raw) && Array.isArray(raw.proposals) ? raw.proposals : null;
  if (items === null) {
    return { ok: false, errors: ["输出不含 proposals 数组"] };
  }
  if (items.length === 0) {
    return { ok: false, errors: ["proposals 为空"] };
  }

  const notes: string[] = [];
  const proposals: ProposalDraft[] = [];
  let dropped = 0;

  for (const [index, item] of items.entries()) {
    const seq = index + 1;
    if (!isObject(item)) {
      dropped += 1;
      notes.push(`proposals[${seq}] 不是对象，已丢弃`);
      continue;
    }
    const title = text(item.title, TITLE_MAX);
    const goal = text(item.goal, GOAL_MAX);
    const expected = textList(item.expected, MAX_EXPECTED, notes, `proposals[${seq}].expected`);
    const estSteps = textList(item.estSteps, MAX_EST_STEPS, notes, `proposals[${seq}].estSteps`);
    if (!title || !goal || expected.length === 0 || estSteps.length === 0) {
      dropped += 1;
      notes.push(`proposals[${seq}] 缺少必填项（title/goal/expected/estSteps 均不可空），已丢弃`);
      continue;
    }
    const rawPriority = typeof item.priority === "string" ? item.priority.trim().toLowerCase() : "";
    const priority = PRIORITIES[rawPriority] ?? "medium";
    if (rawPriority && !PRIORITIES[rawPriority]) {
      notes.push(`proposals[${seq}].priority 无法识别（${String(item.priority)}），按 medium 处理`);
    }
    proposals.push({
      useCase: text(item.useCase, TITLE_MAX) || "未分组",
      title,
      goal,
      expected,
      priority,
      estSteps,
    });
  }

  if (proposals.length === 0) {
    return { ok: false, errors: ["全部提案项未通过校验", ...notes] };
  }
  if (proposals.length > MAX_PROPOSALS) {
    notes.push(`提案数超出 ${MAX_PROPOSALS} 条上限，已截断`);
    return { ok: true, proposals: proposals.slice(0, MAX_PROPOSALS), dropped, notes };
  }
  return { ok: true, proposals, dropped, notes };
}

/**
 * accept 时占位步骤直映（同 compiler.ts A 模式）：预估步骤→act、预估预期→assert，按位置配对。
 * 首跑编译会用提案文本补全真实步骤；无 AI 配置时按此直跑（降级）。
 */
export function estimatePlanSteps(estSteps: string[], expected: string[]): AutomationStep[] {
  return [
    ...estSteps.map((text, i) => ({
      id: i + 1,
      type: "act" as const,
      text,
      fromStep: i + 1,
      enabled: true,
    })),
    ...expected.map((text, i) => ({
      id: estSteps.length + i + 1,
      type: "assert" as const,
      text,
      fromExpected: i + 1,
      enabled: true,
    })),
  ];
}
