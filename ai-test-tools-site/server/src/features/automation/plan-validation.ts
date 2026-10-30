/** CompiledPlan 的确定性校验：不依赖 LLM 自觉，防编译期幻觉（票据 02 §3.2 校验条款）。 */

import type {
  AutomationStep,
  CompiledSetup,
  CompiledVariable,
  ExecutableLevel,
  ManualItem,
} from "./types.js";

const STEP_TYPES = new Set(["act", "assert", "extract", "wait"]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** assert 禁止以动作动词开头（防止把 act 误标为 assert）。 */
const ACTION_VERB_PREFIX =
  /^(点击|双击|右击|输入|填写|键入|打开|访问|导航|跳转|勾选|取消勾选|拖动|拖拽|选择|滑动|滚动|切换|提交|按下|悬停|移动|上传|下载|删除|新增|创建|关闭)/;
/** act 禁止以验证性措辞开头（规则 3 是双向的，评审 M3）。 */
const ASSERTIVE_VERB_PREFIX = /^(确认|查看|检查|验证|断言|核对|校验|观察)/;
/** 指令文本中的 {{var}} 引用。 */
const VAR_REF = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** LLM 输出经校验清洗后的形态（caseRef/compileHash 由编译器填充，executable 由确定性推导覆盖）。 */
export type SanitizedPlan = {
  executable: ExecutableLevel;
  variables: CompiledVariable[];
  setup: CompiledSetup[];
  instructions: AutomationStep[];
  manualItems: ManualItem[];
  compileNotes: string[];
};

export type PlanValidation =
  | { ok: true; plan: SanitizedPlan; notes: string[] }
  | { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asIndexInRange(value: unknown, max: number): number | null {
  if (value === null || value === undefined) return null;
  // 只收真 number——"2"、true 这类强转结果对防幻觉校验器而言过于宽松（评审 LOW）
  if (typeof value !== "number") return null;
  if (!Number.isInteger(value) || value < 1 || value > max) return null;
  return value;
}

export function deriveExecutable(instructionCount: number, manualItemCount: number): ExecutableLevel {
  if (instructionCount === 0) return "manual";
  return manualItemCount === 0 ? "full" : "partial";
}

function sanitizeInstructions(
  raw: unknown,
  maxStep: number,
  maxExpected: number,
  errors: string[],
  notes: string[],
): AutomationStep[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push("instructions 必须是数组");
    return [];
  }
  const steps: AutomationStep[] = [];
  raw.forEach((item, index) => {
    const seq = index + 1;
    if (!isObject(item)) {
      errors.push(`instructions[${seq}] 不是对象`);
      return;
    }
    const type = typeof item.type === "string" ? item.type : "";
    if (!STEP_TYPES.has(type)) {
      errors.push(`instructions[${seq}].type 非法: ${type || "(缺失)"}`);
      return;
    }
    const text = asNonEmptyString(item.text);
    if (!text) {
      errors.push(`instructions[${seq}].text 为空`);
      return;
    }
    if (type === "assert" && ACTION_VERB_PREFIX.test(text)) {
      errors.push(`instructions[${seq}] 是 assert 但以动作动词开头: "${text.slice(0, 20)}…"`);
      return;
    }
    if (type === "act" && ASSERTIVE_VERB_PREFIX.test(text)) {
      errors.push(`instructions[${seq}] 是 act 但以验证性措辞开头: "${text.slice(0, 20)}…"`);
      return;
    }
    const fromStep = asIndexInRange(item.fromStep, maxStep);
    if (item.fromStep !== undefined && item.fromStep !== null && fromStep === null) {
      errors.push(`instructions[${seq}].fromStep 超出范围 1..${maxStep}`);
      return;
    }
    const fromExpected = asIndexInRange(item.fromExpected, maxExpected);
    if (item.fromExpected !== undefined && item.fromExpected !== null && fromExpected === null) {
      errors.push(`instructions[${seq}].fromExpected 超出范围 1..${maxExpected}`);
      return;
    }
    let saveAs: string | undefined;
    if (item.saveAs !== undefined && item.saveAs !== null) {
      const name = typeof item.saveAs === "string" ? item.saveAs.trim() : "";
      if (!IDENT.test(name)) {
        errors.push(`instructions[${seq}].saveAs 非法变量名: ${String(item.saveAs)}`);
        return;
      }
      saveAs = name;
    }
    if (type === "extract" && !saveAs) {
      notes.push(`instructions[${seq}] extract 未带 saveAs，执行期无法引用其值`);
    }
    // id 以数组顺序为准重排：编号本身不携带语义，LLM 编号不连续不判失败
    steps.push({ id: seq, type: type as AutomationStep["type"], text, saveAs, fromStep: fromStep ?? undefined, fromExpected: fromExpected ?? undefined, enabled: true });
  });
  return steps;
}

function sanitizeManualItems(raw: unknown, maxStep: number, errors: string[]): ManualItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push("manualItems 必须是数组");
    return [];
  }
  const items: ManualItem[] = [];
  raw.forEach((item, index) => {
    const seq = index + 1;
    if (!isObject(item)) {
      errors.push(`manualItems[${seq}] 不是对象`);
      return;
    }
    const text = asNonEmptyString(item.text);
    const reason = asNonEmptyString(item.reason);
    if (!text || !reason) {
      errors.push(`manualItems[${seq}] 需要非空 text 与 reason`);
      return;
    }
    const fromStep = asIndexInRange(item.fromStep, maxStep);
    if (item.fromStep !== undefined && item.fromStep !== null && fromStep === null) {
      errors.push(`manualItems[${seq}].fromStep 超出范围 1..${maxStep}`);
      return;
    }
    items.push({ text, reason, fromStep: fromStep ?? undefined });
  });
  return items;
}

function sanitizeVariables(raw: unknown, maxStep: number, errors: string[]): CompiledVariable[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push("variables 必须是数组");
    return [];
  }
  const variables: CompiledVariable[] = [];
  raw.forEach((item, index) => {
    const seq = index + 1;
    if (!isObject(item)) {
      errors.push(`variables[${seq}] 不是对象`);
      return;
    }
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!IDENT.test(name)) {
      errors.push(`variables[${seq}].name 非法: ${String(item.name)}`);
      return;
    }
    if (item.source !== "extract" && item.source !== "input") {
      errors.push(`variables[${seq}].source 必须是 extract|input`);
      return;
    }
    const fromStep = asIndexInRange(item.fromStep, maxStep);
    if (item.fromStep !== undefined && item.fromStep !== null && fromStep === null) {
      errors.push(`variables[${seq}].fromStep 超出范围 1..${maxStep}`);
      return;
    }
    variables.push({
      name,
      value: typeof item.value === "string" ? item.value : null,
      source: item.source,
      fromStep: fromStep ?? undefined,
    });
  });
  return variables;
}

function sanitizeSetup(raw: unknown, errors: string[]): CompiledSetup[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push("setup 必须是数组");
    return [];
  }
  const setup: CompiledSetup[] = [];
  raw.forEach((item, index) => {
    const seq = index + 1;
    if (!isObject(item)) {
      errors.push(`setup[${seq}] 不是对象`);
      return;
    }
    if (item.type === "navigate") {
      const url = asNonEmptyString(item.url);
      if (!url) {
        errors.push(`setup[${seq}] navigate 缺少 url`);
        return;
      }
      setup.push({ type: "navigate", url });
      return;
    }
    if (item.type === "external") {
      const text = asNonEmptyString(item.text);
      if (!text) {
        errors.push(`setup[${seq}] external 缺少 text`);
        return;
      }
      setup.push({ type: "external", text, reason: asNonEmptyString(item.reason) ?? undefined });
      return;
    }
    errors.push(`setup[${seq}].type 必须是 navigate|external`);
  });
  return setup;
}

/**
 * 校验并清洗 LLM 编译输出。ranges 为原用例条目数（fromStep/fromExpected 的合法上界）。
 * executable 不看 LLM 自报值——由指令数与人工项数确定性推导，不一致时记 note。
 */
export function validateCompiledPlan(raw: unknown, ranges: { maxStep: number; maxExpected: number }): PlanValidation {
  if (!isObject(raw)) {
    return { ok: false, errors: ["输出不是 JSON 对象"] };
  }
  const errors: string[] = [];
  const notes: string[] = [];
  const instructions = sanitizeInstructions(raw.instructions, ranges.maxStep, ranges.maxExpected, errors, notes);
  const manualItems = sanitizeManualItems(raw.manualItems, ranges.maxStep, errors);
  const variables = sanitizeVariables(raw.variables, ranges.maxStep, errors);
  const setup = sanitizeSetup(raw.setup, errors);
  const compileNotes = Array.isArray(raw.compileNotes)
    ? raw.compileNotes.filter((n): n is string => typeof n === "string")
    : [];
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // 交叉引用校验（评审 M3）：重复名判 error（会破坏执行期变量表）；悬空引用降级 note
  const saveAsNames = new Set<string>();
  for (const step of instructions) {
    if (!step.saveAs) continue;
    if (saveAsNames.has(step.saveAs)) {
      errors.push(`saveAs 重复: ${step.saveAs}`);
    }
    saveAsNames.add(step.saveAs);
  }
  const variableNames = new Set<string>();
  for (const variable of variables) {
    if (variableNames.has(variable.name)) {
      errors.push(`variables 重名: ${variable.name}`);
    }
    variableNames.add(variable.name);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  for (const variable of variables) {
    if (variable.source === "extract" && !saveAsNames.has(variable.name)) {
      notes.push(`variables.${variable.name} 声明为 extract 但没有指令的 saveAs 与之对应`);
    }
  }
  const declaredNames = new Set([...saveAsNames, ...variableNames]);
  for (const step of instructions) {
    for (const match of step.text.matchAll(VAR_REF)) {
      if (!declaredNames.has(match[1])) {
        notes.push(`instructions[${step.id}] 引用了未声明的变量 {{${match[1]}}}`);
      }
    }
  }

  const executable = deriveExecutable(instructions.length, manualItems.length);
  if (typeof raw.executable === "string" && raw.executable !== executable) {
    notes.push(`LLM 自报 executable=${raw.executable}，按内容推导为 ${executable}`);
  }
  return { ok: true, plan: { executable, variables, setup, instructions, manualItems, compileNotes }, notes };
}
