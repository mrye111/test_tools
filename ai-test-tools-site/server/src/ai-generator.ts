import { relative, resolve } from "node:path";
import type { McpTool } from "./jmeterBackend.js";
import { withSpan, withSpanSync } from "./middleware/trace.js";

// Local copy to avoid importing non-exported type from jmeterBackend
type JsonObject = Record<string, unknown>;

// ── Exported types ──────────────────────────────────────────────────────────

export type SseSession = {
  id: string;
  response: { write: (chunk: string) => void };
};

export type AiModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type AiToolCall = {
  name: string;
  arguments: JsonObject;
};

type AiGeneratedPlan = {
  planName: string;
  summary: string;
  notes: string[];
  toolCalls: AiToolCall[];
};

// ── Constants ───────────────────────────────────────────────────────────────

const AI_CONSTRUCTION_TOOL_DENYLIST = new Set([
  "load_test_plan",
  "save_test_plan",
  "run_test_plan",
  "update_element",
  "delete_element",
  "move_element",
  "replace_script",
  "list_test_plan_tree",
  "validate_test_plan",
]);

// ── Utility functions ───────────────────────────────────────────────────────

export function sendSseEvent(
  response: { write: (chunk: string) => void },
  event: string,
  data: string,
): void {
  response.write(`event: ${event}\n`);
  for (const line of data.split("\n")) response.write(`data: ${line}\n`);
  response.write("\n");
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function publicAiConfigStatus(): JsonObject {
  return {
    ok: true,
    mode: "client_supplied",
    serverStoresConfig: false,
    message: "AI 配置由前端随请求传入，后端不读取 ai.md、不持久化密钥。",
    required: ["ai_config.base_url", "ai_config.api_key", "ai_config.model"],
    aliases: {
      base_url: ["base_url", "baseUrl", "baseurl", "url"],
      api_key: ["api_key", "apiKey", "key"],
      model: ["model", "model_id", "modelId", "id"],
    },
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function firstText(args: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function parseAiModelConfig(body: JsonObject): AiModelConfig {
  const rawConfig = isJsonObject(body.ai_config)
    ? body.ai_config
    : isJsonObject(body.aiConfig)
      ? body.aiConfig
      : {};
  const config = Object.keys(rawConfig).length ? rawConfig : body;
  const baseUrl = firstText(config, ["base_url", "baseUrl", "baseurl", "url"]);
  const apiKey = firstText(config, ["api_key", "apiKey", "key"]);
  const model = firstText(config, ["model", "model_id", "modelId", "id"]);

  if (!baseUrl || !apiKey || !model) {
    throw new Error("ai_config.base_url, ai_config.api_key and ai_config.model are required.");
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error("ai_config.base_url must start with http:// or https://.");
  }

  return { baseUrl, apiKey, model };
}

function sanitizeAiErrorText(text: string, config: AiModelConfig): string {
  return text.split(config.apiKey).join("[redacted]").slice(0, 500);
}

function extractJsonObjectText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI response does not contain a JSON object.");
  return candidate.slice(start, end + 1);
}

function safeFilename(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || `ai-jmeter-${Date.now()}`;
}

function resolveGeneratedJmxPath(generatedRoot: string, requested: string | null | undefined, planName: string): string {
  const fallback = resolve(generatedRoot, `${safeFilename(planName)}.jmx`);
  const trimmed = requested?.trim() ?? "";
  const requestedPath = trimmed && /[\\/]/.test(trimmed) ? trimmed : trimmed ? resolve(generatedRoot, trimmed) : "";
  const outputPath = requested && requested.trim()
    ? resolve(requestedPath)
    : fallback;
  const normalized = outputPath.toLowerCase().endsWith(".jmx") ? outputPath : `${outputPath}.jmx`;
  const relativePath = relative(generatedRoot, normalized);
  const insideGeneratedDir = relativePath !== "" && !relativePath.startsWith("..") && !relativePath.includes(":");
  if (!insideGeneratedDir) {
    throw new Error("AI generated JMX can only be saved under server/generated.");
  }
  return normalized;
}

// ── Runtime-dependent helpers ────────────────────────────────────────────────

/** Minimal interface for the runtime — avoids circular dependency with JmeterMcpRuntime. */
export interface AiRuntimeView {
  tools: Map<string, McpTool>;
  callTool(name: string, args?: JsonObject): string;
}

function aiToolCatalog(runtime: AiRuntimeView): JsonObject[] {
  return [...runtime.tools.values()]
    .filter((tool) => !AI_CONSTRUCTION_TOOL_DENYLIST.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
}

function buildAiSystemPrompt(runtime: AiRuntimeView): string {
  return [
    "你是资深 JMeter 性能测试工程师。",
    "你的任务是把用户的自然语言性能测试需求转换为后端可执行的 JMeter 工具调用计划，而不是直接编写 JMX XML。",
    "必须只输出一个 JSON 对象，不要输出 Markdown，不要输出解释性正文。",
    "JSON 结构必须为：",
    "{\"plan_name\":\"string\",\"summary\":\"string\",\"notes\":[\"string\"],\"tool_calls\":[{\"name\":\"tool_name\",\"arguments\":{}}]}",
    "规则：",
    "1. tool_calls 第一项必须是 create_test_plan。",
    "2. create_test_plan 后必须至少调用一次 add_thread_group。",
    "3. 除非用户明确要求，否则不要调用保存、运行、加载、更新、删除、移动类工具。",
    "4. HTTP 场景优先使用 add_more_configs(type=http_defaults)、add_more_configs(type=http_header_manager)、add_http_request、add_assertion、add_listener。",
    "5. 性能测试默认添加 aggregate_report 和 summary_report 监听器；调试场景可以添加 view_results_tree。",
    "6. 参数必须符合工具 inputSchema；未知信息使用合理默认值，不要臆造真实密码或密钥。",
    "7. URL 拆分为 protocol/domain/path/port；domain 不要包含协议头。",
    "8. JSON 请求体放入 body_data，HTTP Header 用 headers 数组，格式为 {\"name\":\"Content-Type\",\"value\":\"application/json\"}。",
    `可用工具如下：${JSON.stringify(aiToolCatalog(runtime))}`,
  ].join("\n");
}

// ── OpenAI-compatible chat ──────────────────────────────────────────────────

async function callOpenAiCompatibleChat(
  config: AiModelConfig,
  prompt: string,
  runtime: AiRuntimeView,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const bodyBase = {
    model: config.model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: buildAiSystemPrompt(runtime) },
      { role: "user", content: prompt },
    ],
  };

  const request = async (withJsonMode: boolean): Promise<Response> =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        withJsonMode ? { ...bodyBase, response_format: { type: "json_object" } } : bodyBase,
      ),
    });

  let response = await request(true);
  let text = await response.text();
  if (!response.ok && /response_format|json_object|unsupported/i.test(text)) {
    response = await request(false);
    text = await response.text();
  }

  if (!response.ok) {
    throw new Error(`AI request failed: HTTP ${response.status} ${sanitizeAiErrorText(text, config)}`);
  }

  const data = JSON.parse(text) as JsonObject;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0] as JsonObject | undefined;
  const message = first && isJsonObject(first.message) ? first.message : {};
  const content = typeof message.content === "string" ? message.content : "";
  if (!content.trim()) throw new Error("AI response has no message content.");
  return content;
}

// ── Plan normalisation ──────────────────────────────────────────────────────

function normalizeAiToolCall(value: unknown): AiToolCall | null {
  if (!isJsonObject(value)) return null;
  const name = typeof value.name === "string" ? value.name : typeof value.tool === "string" ? value.tool : "";
  const args = isJsonObject(value.arguments) ? value.arguments : isJsonObject(value.args) ? value.args : {};
  if (!name) return null;
  return { name, arguments: args };
}

function normalizeAiGeneratedPlan(rawText: string, fallbackPrompt: string): AiGeneratedPlan {
  const parsed = JSON.parse(extractJsonObjectText(rawText)) as JsonObject;
  const planName = String(parsed.plan_name ?? parsed.planName ?? `AI JMeter Test Plan ${Date.now()}`);
  const summary = String(parsed.summary ?? "AI generated JMeter test plan.");
  const notes = Array.isArray(parsed.notes) ? parsed.notes.map((item) => String(item)) : [];
  const rawCalls = Array.isArray(parsed.tool_calls)
    ? parsed.tool_calls
    : Array.isArray(parsed.toolCalls)
      ? parsed.toolCalls
      : Array.isArray(parsed.steps)
        ? parsed.steps
        : [];

  const toolCalls = rawCalls
    .map(normalizeAiToolCall)
    .filter((item): item is AiToolCall => item !== null);

  if (!toolCalls.some((call) => call.name === "create_test_plan")) {
    toolCalls.unshift({
      name: "create_test_plan",
      arguments: {
        name: planName,
        comments: `AI generated from prompt: ${fallbackPrompt.slice(0, 200)}`,
      },
    });
  }

  const createIndex = toolCalls.findIndex((call) => call.name === "create_test_plan");
  if (createIndex > 0) {
    const [createCall] = toolCalls.splice(createIndex, 1);
    toolCalls.unshift(createCall);
  }

  if (!toolCalls.some((call) => call.name === "add_thread_group")) {
    toolCalls.splice(1, 0, {
      name: "add_thread_group",
      arguments: {
        name: "主线程组",
        num_threads: 10,
        ramp_up: 10,
        loops: 1,
      },
    });
  } else {
    const firstThreadGroupIndex = toolCalls.findIndex((call) => call.name === "add_thread_group");
    if (firstThreadGroupIndex > 1) {
      const [threadGroupCall] = toolCalls.splice(firstThreadGroupIndex, 1);
      toolCalls.splice(1, 0, threadGroupCall);
    }
  }

  if (!toolCalls.some((call) => call.name === "add_listener" || call.name === "add_extended_listener" || call.name === "add_more_listeners" || call.name === "add_backend_listener" || call.name === "add_aggregate_graph")) {
    toolCalls.push({ name: "add_listener", arguments: { type: "aggregate_report" } });
    toolCalls.push({ name: "add_listener", arguments: { type: "summary_report" } });
  }

  return { planName, summary, notes, toolCalls };
}

// ── Plan execution ──────────────────────────────────────────────────────────

function executeAiPlan(runtime: AiRuntimeView, plan: AiGeneratedPlan): Array<{ name: string; arguments: JsonObject; result: string }> {
  const results: Array<{ name: string; arguments: JsonObject; result: string }> = [];
  for (const call of plan.toolCalls) {
    if (AI_CONSTRUCTION_TOOL_DENYLIST.has(call.name)) {
      throw new Error(`AI plan contains disallowed tool: ${call.name}`);
    }
    if (!runtime.tools.has(call.name)) {
      throw new Error(`AI plan contains unknown tool: ${call.name}`);
    }
    const result = runtime.callTool(call.name, call.arguments);
    results.push({ name: call.name, arguments: call.arguments, result });
    if (result.startsWith("Error")) {
      throw new Error(`Tool ${call.name} failed: ${result}`);
    }
  }
  return results;
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function generateJmeterWithAi(
  runtime: AiRuntimeView,
  body: JsonObject,
  generatedRoot: string,
): Promise<JsonObject> {
  return withSpan({ name: "ai.generate-jmeter", type: "ai", attributes: { prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 200) : "" } }, async () => {
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) throw new Error("prompt is required.");

    const config = parseAiModelConfig(body);
    const temperature = Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.2;
    const maxTokens = Number.isFinite(Number(body.max_tokens)) ? Number(body.max_tokens) : 6000;
    const raw = await withSpan({ name: "ai.call-chat", type: "ai", attributes: { model: config.model } }, () =>
      callOpenAiCompatibleChat(config, prompt, runtime, temperature, maxTokens),
    );
    const plan = normalizeAiGeneratedPlan(raw, prompt);
    const outputPath = resolveGeneratedJmxPath(generatedRoot, typeof body.output_path === "string" ? body.output_path : null, plan.planName);
    const calls = withSpanSync({ name: "tool.execute-plan", type: "tool", attributes: { toolCount: plan.toolCalls.length } }, () =>
      executeAiPlan(runtime, plan),
    );
    const validation = runtime.callTool("validate_test_plan");
    const saveResult = runtime.callTool("save_test_plan", { path: outputPath });
    if (saveResult.startsWith("Error")) throw new Error(saveResult);
    const tree = runtime.callTool("list_test_plan_tree");

    return {
      ok: true,
      model: config.model,
      summary: plan.summary,
      notes: plan.notes,
      planName: plan.planName,
      outputPath,
      downloadUrl: `/files?path=${encodeURIComponent(outputPath)}`,
      toolCalls: calls,
      validation,
      saveResult,
      tree,
    };
  });
}
