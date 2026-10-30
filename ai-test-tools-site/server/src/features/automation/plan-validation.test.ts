import { describe, expect, it } from "vitest";
import { deriveExecutable, validateCompiledPlan } from "./plan-validation.js";

const RANGES = { maxStep: 4, maxExpected: 4 };

const VALID_PLAN = {
  executable: "partial",
  variables: [{ name: "usageBefore", value: null, source: "extract", fromStep: 1 }],
  setup: [
    { type: "navigate", url: "{{entryUrl}}" },
    { type: "external", text: "确保套餐PKG-O已生效", reason: "数据态前置" },
  ],
  instructions: [
    { id: 1, type: "act", text: "在左侧导航点击【账单中心】", fromStep: 1 },
    { id: 2, type: "assert", text: "用量概览区显示累计用量为 500000 条", fromStep: 1, fromExpected: 1 },
    { id: 3, type: "extract", text: "读取当前累计用量数值", saveAs: "usageBefore", fromStep: 1 },
    { id: 4, type: "wait", text: "等待账单列表加载完成", fromStep: 4 },
  ],
  manualItems: [
    { text: "再发起20000条调用使累计达520000条", fromStep: 2, reason: "需通过 API/压测工具发起" },
  ],
  compileNotes: ["预期第4条已拆分"],
};

describe("validateCompiledPlan - 合法输入", () => {
  it("完整合法计划通过校验并按数组顺序重排 id", () => {
    const result = validateCompiledPlan(VALID_PLAN, RANGES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.instructions.map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(result.plan.instructions[2].saveAs).toBe("usageBefore");
    expect(result.plan.manualItems).toHaveLength(1);
    expect(result.plan.setup).toHaveLength(2);
  });

  it("executable 由内容确定性推导，LLM 自报不一致时记 note", () => {
    const result = validateCompiledPlan({ ...VALID_PLAN, executable: "full" }, RANGES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.executable).toBe("partial");
    expect(result.notes.some((n) => n.includes("partial"))).toBe(true);
  });

  it("instructions 编号不连续不判失败（按顺序重排）", () => {
    const shuffled = {
      ...VALID_PLAN,
      instructions: VALID_PLAN.instructions.map((s, i) => ({ ...s, id: (i + 1) * 10 })),
    };
    const result = validateCompiledPlan(shuffled, RANGES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.instructions.map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("validateCompiledPlan - 非法输入", () => {
  it("非对象直接拒绝", () => {
    expect(validateCompiledPlan("not json", RANGES).ok).toBe(false);
    expect(validateCompiledPlan(null, RANGES).ok).toBe(false);
  });

  it("fromStep 超出原步骤范围 → 溯源幻觉被拦截", () => {
    const bad = {
      ...VALID_PLAN,
      instructions: [{ id: 1, type: "act", text: "点击【账单中心】", fromStep: 99 }],
    };
    const result = validateCompiledPlan(bad, RANGES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("fromStep"))).toBe(true);
  });

  it("assert 以动作动词开头 → 类型混淆被拦截", () => {
    const bad = {
      ...VALID_PLAN,
      instructions: [{ id: 1, type: "assert", text: "点击【账单中心】" }],
    };
    const result = validateCompiledPlan(bad, RANGES);
    expect(result.ok).toBe(false);
  });

  it("非法 type 被拦截", () => {
    const bad = {
      ...VALID_PLAN,
      instructions: [{ id: 1, type: "click", text: "点击【账单中心】" }],
    };
    expect(validateCompiledPlan(bad, RANGES).ok).toBe(false);
  });

  it("extract 的 saveAs 非法变量名被拦截", () => {
    const bad = {
      ...VALID_PLAN,
      instructions: [{ id: 1, type: "extract", text: "读取数值", saveAs: "123bad name" }],
    };
    expect(validateCompiledPlan(bad, RANGES).ok).toBe(false);
  });

  it("manualItems 缺 reason 被拦截", () => {
    const bad = {
      ...VALID_PLAN,
      manualItems: [{ text: "触发结算" }],
    };
    expect(validateCompiledPlan(bad, RANGES).ok).toBe(false);
  });

  it("空 text 的指令被拦截", () => {
    const bad = {
      ...VALID_PLAN,
      instructions: [{ id: 1, type: "act", text: "  " }],
    };
    expect(validateCompiledPlan(bad, RANGES).ok).toBe(false);
  });
});

describe("deriveExecutable", () => {
  it.each([
    [5, 0, "full"],
    [5, 2, "partial"],
    [0, 0, "manual"],
    [0, 3, "manual"],
  ] as const)("%i 条指令 + %i 个人工项 → %s", (instructions, manual, expected) => {
    expect(deriveExecutable(instructions, manual)).toBe(expected);
  });
});
