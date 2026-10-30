import { describe, expect, it } from "vitest";
import { estimatePlanSteps, MAX_EST_STEPS, MAX_PROPOSALS, validateProposals } from "./plan-proposals.js";

const validItem = {
  useCase: "登录",
  title: "正确账号登录成功",
  goal: "验证标准用户能登录并进入商品列表",
  expected: ["进入商品列表页", "展示 6 个商品"],
  priority: "high",
  estSteps: ["打开登录页", "输入用户名密码", "点击登录"],
};

describe("validateProposals", () => {
  it("合法输出整体通过并保留字段", () => {
    const result = validateProposals({ proposals: [validItem] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toEqual({
      useCase: "登录",
      title: "正确账号登录成功",
      goal: "验证标准用户能登录并进入商品列表",
      expected: ["进入商品列表页", "展示 6 个商品"],
      priority: "high",
      estSteps: ["打开登录页", "输入用户名密码", "点击登录"],
    });
    expect(result.dropped).toBe(0);
  });

  it("裸数组与对象包裹等价", () => {
    const bare = validateProposals([validItem]);
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.proposals[0].title).toBe(validItem.title);
  });

  it("整体形状非法判 ok:false（调用方带错误重试）", () => {
    expect(validateProposals("不是对象")).toEqual({ ok: false, errors: ["输出不含 proposals 数组"] });
    expect(validateProposals({ proposals: [] })).toEqual({ ok: false, errors: ["proposals 为空"] });
    expect(validateProposals({ proposals: [{ title: "" }, {}] }).ok).toBe(false);
  });

  it("逐项非法丢弃该项、合法项保留（部分产出优于全丢）", () => {
    const result = validateProposals({
      proposals: [
        validItem,
        { ...validItem, title: "" },
        { ...validItem, estSteps: [] },
        { ...validItem, expected: [] },
        "字符串项",
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toHaveLength(1);
    expect(result.dropped).toBe(4);
    expect(result.notes.length).toBeGreaterThanOrEqual(4);
  });

  it("priority 归一：未知值回落 medium，p0/高 映射 high", () => {
    const result = validateProposals({
      proposals: [
        { ...validItem, priority: "P0" },
        { ...validItem, priority: "紧急" },
        { ...validItem, priority: "低" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals.map((p) => p.priority)).toEqual(["high", "medium", "low"]);
    expect(result.notes.some((n) => n.includes("无法识别"))).toBe(true);
  });

  it("useCase 缺省归为「未分组」；文本与列表超限截断", () => {
    const long = "x".repeat(1000);
    const result = validateProposals({
      proposals: [
        {
          ...validItem,
          useCase: "",
          goal: long,
          estSteps: Array.from({ length: MAX_EST_STEPS + 5 }, (_, i) => `步骤 ${i}`),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals[0].useCase).toBe("未分组");
    expect(result.proposals[0].goal.length).toBe(1000);
    expect(result.proposals[0].estSteps).toHaveLength(MAX_EST_STEPS);
    expect(result.notes.some((n) => n.includes("截断"))).toBe(true);
  });

  it("提案总数超上限截断", () => {
    const result = validateProposals({
      proposals: Array.from({ length: MAX_PROPOSALS + 3 }, () => ({ ...validItem })),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toHaveLength(MAX_PROPOSALS);
  });
});

describe("estimatePlanSteps", () => {
  it("预估步骤直映为 act、预估预期直映为 assert（同 A 模式），编号连续", () => {
    const steps = estimatePlanSteps(["打开登录页", "登录"], ["进入列表"]);
    expect(steps).toEqual([
      { id: 1, type: "act", text: "打开登录页", fromStep: 1, enabled: true },
      { id: 2, type: "act", text: "登录", fromStep: 2, enabled: true },
      { id: 3, type: "assert", text: "进入列表", fromExpected: 1, enabled: true },
    ]);
  });
});
