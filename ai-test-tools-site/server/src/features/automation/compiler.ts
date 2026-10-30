/** 编译管线：确定性预处理 → LLM 编译 → 确定性校验（失败重试一次 → 降级直映）。 */

import { createHash } from "node:crypto";
import { normalizeCaseText, type NormalizedCaseText } from "./normalize.js";
import { buildCompileUserMessage, buildRetryUserMessage, COMPILE_SYSTEM_PROMPT } from "./prompts.js";
import { deriveExecutable, validateCompiledPlan, type SanitizedPlan } from "./plan-validation.js";
import type { CompiledPlan } from "./types.js";

export type CompileEnvInput = {
  entryUrl?: string;
  appBrief?: string;
  variables?: Record<string, string>;
};

export type CompileInput = {
  caseRef: string;
  title: string;
  precondition?: string;
  steps: string;
  expectedResult: string;
  env?: CompileEnvInput;
};

export type ChatMessage = { role: "system" | "user"; content: string };
export type ChatCaller = (messages: ChatMessage[]) => Promise<string>;

export type CompileCache = {
  getCompiledCache(caseRef: string, textHash: string): Promise<CompiledPlan | null>;
  putCompiledCache(caseRef: string, textHash: string, plan: CompiledPlan): Promise<void>;
};

export type CompileResult = {
  plan: CompiledPlan;
  /** true = 两次校验未过，降级为 A 模式直映。 */
  usedFallback: boolean;
  validationErrors: string[];
  cacheHit: boolean;
};

/** 缓存键：用例全部文本 + 环境注入的 sha256——任一变化自动重编（票据 02 风险 7）。 */
export function compileTextHash(input: CompileInput, normalized: NormalizedCaseText): string {
  const payload = [
    input.title,
    input.precondition ?? "",
    normalized.steps.join("\n"),
    normalized.expected.join("\n"),
    input.env?.entryUrl ?? "",
    input.env?.appBrief ?? "",
    JSON.stringify(Object.entries(input.env?.variables ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  ].join("\u0001");
  return createHash("sha256").update(payload).digest("hex");
}

/** 从模型输出中提取 JSON 对象：剥离 markdown 围栏，取首个 { 到末个 }。 */
export function extractJsonObject(raw: string): unknown {
  const stripped = raw.replace(/```(?:json)?/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** A 模式直映（降级路径）：步骤→act、预期→assert，按位置配对。 */
export function buildDirectPlan(input: CompileInput, normalized: NormalizedCaseText, hash: string): CompiledPlan {
  const instructions = [
    ...normalized.steps.map((text, i) => ({
      id: i + 1,
      type: "act" as const,
      text,
      fromStep: i + 1,
      enabled: true,
    })),
    ...normalized.expected.map((text, i) => ({
      id: normalized.steps.length + i + 1,
      type: "assert" as const,
      text,
      fromExpected: i + 1,
      enabled: true,
    })),
  ];
  return {
    caseRef: input.caseRef,
    executable: deriveExecutable(instructions.length, 0),
    variables: [],
    setup: input.env?.entryUrl ? [{ type: "navigate", url: input.env.entryUrl }] : [],
    instructions,
    manualItems: [],
    compileNotes: ["编译校验未通过，已降级为逐条直映（A 模式），请人工核查指令质量"],
    compileHash: hash,
    compileFailed: true,
  };
}

function toCompiledPlan(input: CompileInput, hash: string, sanitized: SanitizedPlan, notes: string[]): CompiledPlan {
  return {
    caseRef: input.caseRef,
    executable: sanitized.executable,
    variables: sanitized.variables,
    setup: sanitized.setup,
    instructions: sanitized.instructions,
    manualItems: sanitized.manualItems,
    compileNotes: [...sanitized.compileNotes, ...notes],
    compileHash: hash,
  };
}

/**
 * 编译一条功能用例。callChat 注入以便测试替身；cache 可选（生产接 AutomationRepository）。
 * 流程：归一化 → 查缓存 → LLM 编译 → 校验（失败附错误重试一次）→ 再失败降级直映。
 */
export async function compileFunctionalCase(
  input: CompileInput,
  deps: { callChat: ChatCaller; cache?: CompileCache },
): Promise<CompileResult> {
  const normalized = normalizeCaseText(input.steps ?? "", input.expectedResult ?? "");
  const hash = compileTextHash(input, normalized);

  if (deps.cache) {
    const hit = await deps.cache.getCompiledCache(input.caseRef, hash);
    if (hit) {
      return { plan: hit, usedFallback: Boolean(hit.compileFailed), validationErrors: [], cacheHit: true };
    }
  }

  const baseMessages: ChatMessage[] = [
    { role: "system", content: COMPILE_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildCompileUserMessage({
        caseRef: input.caseRef,
        title: input.title,
        precondition: input.precondition ?? "",
        steps: normalized.steps,
        expected: normalized.expected,
        entryUrl: input.env?.entryUrl,
        appBrief: input.env?.appBrief,
        variables: input.env?.variables,
      }),
    },
  ];

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages =
      attempt === 0 ? baseMessages : [...baseMessages, { role: "user" as const, content: buildRetryUserMessage(lastErrors) }];
    const raw = await deps.callChat(messages);
    const parsed = extractJsonObject(raw);
    if (parsed === null) {
      lastErrors = ["输出不是可解析的 JSON"];
      continue;
    }
    const validation = validateCompiledPlan(parsed, {
      maxStep: normalized.steps.length,
      maxExpected: normalized.expected.length,
    });
    if (validation.ok) {
      const plan = toCompiledPlan(input, hash, validation.plan, validation.notes);
      if (deps.cache) await deps.cache.putCompiledCache(input.caseRef, hash, plan);
      return { plan, usedFallback: false, validationErrors: [], cacheHit: false };
    }
    lastErrors = validation.errors;
  }

  // 降级产物不写缓存：瞬时故障（服务 5xx/输出截断）不应被钉成永久降级（评审 M4）
  const fallback = buildDirectPlan(input, normalized, hash);
  return { plan: fallback, usedFallback: true, validationErrors: lastErrors, cacheHit: false };
}
