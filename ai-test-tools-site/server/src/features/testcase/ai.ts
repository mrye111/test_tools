import type { AiRequestConfig, JsonObject } from "./types.js";
import { firstText, isObject, text } from "./utils.js";
import { withSpan } from "../../middleware/trace.js";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: unknown;
};

type ChatOptions = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  responseJson?: boolean;
};

const ARK_MODEL_PREFIXES = ["doubao-", "glm-", "ark-"];

export function isArkModel(model: string): boolean {
  const lower = model.toLowerCase();
  return ARK_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function normalizeOpenAiChatUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function defaultBaseUrl(model: string): string {
  if (isArkModel(model)) return "https://ark.cn-beijing.volces.com/api/v3";
  if (model === "mimo-v2-flash") return "https://api.xiaomimimo.com/v1";
  if (model.toLowerCase().includes("qwen")) return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  return "https://api.deepseek.com/v1";
}

function shouldRequireApiKey(config: AiRequestConfig): boolean {
  if (config.isLocalModel) return false;
  try {
    const host = new URL(config.baseUrl).hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return true;
  }
}

export function parseAiRequestConfig(body: JsonObject): AiRequestConfig {
  const nested = isObject(body.ai_config)
    ? body.ai_config
    : isObject(body.aiConfig)
      ? body.aiConfig
      : {};
  const config = Object.keys(nested).length ? nested : body;
  const model = firstText(config, ["model", "model_id", "modelId", "id", "selectedModel"]) || "deepseek-chat";
  const baseUrl = firstText(config, ["base_url", "baseUrl", "baseurl", "apiUrl", "api_url", "url", "localUrl"]) || defaultBaseUrl(model);
  const apiKey = firstText(config, ["api_key", "apiKey", "key"]);
  const isLocalModel = Boolean(config.isLocalModel ?? body.isLocalModel);
  const normalizedBase = baseUrl.replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
  const result = { baseUrl: normalizedBase, apiKey, model, isLocalModel };

  if (!/^https?:\/\//i.test(result.baseUrl)) {
    throw new Error("ai_config.base_url must start with http:// or https://.");
  }
  if (shouldRequireApiKey(result) && !result.apiKey) {
    throw new Error("ai_config.api_key is required.");
  }
  return result;
}

function sanitizeError(textValue: string, config: AiRequestConfig): string {
  return textValue.split(config.apiKey).join("[redacted]").slice(0, 500);
}

function applyPayloadOverrides(payload: JsonObject, config: AiRequestConfig): JsonObject {
  const model = config.model;
  const apiUrl = normalizeOpenAiChatUrl(config.baseUrl);
  if (model === "mimo-v2-flash") {
    delete payload.max_tokens;
    payload.max_completion_tokens = payload.max_completion_tokens ?? 4096;
    payload.top_p = payload.top_p ?? 0.95;
    payload.extra_body = { thinking: { type: "disabled" } };
  }
  if (config.isLocalModel || /localhost|127\.0\.0\.1|ollama/i.test(apiUrl)) {
    delete payload.response_format;
  }
  return payload;
}

function buildHeaders(config: AiRequestConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function streamJsonTextFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const jsonText = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!jsonText || jsonText === "[DONE]" || !jsonText.startsWith("{")) return null;

  const event = JSON.parse(jsonText) as JsonObject;
  const choices = Array.isArray(event.choices) ? event.choices : [];
  const first = choices[0] as JsonObject | undefined;
  const delta = first && isObject(first.delta) ? first.delta : {};
  const message = first && isObject(first.message) ? first.message : isObject(event.message) ? event.message : {};
  return text(
    delta.content ??
      delta.reasoning_content ??
      message.content ??
      message.text ??
      first?.text ??
      event.response ??
      event.content,
  );
}

export async function testAiConnection(config: AiRequestConfig): Promise<void> {
  await callChatCompletion(config, {
    messages: [{ role: "user", content: "Hi" }],
    maxTokens: 5,
    temperature: 0,
  });
}

export async function callChatCompletion(config: AiRequestConfig, options: ChatOptions): Promise<string> {
  return withSpan({ name: "ai.chat-completion", type: "ai", attributes: { model: config.model, stream: false } }, async () => {
    const endpoint = normalizeOpenAiChatUrl(config.baseUrl);
    const payload: JsonObject = applyPayloadOverrides({
      model: config.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
      stream: false,
      ...(options.responseJson ? { response_format: { type: "json_object" } } : {}),
    }, config);

    const doRequest = async (body: JsonObject) => fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    });

    let response = await doRequest(payload);
    let raw = await response.text();
    if (!response.ok && /response_format|json_object|unsupported/i.test(raw)) {
      const retryPayload = { ...payload };
      delete retryPayload.response_format;
      response = await doRequest(retryPayload);
      raw = await response.text();
    }
    if (!response.ok) {
      throw new Error(`AI request failed: HTTP ${response.status} ${sanitizeError(raw, config)}`);
    }

    const data = JSON.parse(raw) as JsonObject;
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = choices[0] as JsonObject | undefined;
    const message = first && isObject(first.message) ? first.message : {};
    const usage = isObject(data.usage) ? data.usage : {};
    return { text: text(message.content ?? message.text ?? first?.text).trim(), usage };
  }).then(({ text: result }) => result);
}

export async function* streamChatCompletion(config: AiRequestConfig, options: ChatOptions): AsyncGenerator<string> {
  const { createSpan, finishSpan } = await import("../../logger.js");
  const { getTraceContext } = await import("../../middleware/trace.js");
  const ctx = getTraceContext();
  const span = ctx ? createSpan(ctx.traceId, ctx.currentSpanId, { name: "ai.stream-completion", type: "ai", attributes: { model: config.model, stream: true } }) : null;

  try {
    const endpoint = normalizeOpenAiChatUrl(config.baseUrl);
    const payload: JsonObject = applyPayloadOverrides({
      model: config.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    }, config);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`AI request failed: HTTP ${response.status} ${sanitizeError(await response.text(), config)}`);
    }
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const chunk = streamJsonTextFromLine(line) ?? "";
          if (chunk) {
            chunkCount++;
            yield chunk.replace(/```csv|```/g, "");
          }
        } catch {
          // 忽略非标准流行，保持长生成不中断。
        }
      }
    }
    const finalBuffer = `${buffer}${decoder.decode()}`.trim();
    if (finalBuffer) {
      try {
        const chunk = streamJsonTextFromLine(finalBuffer) ?? "";
        if (chunk) yield chunk.replace(/```csv|```/g, "");
      } catch {
        // 最后一段无法解析时忽略，前面的有效片段已经返回。
      }
    }
    if (span) {
      span.attributes.chunks = chunkCount;
      finishSpan(span, "ok");
    }
  } catch (error) {
    if (span) finishSpan(span, "error", error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
