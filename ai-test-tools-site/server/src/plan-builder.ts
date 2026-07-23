import { basename, relative, resolve } from "node:path";
import type { JsonObject } from "./jmx-serializer.js";
import { TestPlanService } from "./jmeterBackend.js";
import { createTools, type McpTool } from "./tool-registry.js";
import { resultText, type ToolErrorCode, type ToolResult } from "./tool-result.js";
import { withSpanSync } from "./middleware/trace.js";

// ── Public types ──

/** One construction step of a build spec: a registry tool name plus its arguments. */
export type BuildSpecStep = {
  tool: string;
  args?: JsonObject;
};

/** Template-mode build request: plan display name, filename seed, ordered steps. */
export type TemplateBuildSpec = {
  planName: string;
  seed: string;
  steps: BuildSpecStep[];
};

export type BuiltPlanStep = {
  tool: string;
  text: string;
};

export type BuiltPlan = {
  planName: string;
  /** Absolute path of the saved .jmx (always under the generated root). */
  path: string;
  /** Download filename (basename of path). */
  filename: string;
  saveMessage: string;
  validation: string;
  tree: string;
  /** Every executed step in order, including the validate/save/tree finalize tail. */
  steps: BuiltPlanStep[];
};

/** Step lifecycle notification. `finalize` marks the server-owned validate/save/tree tail. */
export type PlanBuildEvent = {
  phase: "start" | "done";
  tool: string;
  args: JsonObject;
  /** Human-readable step text (present on "done"). */
  text?: string;
  finalize: boolean;
};

export type PlanBuildOptions = {
  /** Output root for generated .jmx files. Defaults to `<cwd>/server/generated`. */
  generatedRoot?: string;
  /** Registry map to resolve steps against. Defaults to a fresh `createTools()` map. */
  tools?: Map<string, McpTool>;
  /** Tools forbidden inside spec steps (e.g. the AI construction denylist). */
  denylist?: ReadonlySet<string>;
  /** Service instance override (tests). Default: a FRESH TestPlanService per build. */
  service?: TestPlanService;
  onStep?: (event: PlanBuildEvent) => void | Promise<void>;
};

/** Typed failure of a plan build; `step` names the failing tool when applicable. */
export class PlanBuildError extends Error {
  readonly code: ToolErrorCode;
  readonly step?: string;

  constructor(code: ToolErrorCode, message: string, step?: string) {
    super(message);
    this.name = "PlanBuildError";
    this.code = code;
    this.step = step;
  }
}

// ── Generated output paths (single home for filename sanitization + the path guard) ──

export function defaultGeneratedRoot(): string {
  return resolve(process.cwd(), "server", "generated");
}

function nowStamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Filename seed sanitizer, ported from the frontend's sanitizeName. */
function sanitizeFilenameSeed(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9一-龥-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "jmeter-plan";
}

/**
 * THE output-path guard: a resolved path must stay inside the generated root.
 * Shared by template builds (generatedPlanTarget/runPlanBuild) and the AI-mode
 * resolver in ai-generator.ts.
 */
export function assertGeneratedOutputPath(generatedRoot: string, outputPath: string): string {
  const relativePath = relative(generatedRoot, outputPath);
  const insideGeneratedDir = relativePath !== "" && !relativePath.startsWith("..") && !relativePath.includes(":");
  if (!insideGeneratedDir) {
    throw new PlanBuildError("invalid-args", "Generated JMX can only be saved under server/generated.");
  }
  return outputPath;
}

/** Template-mode save target: `<generatedRoot>/<sanitized seed>-<yyyyMMdd-HHmmss>.jmx`. */
export function generatedPlanTarget(generatedRoot: string, seed: string): { path: string; filename: string } {
  const filename = `${sanitizeFilenameSeed(seed)}-${nowStamp()}.jmx`;
  return { path: assertGeneratedOutputPath(generatedRoot, resolve(generatedRoot, filename)), filename };
}

function assertNoTraversal(label: string, value: string): void {
  if (value.includes("..") || /[\\/]/.test(value) || /^[a-zA-Z]:/.test(value)) {
    throw new PlanBuildError("invalid-args", `${label} must be a plain name, not a path: ${value}`);
  }
}

// ── Executor ──

/**
 * Execute an ordered tool plan against a FRESH TestPlanService, then run the
 * server-owned finalize tail (validate → save → tree). Per-request service
 * instances keep concurrent builds isolated; the MCP stdio session keeps its
 * own singleton service in JmeterMcpRuntime.
 *
 * Failure semantics (mirrors the previous AI flow): a failing construction
 * step short-circuits the build; validation/tree text is recorded as-is; a
 * failing save aborts with a typed error.
 */
export async function runPlanBuild(
  input: { planName: string; steps: BuildSpecStep[]; savePath: string },
  options: PlanBuildOptions = {},
): Promise<BuiltPlan> {
  const generatedRoot = options.generatedRoot ?? defaultGeneratedRoot();
  const tools = options.tools ?? new Map(createTools().map((tool) => [tool.name, tool]));
  const service = options.service ?? new TestPlanService();
  const savePath = assertGeneratedOutputPath(generatedRoot, resolve(input.savePath));
  const onStep = options.onStep;

  const runStep = async (toolName: string, args: JsonObject, finalize: boolean): Promise<ToolResult> => {
    if (!finalize && options.denylist?.has(toolName)) {
      throw new PlanBuildError("invalid-args", `Tool '${toolName}' is not allowed in this build`, toolName);
    }
    const tool = tools.get(toolName);
    if (!tool) {
      throw new PlanBuildError("not-found", `Unknown tool: ${toolName}`, toolName);
    }
    await onStep?.({ phase: "start", tool: toolName, args, finalize });
    const result = withSpanSync({ name: `tool.${toolName}`, type: "tool", attributes: { toolName, args } }, () => tool.execute(args, service));
    const text = resultText(result);
    await onStep?.({ phase: "done", tool: toolName, args, text, finalize });
    return result;
  };

  const steps: BuiltPlanStep[] = [];
  for (const step of input.steps) {
    const result = await runStep(step.tool, step.args ?? {}, false);
    steps.push({ tool: step.tool, text: resultText(result) });
    if (!result.ok) {
      throw new PlanBuildError(result.error.code, `Step '${step.tool}' failed: ${result.error.message}`, step.tool);
    }
  }

  const validation = await runStep("validate_test_plan", {}, true);
  const save = await runStep("save_test_plan", { path: savePath }, true);
  if (!save.ok) {
    throw new PlanBuildError(save.error.code, save.error.message, "save_test_plan");
  }
  const tree = await runStep("list_test_plan_tree", {}, true);

  const validationText = resultText(validation);
  const saveText = resultText(save);
  const treeText = resultText(tree);
  steps.push(
    { tool: "validate_test_plan", text: validationText },
    { tool: "save_test_plan", text: saveText },
    { tool: "list_test_plan_tree", text: treeText },
  );

  return {
    planName: input.planName,
    path: savePath,
    filename: basename(savePath),
    saveMessage: saveText,
    validation: validationText,
    tree: treeText,
    steps,
  };
}

function normalizeSpecSteps(value: unknown): BuildSpecStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PlanBuildError("invalid-args", "steps must be a non-empty array.");
  }
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new PlanBuildError("invalid-args", `steps[${index}] must be an object with a tool name.`);
    }
    const tool = (item as JsonObject).tool;
    const args = (item as JsonObject).args;
    if (typeof tool !== "string" || !tool.trim()) {
      throw new PlanBuildError("invalid-args", `steps[${index}].tool must be a non-empty string.`);
    }
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
      throw new PlanBuildError("invalid-args", `steps[${index}].args must be an object when present.`);
    }
    return { tool: tool.trim(), args: args as JsonObject | undefined };
  });
}

/**
 * Template-mode entry point: validate the spec, derive the save target from
 * the filename seed (sanitize + timestamp, server-side), and build.
 */
export async function buildFromTemplate(spec: TemplateBuildSpec, options: PlanBuildOptions = {}): Promise<BuiltPlan> {
  const planName = typeof spec?.planName === "string" ? spec.planName.trim() : "";
  const seed = typeof spec?.seed === "string" ? spec.seed.trim() : "";
  if (!planName) throw new PlanBuildError("invalid-args", "planName is required.");
  if (!seed) throw new PlanBuildError("invalid-args", "seed is required.");
  assertNoTraversal("planName", planName);
  assertNoTraversal("seed", seed);
  const steps = normalizeSpecSteps(spec?.steps);

  const generatedRoot = options.generatedRoot ?? defaultGeneratedRoot();
  const target = generatedPlanTarget(generatedRoot, seed);
  return runPlanBuild({ planName, steps, savePath: target.path }, { ...options, generatedRoot });
}
