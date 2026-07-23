import { resolve } from "node:path";
import type { McpTool } from "./jmeterBackend.js";
import type { ToolResult } from "./tool-result.js";
import { withSpan } from "./middleware/trace.js";
import { callChatCompletion, parseAiRequestConfig } from "./features/testcase/ai.js";
import { assertGeneratedOutputPath, runPlanBuild } from "./plan-builder.js";

type JsonObject = Record<string, unknown>;

export type SseSession = {
  id: string;
  response: { write: (chunk: string) => void };
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

export type AiGenerationStreamEvent =
  | { type: "status"; stepId: string; phase: "start" | "done"; title: string; content: string }
  | { type: "tool"; stepId: string; phase: "start" | "done"; title: string; content: string; toolName: string; arguments: JsonObject }
  | { type: "done"; title: string; content: string; result: JsonObject }
  | { type: "error"; title: string; content: string; stepId?: string };

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

/** SSE 步骤文案：服务端收尾（validate/save/tree）步骤的展示文本。 */
const FINALIZE_STEP_CONTENT: Record<string, string> = {
  validate_test_plan: "正在校验测试计划。",
  save_test_plan: "正在保存测试计划。",
  list_test_plan_tree: "正在读取测试计划树。",
};

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
    mode: "client_supplied_universal_provider",
    serverStoresConfig: false,
    message: "AI 配置由前端随请求传入，支持统一供应商结构，后端不持久化密钥。",
    required: ["ai_config.base_url", "ai_config.api_key", "ai_config.model"],
    acceptedShapes: [
      "ai_config = { provider, endpointType, baseUrl, apiKey, model }",
      "ai_config = { codex?, claude?, gemini? }",
    ],
  };
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
  // 路径守卫与模板构建共用同一实现（server/src/plan-builder.ts）。
  return assertGeneratedOutputPath(generatedRoot, normalized);
}

export interface AiRuntimeView {
  tools: Map<string, McpTool>;
  callTool(name: string, args?: JsonObject): ToolResult;
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

function emitAiEvent(
  emit: ((event: AiGenerationStreamEvent) => void) | undefined,
  event: AiGenerationStreamEvent,
): void {
  emit?.(event);
}

function waitForFrame(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function generateJmeterWithAi(
  runtime: AiRuntimeView,
  body: JsonObject,
  generatedRoot: string,
  emit?: (event: AiGenerationStreamEvent) => void,
): Promise<JsonObject> {
  return withSpan({ name: "ai.generate-jmeter", type: "ai", attributes: { prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 200) : "" } }, async () => {
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) throw new Error("prompt is required.");

    let stepIndex = 0;
    let currentStepId: string | undefined;

    const nextStepId = () => `step-${++stepIndex}`;

    const startStatusStep = (title: string, content: string) => {
      const stepId = nextStepId();
      currentStepId = stepId;
      emitAiEvent(emit, { type: "status", stepId, phase: "start", title, content });
      return stepId;
    };

    const finishStatusStep = (stepId: string, title: string, content: string) => {
      emitAiEvent(emit, { type: "status", stepId, phase: "done", title, content });
      currentStepId = undefined;
    };

    const startToolStep = (toolName: string, title: string, argumentsValue: JsonObject, content: string) => {
      const stepId = nextStepId();
      currentStepId = stepId;
      emitAiEvent(emit, { type: "tool", stepId, phase: "start", title, content, toolName, arguments: argumentsValue });
      return stepId;
    };

    const finishToolStep = (stepId: string, toolName: string, title: string, argumentsValue: JsonObject, content: string) => {
      emitAiEvent(emit, { type: "tool", stepId, phase: "done", title, content, toolName, arguments: argumentsValue });
      currentStepId = undefined;
    };

    try {
      const submitStepId = startStatusStep("提交生成请求", "正在创建 AI 生成任务。");
      await waitForFrame(80);
      const config = parseAiRequestConfig(body);
      const maxTokens = Number.isFinite(Number(body.max_tokens)) ? Number(body.max_tokens) : 6000;
      finishStatusStep(submitStepId, "提交生成请求", "模型配置与自然语言需求已提交。");

      const planningStepId = startStatusStep("规划测试步骤", "AI 正在分析需求并规划测试计划结构。");
      await waitForFrame(140);
      const raw = await withSpan({ name: "ai.call-chat", type: "ai", attributes: { model: config.model, provider: config.provider } }, () =>
        callChatCompletion(config, {
          messages: [
            { role: "system", content: buildAiSystemPrompt(runtime) },
            { role: "user", content: prompt },
          ],
          maxTokens,
          responseJson: true,
        }),
      );
      const plan = normalizeAiGeneratedPlan(raw, prompt);
      finishStatusStep(planningStepId, "规划测试步骤", `规划完成，准备执行 ${plan.toolCalls.length} 个步骤。`);

      const outputPath = resolveGeneratedJmxPath(generatedRoot, typeof body.output_path === "string" ? body.output_path : null, plan.planName);
      // 执行 + 收尾（validate → save → tree）统一收口到 PlanBuilder：
      // 每次生成使用全新的 TestPlanService，denylist 逐步校验，SSE 事件经 onStep 透传，事件词表不变。
      const calls: Array<{ name: string; arguments: JsonObject; result: string }> = [];
      let openToolStepId: string | undefined;
      const built = await withSpan({ name: "tool.execute-plan", type: "tool", attributes: { toolCount: plan.toolCalls.length } }, () =>
        runPlanBuild(
          {
            planName: plan.planName,
            steps: plan.toolCalls.map((call) => ({ tool: call.name, args: call.arguments })),
            savePath: outputPath,
          },
          {
            generatedRoot,
            tools: runtime.tools,
            denylist: AI_CONSTRUCTION_TOOL_DENYLIST,
            onStep: async (event) => {
              if (event.phase === "start") {
                const content = event.finalize ? FINALIZE_STEP_CONTENT[event.tool] ?? "正在执行当前步骤。" : "正在执行当前步骤。";
                openToolStepId = startToolStep(event.tool, event.tool, event.args, content);
                await waitForFrame(event.finalize ? 160 : 180);
                return;
              }
              const stepId = openToolStepId ?? nextStepId();
              openToolStepId = undefined;
              const text = event.text ?? "";
              finishToolStep(stepId, event.tool, event.tool, event.args, text);
              if (!event.finalize) calls.push({ name: event.tool, arguments: event.args, result: text });
            },
          },
        ),
      );

      const response = {
        ok: true,
        provider: config.provider,
        model: config.model,
        summary: plan.summary,
        notes: plan.notes,
        planName: plan.planName,
        outputPath: built.path,
        downloadUrl: `/files?path=${encodeURIComponent(built.path)}`,
        toolCalls: calls,
        validation: built.validation,
        saveResult: built.saveMessage,
        tree: built.tree,
      };

      emitAiEvent(emit, {
        type: "done",
        title: "生成完成",
        content: outputPath,
        result: response,
      });

      return response;
    } catch (error) {
      if (emit) {
        emitAiEvent(emit, {
          type: "error",
          title: "生成失败",
          content: error instanceof Error ? error.message : String(error),
          stepId: currentStepId,
        });
      }
      const taggedError = error instanceof Error ? error as Error & { __streamEventEmitted?: boolean } : new Error(String(error)) as Error & { __streamEventEmitted?: boolean };
      taggedError.__streamEventEmitted = true;
      throw taggedError;
    }
  });
}
