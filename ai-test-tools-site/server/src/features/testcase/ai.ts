import type { AiRequestConfig, JsonObject } from "./types.js";
import { firstText, isObject, text } from "./utils.js";
import { withSpan } from "../../middleware/trace.js";
import type { Span } from "../../logger.js";

type AiApiFormat = AiRequestConfig["endpointType"];

type UniversalProviderLike = {
  id?: string;
  name?: string;
  providerType?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  apiFormat?: AiApiFormat;
  modelsUrl?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
};

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

type FetchedModel = {
  id: string;
  ownedBy: string | null;
};

const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
const FETCH_TIMEOUT_MS = 15_000;
const ERROR_BODY_MAX_CHARS = 512;
const KNOWN_COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
];

export class EmptyAiResponseError extends Error {
  constructor(message = "AI 请求成功，但模型未返回可见正文。") {
    super(message);
    this.name = "EmptyAiResponseError";
  }
}

function resolveTemperature(config: AiRequestConfig, requested: number | undefined): number | undefined {
  if (requested === undefined) return undefined;

  const model = config.model.trim().toLowerCase();
  const baseUrl = config.baseUrl.trim().toLowerCase();
  const isKimiCodingModel = baseUrl.includes("api.kimi.com/coding")
    || /^kimi-.*-code(?:$|[-.])/.test(model);

  // Kimi Coding 系列当前只接受 temperature=1，其他值会被上游以 HTTP 400 拒绝。
  return isKimiCodingModel ? 1 : requested;
}

function normalizeOpenAiCompatibleUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/responses$/i.test(trimmed)) return trimmed;
  return trimmed;
}

function normalizeOpenAiChatUrl(input: string): string {
  const trimmed = normalizeOpenAiCompatibleUrl(input);
  if (!trimmed) return "";
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function normalizeOpenAiResponsesUrl(input: string): string {
  const trimmed = normalizeOpenAiCompatibleUrl(input);
  if (!trimmed) return "";
  if (/\/responses$/i.test(trimmed)) return trimmed;
  return `${trimmed}/responses`;
}

function normalizeAnthropicMessagesUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/messages$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

function normalizeGeminiGenerateUrl(input: string, model: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/models\/[^/]+:generateContent$/i.test(trimmed)) return trimmed;
  const versionedBase = /\/v1beta$/i.test(trimmed) || /\/v1$/i.test(trimmed)
    ? trimmed
    : `${trimmed}/v1beta`;
  return `${versionedBase}/models/${encodeURIComponent(model)}:generateContent`;
}

function defaultBaseUrl(model: string): string {
  if (model.toLowerCase().includes("claude")) return "https://api.anthropic.com/v1";
  if (model.toLowerCase().includes("gemini")) return "https://generativelanguage.googleapis.com";
  return "https://api.openai.com/v1";
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

function firstNonEmptyString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function inferApiFormatFromBaseUrl(baseUrl: string): AiApiFormat {
  const normalized = baseUrl.trim().toLowerCase();
  if (!normalized) return "openai_responses";

  if (
    normalized.includes("generativelanguage.googleapis.com")
    || normalized.includes("/v1beta/models")
    || normalized.includes("/gemini/v1beta")
  ) {
    return "gemini_native";
  }

  if (
    normalized.includes("api.anthropic.com")
    || normalized.endsWith("/anthropic")
    || normalized.includes("/api/anthropic")
    || normalized.includes("/apps/anthropic")
    || normalized.endsWith("/messages")
  ) {
    return "anthropic";
  }

  if (
    normalized.endsWith("/chat/completions")
    || normalized.includes("/api/coding/v3")
    || normalized.includes("/step_plan")
    || normalized.includes("/v2/coding")
    || normalized.includes("/openai/v1")
  ) {
    return "openai_chat";
  }

  return "openai_responses";
}

function providerKindForFormat(apiFormat: AiApiFormat): AiRequestConfig["provider"] {
  if (apiFormat === "anthropic") return "claude";
  if (apiFormat === "gemini_native") return "gemini";
  return "codex";
}

function defaultModelForFormat(apiFormat: AiApiFormat) {
  if (apiFormat === "anthropic") return DEFAULT_ANTHROPIC_MODEL;
  if (apiFormat === "gemini_native") return DEFAULT_GEMINI_MODEL;
  return DEFAULT_OPENAI_MODEL;
}

function isUniversalProviderShape(config: JsonObject): config is UniversalProviderLike & JsonObject {
  return typeof config.baseUrl === "string"
    && typeof config.apiKey === "string"
    && typeof config.model === "string";
}

function buildRuntimeConfigFromUniversalProvider(
  provider: UniversalProviderLike,
): AiRequestConfig | null {
  const baseUrl = firstNonEmptyString(provider.baseUrl);
  const apiKey = typeof provider.apiKey === "string" ? provider.apiKey.trim() : "";
  const apiFormat = provider.apiFormat ?? inferApiFormatFromBaseUrl(baseUrl);
  const model = firstNonEmptyString(provider.model, defaultModelForFormat(apiFormat));
  if (!baseUrl || !model) return null;

  return {
    provider: providerKindForFormat(apiFormat),
    endpointType: apiFormat,
    baseUrl,
    apiKey,
    model,
    modelsUrl: firstNonEmptyString(provider.modelsUrl),
    isLocalModel: false,
    contextWindow: positiveInteger(provider.contextWindow),
    maxOutputTokens: positiveInteger(provider.maxOutputTokens),
  };
}

function parseBundleConfig(config: JsonObject): AiRequestConfig | null {
  const provider = firstText(config, ["provider"]).toLowerCase();
  const baseUrl = firstText(config, ["base_url", "baseUrl", "baseurl", "apiUrl", "api_url", "url", "localUrl"]);
  const apiKey = firstText(config, ["api_key", "apiKey", "key"]);
  const model = firstText(config, ["model", "model_id", "modelId", "id", "selectedModel"]);
  const endpointTypeRaw = firstText(config, ["endpoint_type", "endpointType", "apiFormat"]).toLowerCase() as AiApiFormat | "";
  const endpointType = endpointTypeRaw === "anthropic"
    || endpointTypeRaw === "openai_chat"
    || endpointTypeRaw === "openai_responses"
    || endpointTypeRaw === "gemini_native"
    ? endpointTypeRaw
    : inferApiFormatFromBaseUrl(baseUrl);
  const isLocalModel = Boolean(config.isLocalModel);
  const modelsUrl = firstText(config, ["models_url", "modelsUrl"]) || undefined;
  const contextWindow = positiveInteger(config.contextWindow ?? config.context_window);
  const maxOutputTokens = positiveInteger(config.maxOutputTokens ?? config.max_output_tokens ?? config.maxTokens ?? config.max_tokens);

  if (!baseUrl || !model) return null;

  return {
    provider: provider === "claude" || provider === "codex" || provider === "gemini"
      ? provider
      : providerKindForFormat(endpointType),
    endpointType,
    baseUrl: baseUrl.replace(/\/chat\/completions$/i, "").replace(/\/responses$/i, "").replace(/\/messages$/i, "").replace(/\/+$/, ""),
    apiKey,
    model,
    modelsUrl,
    isLocalModel,
    contextWindow,
    maxOutputTokens,
  };
}

function assertValidAiConfig(config: AiRequestConfig): AiRequestConfig {
  if (!/^https?:\/\//i.test(config.baseUrl)) {
    throw new Error("ai_config.base_url must start with http:// or https://.");
  }
  if (shouldRequireApiKey(config) && !config.apiKey) {
    throw new Error("ai_config.api_key is required.");
  }
  return config;
}

export function parseAiRequestConfig(
  body: JsonObject,
): AiRequestConfig {
  const nested = isObject(body.ai_config)
    ? body.ai_config
    : isObject(body.aiConfig)
      ? body.aiConfig
      : {};
  const config = Object.keys(nested).length ? nested : body;

  if (isObject(config)) {
    const direct = parseBundleConfig(config);
    if (direct) {
      return assertValidAiConfig(direct);
    }

    if (isUniversalProviderShape(config)) {
      const structured = buildRuntimeConfigFromUniversalProvider(config);
      if (structured) {
        return assertValidAiConfig(structured);
      }
    }
  }

  const model = firstText(config, ["model", "model_id", "modelId", "id", "selectedModel"]) || DEFAULT_OPENAI_MODEL;
  const baseUrl = firstText(config, ["base_url", "baseUrl", "baseurl", "apiUrl", "api_url", "url", "localUrl"]) || defaultBaseUrl(model);
  const endpointType = inferApiFormatFromBaseUrl(baseUrl);
  const apiKey = firstText(config, ["api_key", "apiKey", "key"]);
  const isLocalModel = Boolean(config.isLocalModel ?? body.isLocalModel);
  const normalizedBase = baseUrl.replace(/\/chat\/completions$/i, "").replace(/\/responses$/i, "").replace(/\/messages$/i, "").replace(/\/+$/, "");
  const result: AiRequestConfig = {
    baseUrl: normalizedBase,
    apiKey,
    model,
    provider: providerKindForFormat(endpointType),
    endpointType,
    modelsUrl: firstText(config, ["models_url", "modelsUrl"]) || undefined,
    isLocalModel,
    contextWindow: positiveInteger(config.contextWindow ?? config.context_window),
    maxOutputTokens: positiveInteger(config.maxOutputTokens ?? config.max_output_tokens ?? config.maxTokens ?? config.max_tokens),
  };

  return assertValidAiConfig(result);
}

function sanitizeError(textValue: string, config: AiRequestConfig): string {
  return config.apiKey ? textValue.split(config.apiKey).join("[redacted]").slice(0, 500) : textValue.slice(0, 500);
}

function buildOpenAiHeaders(config: AiRequestConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function buildAnthropicHeaders(config: AiRequestConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (config.apiKey) headers["x-api-key"] = config.apiKey;
  return headers;
}

function buildGeminiHeaders(config: AiRequestConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey.startsWith("ya29.")) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  } else if (config.apiKey) {
    headers["x-goog-api-key"] = config.apiKey;
  }
  return headers;
}

function toAnthropicMessageContent(content: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(content)) {
    const parts: Array<Record<string, unknown>> = [];
    for (const item of content) {
      if (!isObject(item)) continue;
      if (item.type === "image_url" && isObject(item.image_url) && typeof item.image_url.url === "string") {
        parts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: item.image_url.url.startsWith("data:image/png") ? "image/png" : "image/jpeg",
            data: item.image_url.url.includes(",") ? item.image_url.url.split(",")[1] : item.image_url.url,
          },
        });
        continue;
      }
      if (typeof item.text === "string") {
        parts.push({ type: "text", text: item.text });
      }
    }
    return parts;
  }
  return [{ type: "text", text: text(content) }];
}

function toAnthropicMessages(messages: ChatMessage[]) {
  const systemParts: string[] = [];
  const runtimeMessages: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(text(message.content));
      continue;
    }
    runtimeMessages.push({
      role: message.role,
      content: toAnthropicMessageContent(message.content),
    });
  }

  return {
    system: systemParts.join("\n\n").trim(),
    messages: runtimeMessages,
  };
}

function toGeminiParts(content: unknown) {
  if (Array.isArray(content)) {
    const parts: Array<Record<string, unknown>> = [];
    for (const item of content) {
      if (!isObject(item)) continue;
      if (item.type === "image_url" && isObject(item.image_url) && typeof item.image_url.url === "string") {
        const url = item.image_url.url;
        const [prefix, data] = url.split(",", 2);
        const mimeType = prefix.includes("image/png") ? "image/png" : "image/jpeg";
        parts.push({ inline_data: { mime_type: mimeType, data: data || "" } });
        continue;
      }
      if (typeof item.text === "string") {
        parts.push({ text: item.text });
      }
    }
    return parts;
  }
  return [{ text: text(content) }];
}

function toGeminiContents(messages: ChatMessage[]) {
  const systemParts: Array<Record<string, unknown>> = [];
  const contents: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(...toGeminiParts(message.content));
      continue;
    }
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: toGeminiParts(message.content),
    });
  }

  return {
    systemInstruction: systemParts.length ? { parts: systemParts } : undefined,
    contents,
  };
}

function extractAnthropicText(data: JsonObject): string {
  const content = Array.isArray(data.content) ? data.content : [];
  return content
    .filter((item): item is JsonObject => isObject(item))
    .filter((item) => item.type === "text")
    .map((item) => text(item.text))
    .join("")
    .trim();
}

function extractGeminiText(data: JsonObject): string {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const first = candidates[0];
  if (!isObject(first) || !isObject(first.content)) return "";
  const content = first.content as JsonObject;
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts
    .filter((item): item is JsonObject => isObject(item))
    .map((item) => text(item.text))
    .join("")
    .trim();
}

function extractResponsesOutputText(data: JsonObject): string {
  const outputText = typeof data.output_text === "string" ? data.output_text.trim() : "";
  if (outputText) return outputText;

  const output = Array.isArray(data.output) ? data.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!isObject(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (!isObject(block)) continue;
      if (block.type === "output_text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }

  return parts.join("").trim();
}

function streamJsonTextFromLine(line: string, endpointType: AiApiFormat): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const jsonText = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!jsonText || jsonText === "[DONE]" || !jsonText.startsWith("{")) return null;

  const event = JSON.parse(jsonText) as JsonObject;

  if (endpointType === "openai_responses") {
    const type = text(event.type);
    if (type === "response.output_text.delta") {
      return text(event.delta);
    }
    if (type === "response.completed") {
      return extractResponsesOutputText(event);
    }
  }

  const choices = Array.isArray(event.choices) ? event.choices : [];
  const first = choices[0] as JsonObject | undefined;
  const delta = first && isObject(first.delta) ? first.delta : {};
  const message = first && isObject(first.message) ? first.message : isObject(event.message) ? event.message : {};
  return text(
    delta.content ??
      message.content ??
      message.text ??
      first?.text ??
      event.response ??
      event.content,
  );
}

function toOpenAiResponsesInput(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
        : text(message.content),
  }));
}

// OpenAI 兼容端点的请求体统一在这里构建，流式与非流式只差 stream 标志，避免两处拼装漂移。
function buildOpenAiRequestPayload(
  config: AiRequestConfig,
  options: ChatOptions,
  stream: boolean,
): { endpoint: string; payload: JsonObject } {
  const temperature = resolveTemperature(config, options.temperature);
  if (config.endpointType === "openai_chat") {
    return {
      endpoint: normalizeOpenAiChatUrl(config.baseUrl),
      payload: {
        model: config.model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 4096,
        stream,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(options.responseJson ? { response_format: { type: "json_object" } } : {}),
      },
    };
  }
  // 历史行为：responses 非流式不传 max_output_tokens 缺省值，流式缺省 4096。
  const maxOutputTokens = options.maxTokens ?? (stream ? 4096 : undefined);
  return {
    endpoint: normalizeOpenAiResponsesUrl(config.baseUrl),
    payload: {
      model: config.model,
      input: toOpenAiResponsesInput(options.messages),
      stream,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      ...(options.responseJson ? { text: { format: { type: "json_object" } } } : {}),
    },
  };
}

/** 提取 OpenAI 兼容响应的正文：content 可能是字符串，也可能是分片数组。 */
function extractChatContentText(message: JsonObject, first: JsonObject | undefined): string {
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (isObject(part) ? text(part.text ?? part.content).trim() : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (joined) return joined;
  }
  return text(message.text ?? first?.text).trim();
}

async function callOpenAiCompatibleChat(config: AiRequestConfig, options: ChatOptions): Promise<string> {
  const { endpoint, payload } = buildOpenAiRequestPayload(config, options, false);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildOpenAiHeaders(config),
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`AI request failed: HTTP ${response.status} ${sanitizeError(raw, config)}`);
  }

  const data = JSON.parse(raw) as JsonObject;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0] as JsonObject | undefined;
  const message = first && isObject(first.message) ? first.message : {};
  const result = extractChatContentText(message, first);
  if (!result) {
    // 推理型模型可能把输出额度全部消耗在思考上（reasoning_content 有值、finish_reason=length）
    const truncatedByReasoning = text(first?.finish_reason).trim() === "length"
      || Boolean(text(message.reasoning_content).trim());
    if (truncatedByReasoning) {
      throw new EmptyAiResponseError("AI 请求成功，但模型未返回可见正文：输出额度可能已被思考过程耗尽，请提高最大输出 token 或更换非推理模型。");
    }
    throw new EmptyAiResponseError();
  }
  return result;
}

async function callOpenAiResponses(config: AiRequestConfig, options: ChatOptions): Promise<string> {
  const { endpoint, payload } = buildOpenAiRequestPayload(config, options, false);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildOpenAiHeaders(config),
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`AI request failed: HTTP ${response.status} ${sanitizeError(raw, config)}`);
  }

  const data = JSON.parse(raw) as JsonObject;
  const result = extractResponsesOutputText(data);
  if (!result) {
    throw new EmptyAiResponseError();
  }
  return result;
}

async function callAnthropicChat(config: AiRequestConfig, options: ChatOptions): Promise<string> {
  const endpoint = normalizeAnthropicMessagesUrl(config.baseUrl);
  const { system, messages } = toAnthropicMessages(options.messages);
  const payload: JsonObject = {
    model: config.model,
    max_tokens: options.maxTokens ?? 4096,
    messages,
  };
  if (system) payload.system = system;
  if (options.temperature !== undefined) payload.temperature = options.temperature;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildAnthropicHeaders(config),
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`AI request failed: HTTP ${response.status} ${sanitizeError(raw, config)}`);
  }

  const data = JSON.parse(raw) as JsonObject;
  const result = extractAnthropicText(data);
  if (!result) {
    throw new EmptyAiResponseError();
  }
  return result;
}

async function callGeminiChat(config: AiRequestConfig, options: ChatOptions): Promise<string> {
  const endpoint = normalizeGeminiGenerateUrl(config.baseUrl, config.model);
  const { systemInstruction, contents } = toGeminiContents(options.messages);
  const payload: JsonObject = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 4096,
      ...(options.responseJson ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (systemInstruction) payload.systemInstruction = systemInstruction;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildGeminiHeaders(config),
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`AI request failed: HTTP ${response.status} ${sanitizeError(raw, config)}`);
  }

  const data = JSON.parse(raw) as JsonObject;
  const result = extractGeminiText(data);
  if (!result) {
    throw new EmptyAiResponseError();
  }
  return result;
}

export async function testAiConnection(config: AiRequestConfig): Promise<void> {
  await callChatCompletion(config, {
    messages: [{ role: "user", content: "Hi" }],
    maxTokens: 5,
  });
}

export async function callChatCompletion(config: AiRequestConfig, options: ChatOptions): Promise<string> {
  return withSpan({ name: "ai.chat-completion", type: "ai", attributes: { model: config.model, provider: config.provider, endpointType: config.endpointType, stream: false } }, async () => {
    if (config.endpointType === "anthropic") {
      return callAnthropicChat(config, options);
    }
    if (config.endpointType === "gemini_native") {
      return callGeminiChat(config, options);
    }
    if (config.endpointType === "openai_chat") {
      return callOpenAiCompatibleChat(config, options);
    }
    return callOpenAiResponses(config, options);
  });
}

async function* streamProviderCompletion(config: AiRequestConfig, options: ChatOptions, span: Span): AsyncGenerator<string> {
  // Anthropic / Gemini 原生端点未实现流式解析：静默降级为一次性返回完整内容
  // （历史行为，调用方无感知；如需真正流式需接入各自的流式协议）。
  if (config.endpointType === "anthropic" || config.endpointType === "gemini_native") {
    const content = await callChatCompletion(config, { ...options, stream: false });
    if (content) yield content;
    return;
  }

  const { endpoint, payload } = buildOpenAiRequestPayload(config, options, true);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildOpenAiHeaders(config),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`AI request failed: HTTP ${response.status} ${sanitizeError(await response.text(), config)}`);
  }
  if (!response.body) {
    throw new EmptyAiResponseError("AI 流式请求成功，但响应体为空。");
  }

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
        const chunk = streamJsonTextFromLine(line, config.endpointType) ?? "";
        const visibleChunk = chunk.replace(/```csv|```/g, "");
        if (visibleChunk.trim()) {
          chunkCount++;
          yield visibleChunk;
        }
      } catch {
        // 忽略非标准流行，保持长生成不中断。
      }
    }
  }
  const finalBuffer = `${buffer}${decoder.decode()}`.trim();
  if (finalBuffer) {
    try {
      const chunk = streamJsonTextFromLine(finalBuffer, config.endpointType) ?? "";
      const visibleChunk = chunk.replace(/```csv|```/g, "");
      if (visibleChunk.trim()) {
        chunkCount++;
        yield visibleChunk;
      }
    } catch {
      // 最后一段无法解析时忽略，前面的有效片段已经返回。
    }
  }
  if (chunkCount === 0) {
    throw new EmptyAiResponseError("AI 流式请求结束，但模型未返回可见正文。");
  }
  span.attributes.chunks = chunkCount;
}

export async function* streamChatCompletion(config: AiRequestConfig, options: ChatOptions): AsyncGenerator<string> {
  // 通过队列把流式生产者桥接进 withSpan：span 覆盖整个流式生命周期（含降级调用），
  // 与其它 AI 调用共用同一 trace 入口；错误经队列原样抛给消费者。
  type StreamItem = { chunk: string } | { error: unknown } | { done: true };
  const queue: StreamItem[] = [];
  let wakeup: (() => void) | null = null;
  const push = (item: StreamItem) => {
    queue.push(item);
    const notify = wakeup;
    wakeup = null;
    notify?.();
  };

  const producer = withSpan(
    { name: "ai.stream-completion", type: "ai", attributes: { model: config.model, provider: config.provider, endpointType: config.endpointType, stream: true } },
    async (span) => {
      try {
        for await (const chunk of streamProviderCompletion(config, options, span)) {
          push({ chunk });
        }
        push({ done: true });
      } catch (error) {
        push({ error });
        throw error;
      }
    },
  );
  // 错误已经通过队列交给消费者，这里只需避免未处理的 rejection。
  producer.catch(() => undefined);

  while (true) {
    if (queue.length === 0) {
      await new Promise<void>((resolvePromise) => {
        wakeup = resolvePromise;
      });
      continue;
    }
    const item = queue.shift() as StreamItem;
    if ("chunk" in item) {
      yield item.chunk;
      continue;
    }
    if ("error" in item) throw item.error;
    return;
  }
}

function truncateBody(body: string) {
  if (body.length <= ERROR_BODY_MAX_CHARS) return body;
  return `${body.slice(0, ERROR_BODY_MAX_CHARS)}…`;
}

function stripCompatSuffix(baseUrl: string) {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) {
      return baseUrl.slice(0, baseUrl.length - suffix.length);
    }
  }
  return null;
}

function endsWithVersionSegment(url: string) {
  const last = url.split("/").filter(Boolean).at(-1) ?? "";
  if (!last.startsWith("v")) return false;
  const digits = last.slice(1);
  return Boolean(digits) && /^\d+$/.test(digits);
}

export function buildModelsUrlCandidates(
  baseUrl: string,
  modelsUrlOverride?: string,
) {
  const modelsUrl = modelsUrlOverride?.trim();
  if (modelsUrl) return [modelsUrl];

  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Base URL is empty");
  }

  const candidates: string[] = [];

  if (/\/models$/i.test(trimmed)) {
    candidates.push(trimmed);
  } else if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
  } else {
    candidates.push(`${trimmed}/v1/models`);
    candidates.push(`${trimmed}/models`);
  }

  const stripped = stripCompatSuffix(trimmed);
  if (stripped && stripped.includes("://")) {
    candidates.push(`${stripped}/v1/models`);
    candidates.push(`${stripped}/models`);
  }

  return candidates.filter((url, index) => candidates.indexOf(url) === index);
}

function normalizeFetchedModels(payload: unknown): FetchedModel[] {
  const items = Array.isArray(payload)
    ? payload
    : isObject(payload) && Array.isArray(payload.data)
      ? payload.data
      : isObject(payload) && Array.isArray(payload.models)
        ? payload.models
        : null;

  if (!items) {
    throw new Error("Failed to parse models response");
  }

  return items
    .map((item) => {
      if (typeof item === "string") {
        return { id: item, ownedBy: null };
      }
      if (!isObject(item)) return null;
      return {
        id: text(item.id || item.name || item.model || item.value).replace(/^models\//, ""),
        ownedBy: text(item.owned_by || item.ownedBy || item.owner) || null,
      };
    })
    .filter((item): item is FetchedModel => Boolean(item?.id))
}

async function fetchModelsCandidate(
  url: string,
  headers: Record<string, string>,
  config: AiRequestConfig,
  abortSignal: AbortSignal,
) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.any([abortSignal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
    });

    if (response.ok) {
      const payload = await response.json();
      return normalizeFetchedModels(payload)
        .sort((a, b) => a.id.localeCompare(b.id));
    }

    const body = truncateBody(await response.text());
    throw new Error(`HTTP ${response.status}: ${body}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${url}: ${sanitizeError(message, config)}`);
  }
}

async function fetchFirstSuccessfulModels(
  candidates: string[],
  headers: Record<string, string>,
  config: AiRequestConfig,
) {
  const abortController = new AbortController();
  try {
    return await Promise.any(candidates.map((url) => fetchModelsCandidate(
      url,
      headers,
      config,
      abortController.signal,
    )));
  } catch (error) {
    if (error instanceof AggregateError) {
      const messages = error.errors
        .map((item) => item instanceof Error ? item.message : String(item))
        .filter(Boolean);
      throw new Error(`All candidates failed: ${messages.join("; ") || "no candidates"}`);
    }
    throw error;
  } finally {
    abortController.abort();
  }
}

function normalizeGeminiFetchedModels(payload: unknown): FetchedModel[] {
  if (!isObject(payload) || !Array.isArray(payload.models)) {
    throw new Error("Failed to parse Gemini models response");
  }

  return payload.models
    .filter((item): item is JsonObject => isObject(item))
    .map((item) => ({
      id: text(item.name).replace(/^models\//, ""),
      ownedBy: "Google",
    }))
    .filter((item) => item.id);
}

async function fetchOpenAiCompatibleModels(config: AiRequestConfig): Promise<FetchedModel[]> {
  const candidates = buildModelsUrlCandidates(config.baseUrl, config.modelsUrl);
  return fetchFirstSuccessfulModels(candidates, buildOpenAiHeaders(config), config);
}

async function fetchAnthropicModels(config: AiRequestConfig): Promise<FetchedModel[]> {
  const candidates = buildModelsUrlCandidates(config.baseUrl, config.modelsUrl);
  return fetchFirstSuccessfulModels(candidates, buildAnthropicHeaders(config), config);
}

async function fetchGeminiNativeModels(config: AiRequestConfig): Promise<FetchedModel[]> {
  const trimmed = config.modelsUrl?.trim()
    || (config.baseUrl.trim().replace(/\/+$/, "").match(/\/v1beta$/i) || config.baseUrl.trim().replace(/\/+$/, "").match(/\/v1$/i)
      ? `${config.baseUrl.trim().replace(/\/+$/, "")}/models`
      : `${config.baseUrl.trim().replace(/\/+$/, "")}/v1beta/models`);

  const response = await fetch(trimmed, {
    method: "GET",
    headers: buildGeminiHeaders(config),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${truncateBody(raw)}`);
  }

  const payload = JSON.parse(raw) as JsonObject;
  return normalizeGeminiFetchedModels(payload)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchAvailableModels(config: AiRequestConfig): Promise<FetchedModel[]> {
  if (!config.apiKey) {
    throw new Error("API Key is required to fetch models");
  }

  if (config.endpointType === "anthropic") {
    return fetchAnthropicModels(config);
  }

  if (config.endpointType === "gemini_native") {
    return fetchGeminiNativeModels(config);
  }

  return fetchOpenAiCompatibleModels(config);
}
