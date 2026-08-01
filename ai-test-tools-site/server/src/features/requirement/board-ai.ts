import { streamChatCompletionParts } from "../testcase/ai.js";
import type { AiRequestConfig } from "../testcase/types.js";
import { parseMaybeJsonObject } from "../testcase/utils.js";
import { logger } from "../../logger.js";
import { buildBoardChartMessages, type BoardChartKind } from "./board-prompts.js";

export class BoardDraftParseError extends Error {
  constructor(message = "AI 白板图表草稿无法解析为结构化 JSON，请重试。") {
    super(message);
    this.name = "BoardDraftParseError";
  }
}

type StreamRequestOptions = Parameters<typeof streamChatCompletionParts>[1];

/**
 * 消费一次类型化流式调用，返回仅由 content 片段累积的正文。
 * 与 ai.ts 中 collectStream 模式一致：streamChatCompletionParts 产出 reasoning/content 片段，
 * 只累积 content 片段作为最终解析输入。
 */
async function collectStream(config: AiRequestConfig, options: StreamRequestOptions): Promise<string> {
  let content = "";
  for await (const part of streamChatCompletionParts(config, options)) {
    if (part.type === "content") content += part.text;
  }
  return content;
}

const REPAIR_INSTRUCTION = "你上一次的输出无法解析为 JSON。请仅输出修正后的完整 JSON 对象：不要任何解释文字、Markdown 代码块标记或思考过程；如果内容过长被截断，请精简文本并合并过细节点，确保 JSON 完整闭合。";

/**
 * 为白板图表生成结构化草稿。
 * 调用统一供应商流式补全，从 content 片段累积后解析 JSON；
 * 首次解析失败时携带上一次输出 + 修复指令重试一次；
 * 仍失败则记录原始输出预览并抛 BoardDraftParseError。
 */
export async function generateBoardChartDraft(
  config: AiRequestConfig,
  input: { nodeTitle: string; nodeSubtreeText: string; chartKind: BoardChartKind },
): Promise<unknown> {
  const messages = buildBoardChartMessages(input);

  const first = await collectStream(config, {
    messages,
    temperature: 0.2,
    maxTokens: 8192,
    responseJson: true,
  });

  const parsed = parseMaybeJsonObject(first);
  if (parsed) return parsed;

  logger.warn({ preview: first.slice(0, 300) }, "白板图表 AI 输出无法解析为 JSON，发起一次修复重试");

  const repaired = await collectStream(config, {
    messages: [
      ...messages,
      { role: "assistant", content: first },
      { role: "user", content: REPAIR_INSTRUCTION },
    ],
    temperature: 0.1,
    maxTokens: 8192,
    responseJson: true,
  });

  const reparsed = parseMaybeJsonObject(repaired);
  if (!reparsed) {
    logger.warn({ preview: repaired.slice(0, 300) }, "白板图表修复重试后仍无法解析为 JSON");
    throw new BoardDraftParseError();
  }
  return reparsed;
}
