import { callChatCompletion, EmptyAiResponseError } from "../testcase/ai.js";
import { resolveGenerationMaxTokens } from "../testcase/model-capabilities.js";
import type { AiRequestConfig, JsonObject } from "../testcase/types.js";
import { isObject, parseMaybeJsonObject, text } from "../testcase/utils.js";
import { logger } from "../../logger.js";
import { buildAnalysisMessages } from "./prompts.js";
import type { Finding, FindingType, RequirementNode } from "./types.js";

export class AnalysisParseError extends Error {
  constructor(message = "AI 分析结果无法解析为结构化 JSON，请重试。") {
    super(message);
    this.name = "AnalysisParseError";
  }
}

const FINDING_TYPE_ALIASES: Record<string, FindingType> = {
  risk: "risk",
  风险: "risk",
  风险点: "risk",
  ambiguity: "ambiguity",
  歧义: "ambiguity",
  歧义点: "ambiguity",
  clarification: "clarification",
  question: "clarification",
  待澄清: "clarification",
  待澄清问题: "clarification",
  澄清: "clarification",
};

function normalizeFindingType(value: unknown): FindingType {
  const key = text(value).trim().toLowerCase();
  return FINDING_TYPE_ALIASES[key] ?? "clarification";
}

/** 为整棵树补齐唯一 id，返回（可能被复制的）规范化树与按标题索引的节点表。 */
function normalizeTree(raw: unknown, fallbackTitle: string): { root: RequirementNode; byId: Map<string, RequirementNode> } {
  const byId = new Map<string, RequirementNode>();
  let counter = 0;
  const nextId = () => `n${++counter}`;

  const walk = (value: unknown, depth: number): RequirementNode => {
    const source = isObject(value) ? value : {};
    const id = text(source.id).trim() || nextId();
    const title = text(source.title ?? source.name ?? source.label).trim() || (depth === 0 ? fallbackTitle : "未命名节点");
    const rawChildren = Array.isArray(source.children) ? source.children : [];
    const node: RequirementNode = { id, title, children: [] };
    byId.set(id, node);
    node.children = rawChildren.map((child) => walk(child, depth + 1));
    return node;
  };

  const rootSource = isObject(raw) && (isObject(raw.tree) || Array.isArray(raw.children) || raw.title)
    ? (isObject(raw.tree) ? raw.tree : raw)
    : raw;
  const root = walk(rootSource, 0);
  if (!root.title.trim() || root.title === "未命名节点") root.title = fallbackTitle;
  return { root, byId };
}

function normalizeFindings(raw: unknown, byId: Map<string, RequirementNode>, rootId: string): Finding[] {
  const items = Array.isArray(raw) ? raw : [];
  const titleIndex = new Map<string, string>();
  for (const node of byId.values()) titleIndex.set(node.title, node.id);

  const findings: Finding[] = [];
  let counter = 0;
  for (const item of items) {
    if (!isObject(item)) continue;
    const title = text(item.title ?? item.name ?? item.summary).trim();
    const detail = text(item.detail ?? item.description ?? item.content).trim();
    if (!title && !detail) continue;
    const rawNodeRef = text(item.nodeId ?? item.node ?? item.nodeTitle ?? item.path).trim();
    const nodeId = (rawNodeRef && byId.has(rawNodeRef) && rawNodeRef)
      || titleIndex.get(rawNodeRef)
      || rootId;
    findings.push({
      id: text(item.id).trim() || `f${++counter}`,
      type: normalizeFindingType(item.type ?? item.category),
      title: title || detail.slice(0, 30),
      detail: detail || title,
      nodeId,
    });
  }
  return findings;
}

/**
 * 调用统一供应商完成需求分析（非流式），返回规范化的分解树与分析结论。
 * SSE 只用于阶段推进，最终结果一次性在这里拿到。
 * 模型输出无法解析为 JSON 时，携带上一次输出发起一次修复重试；
 * 两次都失败则记录原始输出预览并抛 AnalysisParseError。
 */
export async function analyzeRequirementText(
  config: AiRequestConfig,
  requirementText: string,
): Promise<{ title: string; tree: RequirementNode; findings: Finding[] }> {
  const messages = buildAnalysisMessages(requirementText);
  const maxTokens = resolveGenerationMaxTokens(config);
  const first = await requestAnalysis(config, messages, maxTokens);

  const parsed = parseMaybeJsonObject(first);
  if (parsed) return toAnalysisResult(parsed);

  logger.warn({ preview: first.slice(0, 300) }, "需求分析 AI 输出无法解析为 JSON，发起一次修复重试");
  const repaired = await callChatCompletion(config, {
    messages: [
      ...messages,
      { role: "assistant", content: first },
      { role: "user", content: REPAIR_INSTRUCTION },
    ],
    temperature: 0.1,
    maxTokens,
    responseJson: true,
  });

  const reparsed = parseMaybeJsonObject(repaired);
  if (!reparsed) {
    logger.warn({ preview: repaired.slice(0, 300) }, "需求分析修复重试后仍无法解析为 JSON");
    throw new AnalysisParseError();
  }
  return toAnalysisResult(reparsed);
}

/** 首次分析调用：推理型模型空正文（额度被思考耗尽）时提高输出预算重试一次。 */
async function requestAnalysis(
  config: AiRequestConfig,
  messages: ReturnType<typeof buildAnalysisMessages>,
  maxTokens: number,
): Promise<string> {
  try {
    return await callChatCompletion(config, { messages, temperature: 0.2, maxTokens, responseJson: true });
  } catch (error) {
    if (!(error instanceof EmptyAiResponseError)) throw error;
    logger.warn({ maxTokens }, "需求分析 AI 返回空正文，提高输出预算重试一次");
    return callChatCompletion(config, {
      messages: [...messages, { role: "user", content: DIRECT_ANSWER_INSTRUCTION }],
      temperature: 0.1,
      maxTokens: Math.min(Math.max(maxTokens * 2, 16_384), 131_072),
      responseJson: true,
    });
  }
}

const DIRECT_ANSWER_INSTRUCTION = "请跳过思考过程，直接输出最终答案：一个完整闭合的 JSON 对象（需求分解树与分析结论），不要任何解释文字或代码块标记。";

const REPAIR_INSTRUCTION = "你上一次的输出无法解析为 JSON。请仅输出修正后的完整 JSON 对象：不要任何解释文字、Markdown 代码块标记或思考过程；如果内容过长被截断，请精简 detail 文本并合并过细的分支，确保 JSON 完整闭合。";

function toAnalysisResult(parsed: JsonObject): { title: string; tree: RequirementNode; findings: Finding[] } {
  const fallbackTitle = text(parsed.title ?? parsed.name).trim() || "需求分析";
  const { root, byId } = normalizeTree(parsed.tree ?? parsed, fallbackTitle);
  const title = text(parsed.title).trim() || root.title;
  const findings = normalizeFindings(parsed.findings ?? parsed.risks, byId, root.id);
  return { title, tree: root, findings };
}
