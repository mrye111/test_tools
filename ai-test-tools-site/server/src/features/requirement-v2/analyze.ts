/** 需求分析 v2 AI 管线：分析 → 校验 → 修复重试 → 落库（完成才落库） */

import { randomUUID } from "crypto";
import { streamChatCompletionParts } from "../testcase/ai.js";
import type { AiRequestConfig } from "../testcase/types.js";
import { isObject, parseMaybeJsonObject } from "../testcase/utils.js";
import { logger } from "../../logger.js";
import { ANALYSIS_LIMITS, ANALYSIS_REPAIR_INSTRUCTION, buildAnalysisMessages } from "./prompts.js";
import type {
  AnalysisRecordDetail,
  AnalysisRepository,
  ConditionKind,
  CreateAnalysisInput,
  IssueSeverity,
  IssueType,
} from "./types.js";

export class AnalysisGenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisGenerateError";
  }
}

export type AnalysisEvent =
  | { type: "progress"; stage: "analyze" | "validate" | "save"; message: string }
  | { type: "done"; record: AnalysisRecordDetail }
  | { type: "error"; message: string };

export interface AnalyzeInput {
  sourceText: string;
  titleHint?: string;
  sourceFileName?: string | null;
}

const ISSUE_TYPES: IssueType[] = ["ambiguity", "missing", "conflict", "untestable"];
const SEVERITIES: IssueSeverity[] = ["high", "medium", "low"];
const CONDITION_KINDS: ConditionKind[] = ["normal", "boundary", "exception"];

interface ValidatedAnalysis {
  title: string;
  requirements: CreateAnalysisInput["requirements"];
  issues: CreateAnalysisInput["issues"];
  criteria: CreateAnalysisInput["criteria"];
  conditions: CreateAnalysisInput["conditions"];
}

/** 规范化文本用于 quote 溯源比对：去空白与中文引号包裹 */
function normalizeForTrace(text: string): string {
  return text.replace(/\s+/g, "").replace(/^[「『"'"']+|[」』"'"']+$/g, "");
}

/** 校验 AI 分析输出（纯函数）：结构、枚举、引用完整性、quote 原文溯源 */
export function validateAnalysis(raw: unknown, sourceText: string): { analysis?: ValidatedAnalysis; errors?: string[] } {
  if (!isObject(raw)) return { errors: ["输出不是 JSON 对象"] };
  const errors: string[] = [];

  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 200) : "需求分析";

  // 需求条目
  const reqRaw = Array.isArray(raw.requirements) ? raw.requirements : [];
  if (reqRaw.length === 0) errors.push("requirements 为空");
  if (reqRaw.length > ANALYSIS_LIMITS.MAX_REQUIREMENTS) errors.push(`需求条目超过 ${ANALYSIS_LIMITS.MAX_REQUIREMENTS} 条上限`);
  const requirements: ValidatedAnalysis["requirements"] = [];
  const reqIds = new Set<string>();
  reqRaw.forEach((item, index) => {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.text !== "string" || !item.text.trim()) {
      errors.push(`第 ${index + 1} 个需求条目缺少 id/text`);
      return;
    }
    if (reqIds.has(item.id)) {
      errors.push(`需求条目 id 重复: ${item.id}`);
      return;
    }
    reqIds.add(item.id);
    requirements.push({
      id: item.id,
      parentId: typeof item.parentId === "string" ? item.parentId : null,
      level: typeof item.level === "number" ? item.level : 0,
      text: item.text.trim(),
      sort: index,
    });
  });

  // 问题日志
  const issueRaw = Array.isArray(raw.issues) ? raw.issues : [];
  if (issueRaw.length > ANALYSIS_LIMITS.MAX_ISSUES) errors.push(`问题条目超过 ${ANALYSIS_LIMITS.MAX_ISSUES} 条上限`);
  const issues: ValidatedAnalysis["issues"] = [];
  issueRaw.forEach((item, index) => {
    if (!isObject(item)) {
      errors.push(`第 ${index + 1} 个问题不是对象`);
      return;
    }
    if (!ISSUE_TYPES.includes(item.type as IssueType)) {
      errors.push(`第 ${index + 1} 个问题 type 非法: ${String(item.type)}`);
      return;
    }
    if (!SEVERITIES.includes(item.severity as IssueSeverity)) {
      errors.push(`第 ${index + 1} 个问题 severity 非法: ${String(item.severity)}`);
      return;
    }
    if (typeof item.quote !== "string" || !item.quote.trim()) {
      errors.push(`第 ${index + 1} 个问题缺少 quote`);
      return;
    }
    if (typeof item.description !== "string" || !item.description.trim()) {
      errors.push(`第 ${index + 1} 个问题缺少 description`);
      return;
    }
    const reqId = typeof item.reqId === "string" ? item.reqId : null;
    if (reqId !== null && !reqIds.has(reqId)) {
      errors.push(`第 ${index + 1} 个问题引用了不存在的需求条目: ${reqId}`);
      return;
    }
    // 数据诚实：quote 必须能溯源到原文（空白/引号归一后包含）
    if (!normalizeForTrace(sourceText).includes(normalizeForTrace(item.quote))) {
      errors.push(`第 ${index + 1} 个问题的 quote 无法在需求原文中找到（疑似编造）`);
      return;
    }
    issues.push({
      id: randomUUID(),
      reqId,
      type: item.type as IssueType,
      severity: item.severity as IssueSeverity,
      quote: item.quote.trim(),
      description: item.description.trim(),
      suggestedQuestion: typeof item.suggestedQuestion === "string" ? item.suggestedQuestion.trim() : "",
      status: "open",
    });
  });

  // 验收准则
  const criteriaRaw = Array.isArray(raw.criteria) ? raw.criteria : [];
  if (criteriaRaw.length > ANALYSIS_LIMITS.MAX_CRITERIA) errors.push(`准则条目超过 ${ANALYSIS_LIMITS.MAX_CRITERIA} 条上限`);
  const criteria: ValidatedAnalysis["criteria"] = [];
  criteriaRaw.forEach((item, index) => {
    if (!isObject(item) || typeof item.reqId !== "string" || !reqIds.has(item.reqId)) {
      errors.push(`第 ${index + 1} 条准则的 reqId 无效`);
      return;
    }
    if (typeof item.originalText !== "string" || !item.originalText.trim() || typeof item.rewrittenText !== "string" || !item.rewrittenText.trim()) {
      errors.push(`第 ${index + 1} 条准则缺少 originalText/rewrittenText`);
      return;
    }
    criteria.push({
      id: randomUUID(),
      reqId: item.reqId,
      originalText: item.originalText.trim(),
      rewrittenText: item.rewrittenText.trim(),
      status: "pending",
    });
  });

  // 测试条件
  const condRaw = Array.isArray(raw.conditions) ? raw.conditions : [];
  if (condRaw.length > ANALYSIS_LIMITS.MAX_CONDITIONS) errors.push(`测试条件超过 ${ANALYSIS_LIMITS.MAX_CONDITIONS} 条上限`);
  const conditions: ValidatedAnalysis["conditions"] = [];
  condRaw.forEach((item, index) => {
    if (!isObject(item) || typeof item.text !== "string" || !item.text.trim()) {
      errors.push(`第 ${index + 1} 个条件缺少 text`);
      return;
    }
    if (!CONDITION_KINDS.includes(item.kind as ConditionKind)) {
      errors.push(`第 ${index + 1} 个条件 kind 非法: ${String(item.kind)}`);
      return;
    }
    const reqId = typeof item.reqId === "string" ? item.reqId : null;
    if (reqId !== null && !reqIds.has(reqId)) {
      errors.push(`第 ${index + 1} 个条件引用了不存在的需求条目: ${reqId}`);
      return;
    }
    conditions.push({
      id: randomUUID(),
      reqId,
      criterionId: null,
      text: item.text.trim(),
      kind: item.kind as ConditionKind,
      relay: "none",
      testsetId: null,
    });
  });

  if (errors.length > 0) return { errors };
  return { analysis: { title, requirements, issues, criteria, conditions } };
}

type StreamOptions = Parameters<typeof streamChatCompletionParts>[1];

/** 消费一次流式调用，仅累积 content 片段。 */
async function collectStream(config: AiRequestConfig, options: StreamOptions): Promise<string> {
  let content = "";
  for await (const part of streamChatCompletionParts(config, options)) {
    if (part.type === "content") content += part.text;
  }
  return content;
}

/**
 * AI 需求分析管线：一次调用产出结构化分析，校验失败修复重试一次，完成才落库。
 */
export async function analyzeRequirement(
  config: AiRequestConfig,
  repo: AnalysisRepository,
  input: AnalyzeInput,
  onEvent: (event: AnalysisEvent) => void = () => {},
): Promise<AnalysisRecordDetail> {
  onEvent({ type: "progress", stage: "analyze", message: "正在分析需求文本…" });

  const messages = buildAnalysisMessages(input.sourceText);
  const first = await collectStream(config, { messages, temperature: 0.2, maxTokens: 16384, responseJson: true });
  let validated = validateAnalysis(parseMaybeJsonObject(first), input.sourceText);

  if (!validated.analysis) {
    logger.warn({ errors: validated.errors }, "分析输出不合格，发起一次修复重试");
    onEvent({ type: "progress", stage: "validate", message: "分析结果校验未通过，正在修复…" });
    const repaired = await collectStream(config, {
      messages: [...messages, { role: "assistant", content: first }, { role: "user", content: ANALYSIS_REPAIR_INSTRUCTION }],
      temperature: 0.1,
      maxTokens: 16384,
      responseJson: true,
    });
    validated = validateAnalysis(parseMaybeJsonObject(repaired), input.sourceText);
    if (!validated.analysis) {
      throw new AnalysisGenerateError(`AI 分析输出不合格：${validated.errors?.[0] ?? "未知错误"}${validated.errors && validated.errors.length > 1 ? ` 等 ${validated.errors.length} 项` : ""}`);
    }
  }

  onEvent({ type: "progress", stage: "save", message: "校验通过，正在保存分析记录…" });
  const record = await repo.createRecord({
    title: input.titleHint?.trim() || validated.analysis.title,
    sourceFileName: input.sourceFileName ?? null,
    sourceText: input.sourceText,
    requirements: validated.analysis.requirements,
    issues: validated.analysis.issues,
    criteria: validated.analysis.criteria,
    conditions: validated.analysis.conditions,
  });
  onEvent({ type: "done", record });
  return record;
}
