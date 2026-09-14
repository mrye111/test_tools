/** 需求分析 v2 AI 管线（覆盖导向 #31）：
 *  阶段一：全文档一次调用 → 需求条目 + 问题日志 + 验收准则（保住跨条冲突检测）
 *  阶段二：需求条目分批 → 每批一次调用产出测试条件（每条可测需求至少 1 条件）
 *  每阶段校验失败各修复重试一次；全部完成才落库。
 */

import { randomUUID } from "crypto";
import { streamChatCompletionParts } from "../testcase/ai.js";
import type { AiRequestConfig } from "../testcase/types.js";
import { isObject, parseMaybeJsonObject } from "../testcase/utils.js";
import { logger } from "../../logger.js";
import {
  ANALYSIS_LIMITS,
  ANALYSIS_REPAIR_INSTRUCTION,
  buildAnalysisMessages,
  buildConditionsMessages,
  CONDITIONS_REPAIR_INSTRUCTION,
} from "./prompts.js";
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
  | { type: "progress"; stage: "analyze" | "conditions" | "validate" | "save"; message: string }
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

interface ValidatedPassOne {
  title: string;
  requirements: CreateAnalysisInput["requirements"];
  issues: CreateAnalysisInput["issues"];
  criteria: CreateAnalysisInput["criteria"];
}

type RequirementInput = CreateAnalysisInput["requirements"][number];

/** 规范化文本用于 quote 溯源比对：去空白与中文引号包裹 */
function normalizeForTrace(text: string): string {
  return text.replace(/\s+/g, "").replace(/^[「『"'"']+|[」』"'"']+$/g, "");
}

function isValidReqId(value: unknown, reqIds: Set<string>): value is string {
  return typeof value === "string" && reqIds.has(value);
}

/** 阶段一校验：结构、枚举、引用完整性、quote 原文溯源 */
export function validateAnalysis(raw: unknown, sourceText: string): { analysis?: ValidatedPassOne; errors?: string[] } {
  if (!isObject(raw)) return { errors: ["输出不是 JSON 对象"] };
  const errors: string[] = [];

  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 200) : "需求分析";

  const reqRaw = Array.isArray(raw.requirements) ? raw.requirements : [];
  if (reqRaw.length === 0) errors.push("requirements 为空");
  if (reqRaw.length > ANALYSIS_LIMITS.MAX_REQUIREMENTS) errors.push(`需求条目超过 ${ANALYSIS_LIMITS.MAX_REQUIREMENTS} 条上限`);
  const requirements: ValidatedPassOne["requirements"] = [];
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

  const issueRaw = Array.isArray(raw.issues) ? raw.issues : [];
  if (issueRaw.length > ANALYSIS_LIMITS.MAX_ISSUES) errors.push(`问题条目超过 ${ANALYSIS_LIMITS.MAX_ISSUES} 条上限`);
  const issues: ValidatedPassOne["issues"] = [];
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

  const criteriaRaw = Array.isArray(raw.criteria) ? raw.criteria : [];
  if (criteriaRaw.length > ANALYSIS_LIMITS.MAX_CRITERIA) errors.push(`准则条目超过 ${ANALYSIS_LIMITS.MAX_CRITERIA} 条上限`);
  const criteria: ValidatedPassOne["criteria"] = [];
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

  if (errors.length > 0) return { errors };
  return { analysis: { title, requirements, issues, criteria } };
}

/** 阶段二批次校验：结构、枚举、reqId 仅限批次内、每条目至少 1 条件（覆盖导向） */
export function validateConditionsBatch(
  raw: unknown,
  batch: Array<{ id: string; text: string }>,
): { conditions?: CreateAnalysisInput["conditions"]; errors?: string[] } {
  if (!isObject(raw)) return { errors: ["输出不是 JSON 对象"] };
  const errors: string[] = [];
  const batchIds = new Set(batch.map((r) => r.id));
  const covered = new Set<string>();

  const condRaw = Array.isArray(raw.conditions) ? raw.conditions : [];
  const conditions: CreateAnalysisInput["conditions"] = [];
  condRaw.forEach((item, index) => {
    if (!isObject(item) || typeof item.text !== "string" || !item.text.trim()) {
      errors.push(`第 ${index + 1} 个条件缺少 text`);
      return;
    }
    if (!CONDITION_KINDS.includes(item.kind as ConditionKind)) {
      errors.push(`第 ${index + 1} 个条件 kind 非法: ${String(item.kind)}`);
      return;
    }
    if (!isValidReqId(item.reqId, batchIds)) {
      errors.push(`第 ${index + 1} 个条件引用了批次外的需求条目: ${String(item.reqId)}`);
      return;
    }
    covered.add(item.reqId);
    conditions.push({
      id: randomUUID(),
      reqId: item.reqId,
      criterionId: null,
      text: item.text.trim(),
      kind: item.kind as ConditionKind,
      relay: "none",
      testsetId: null,
    });
  });

  const missing = batch.filter((r) => !covered.has(r.id));
  if (missing.length > 0) {
    errors.push(`以下条目未覆盖任何测试条件: ${missing.map((r) => r.id).join(", ")}`);
  }

  if (errors.length > 0) return { errors };
  return { conditions };
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

/** 阶段一：分析 + 修复重试一次 */
async function runPassOne(config: AiRequestConfig, sourceText: string): Promise<ValidatedPassOne> {
  const messages = buildAnalysisMessages(sourceText);
  const first = await collectStream(config, { messages, temperature: 0.2, maxTokens: 16384, responseJson: true });
  let validated = validateAnalysis(parseMaybeJsonObject(first), sourceText);
  if (validated.analysis) return validated.analysis;

  logger.warn({ errors: validated.errors }, "阶段一分析输出不合格，发起一次修复重试");
  const repaired = await collectStream(config, {
    messages: [...messages, { role: "assistant", content: first }, { role: "user", content: ANALYSIS_REPAIR_INSTRUCTION }],
    temperature: 0.1,
    maxTokens: 16384,
    responseJson: true,
  });
  validated = validateAnalysis(parseMaybeJsonObject(repaired), sourceText);
  if (!validated.analysis) {
    throw new AnalysisGenerateError(`AI 分析输出不合格：${validated.errors?.[0] ?? "未知错误"}${validated.errors && validated.errors.length > 1 ? ` 等 ${validated.errors.length} 项` : ""}`);
  }
  return validated.analysis;
}

/** 阶段二单批：条件生成 + 修复重试一次 */
async function runConditionsBatch(
  config: AiRequestConfig,
  batch: Array<{ id: string; text: string }>,
  sourceText: string,
): Promise<CreateAnalysisInput["conditions"]> {
  const messages = buildConditionsMessages(batch, sourceText);
  const first = await collectStream(config, { messages, temperature: 0.2, maxTokens: 8192, responseJson: true });
  let validated = validateConditionsBatch(parseMaybeJsonObject(first), batch);
  if (validated.conditions) return validated.conditions;

  logger.warn({ errors: validated.errors, batch: batch.map((r) => r.id) }, "条件批次输出不合格，发起一次修复重试");
  const repaired = await collectStream(config, {
    messages: [...messages, { role: "assistant", content: first }, { role: "user", content: CONDITIONS_REPAIR_INSTRUCTION }],
    temperature: 0.1,
    maxTokens: 8192,
    responseJson: true,
  });
  validated = validateConditionsBatch(parseMaybeJsonObject(repaired), batch);
  if (validated.conditions) return validated.conditions;

  // 批次两次不合格不阻断整体：丢弃该批次的坏条件，条目落入"未覆盖需求"区（显式陈述而非静默丢失）
  logger.warn({ errors: validated.errors, batch: batch.map((r) => r.id) }, "条件批次修复失败，该批次条目标记为未覆盖");
  return [];
}

/**
 * 覆盖导向需求分析管线：阶段一全局分析 → 阶段二分批条件 → 落库。
 * 未产出条件的需求条目不落条件表，由前端「未覆盖需求」区显式呈现。
 */
export async function analyzeRequirement(
  config: AiRequestConfig,
  repo: AnalysisRepository,
  input: AnalyzeInput,
  onEvent: (event: AnalysisEvent) => void = () => {},
): Promise<AnalysisRecordDetail> {
  onEvent({ type: "progress", stage: "analyze", message: "正在分析需求文本…" });
  const passOne = await runPassOne(config, input.sourceText);

  const leafReqs: Array<RequirementInput> = passOne.requirements;
  const batches: Array<Array<{ id: string; text: string }>> = [];
  for (let i = 0; i < leafReqs.length; i += ANALYSIS_LIMITS.CONDITIONS_BATCH_SIZE) {
    batches.push(leafReqs.slice(i, i + ANALYSIS_LIMITS.CONDITIONS_BATCH_SIZE).map((r) => ({ id: r.id, text: r.text })));
  }

  const allConditions: CreateAnalysisInput["conditions"] = [];
  for (const [index, batch] of batches.entries()) {
    onEvent({
      type: "progress",
      stage: "conditions",
      message: `正在生成测试条件（第 ${index + 1}/${batches.length} 批，共 ${leafReqs.length} 条需求）…`,
    });
    const conditions = await runConditionsBatch(config, batch, input.sourceText);
    allConditions.push(...conditions);
    if (allConditions.length > ANALYSIS_LIMITS.MAX_CONDITIONS) {
      logger.warn({ total: allConditions.length }, "测试条件总数超上限，超出部分裁剪");
      allConditions.length = ANALYSIS_LIMITS.MAX_CONDITIONS;
      break;
    }
  }

  onEvent({ type: "progress", stage: "save", message: "校验通过，正在保存分析记录…" });
  const record = await repo.createRecord({
    title: input.titleHint?.trim() || passOne.title,
    sourceFileName: input.sourceFileName ?? null,
    sourceText: input.sourceText,
    requirements: passOne.requirements,
    issues: passOne.issues,
    criteria: passOne.criteria,
    conditions: allConditions,
  });
  onEvent({ type: "done", record });
  return record;
}
