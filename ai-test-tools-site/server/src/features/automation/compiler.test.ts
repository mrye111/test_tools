import { describe, expect, it } from "vitest";
import {
  buildDirectPlan,
  compileFunctionalCase,
  compileTextHash,
  extractJsonObject,
  type ChatCaller,
  type ChatMessage,
  type CompileInput,
} from "./compiler.js";
import { normalizeCaseText } from "./normalize.js";
import { MemoryAutomationRepository } from "./memory-repository.js";
import type { CompiledPlan } from "./types.js";

/** 套餐集 TC040 真实样例（字面 \n 形态）。 */
const TC040: CompileInput = {
  caseRef: "TC040",
  title: "[P0]实际用量52万超过最高档上限50万时超出2万条按单条计费",
  precondition: "阶梯套餐PKG-O已生效；OPS超量单条价0.05元/条已配置；全年累计已达500000条",
  steps: "1.确认累计用量500000条\\n2.再发起20000条调用使累计达520000条\\n3.触发结算\\n4.查看账单构成",
  expectedResult: "1.累计确认50万条\\n2.累计达52万条\\n3.结算完成\\n4.50万条以内按最高档包年价结算，超出2万条按单条计费=20000×0.05=1000.00元",
  env: { entryUrl: "https://staging.billing.example.com" },
};

const GOOD_LLM_OUTPUT = JSON.stringify({
  executable: "partial",
  variables: [{ name: "usageBefore", value: null, source: "extract", fromStep: 1 }],
  setup: [
    { type: "navigate", url: "https://staging.billing.example.com" },
    { type: "external", text: "确保套餐PKG-O已生效且累计用量已达500000条", reason: "数据态前置，浏览器内无法准备" },
  ],
  instructions: [
    { id: 1, type: "act", text: "在左侧导航点击【账单中心】", fromStep: 1 },
    { id: 2, type: "assert", text: "用量概览区显示累计用量为 500000 条", fromStep: 1, fromExpected: 1 },
    { id: 3, type: "extract", text: "读取当前累计用量数值", saveAs: "usageBefore", fromStep: 1 },
    { id: 4, type: "assert", text: "账单明细显示超出部分费用为 1000.00 元", fromStep: 4, fromExpected: 4 },
  ],
  manualItems: [
    { text: "再发起20000条调用使累计达520000条", fromStep: 2, reason: "需通过 API/压测工具发起调用，非 UI 操作" },
    { text: "触发结算", fromStep: 3, reason: "后端批处理动作，UI 无入口" },
  ],
  compileNotes: ["预期第4条的计算断言已改写为纯比对形式"],
});

function stubChat(outputs: string[]): { callChat: ChatCaller; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  let index = 0;
  return {
    calls,
    callChat: async (messages) => {
      calls.push(messages);
      const output = outputs[Math.min(index, outputs.length - 1)];
      index++;
      return output;
    },
  };
}

describe("extractJsonObject", () => {
  it("剥离 markdown 围栏", () => {
    expect(extractJsonObject("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
  });
  it("提取首尾花括号之间的 JSON", () => {
    expect(extractJsonObject("说明文字 {\"a\":1} 结尾")).toEqual({ a: 1 });
  });
  it("无法解析时返回 null", () => {
    expect(extractJsonObject("没有对象")).toBeNull();
  });
});

describe("compileTextHash", () => {
  it("同一输入稳定，任一字段变化即变", () => {
    const normalized = normalizeCaseText(TC040.steps, TC040.expectedResult);
    const h1 = compileTextHash(TC040, normalized);
    const h2 = compileTextHash(TC040, normalized);
    expect(h1).toBe(h2);
    const h3 = compileTextHash({ ...TC040, steps: TC040.steps + " " }, normalizeCaseText(TC040.steps + " ", TC040.expectedResult));
    expect(h3).toBe(h1); // 切分归一后尾随空白不影响
    const h4 = compileTextHash({ ...TC040, title: "改标题" }, normalized);
    expect(h4).not.toBe(h1);
    const h5 = compileTextHash({ ...TC040, env: { entryUrl: "https://other.example.com" } }, normalized);
    expect(h5).not.toBe(h1);
  });
});

describe("compileFunctionalCase", () => {
  it("一次编译成功：partial + manualItems + 溯源 + 写缓存", async () => {
    const repo = new MemoryAutomationRepository();
    const { callChat, calls } = stubChat([GOOD_LLM_OUTPUT]);
    const result = await compileFunctionalCase(TC040, { callChat, cache: repo });

    expect(result.usedFallback).toBe(false);
    expect(result.cacheHit).toBe(false);
    expect(calls).toHaveLength(1);
    expect(result.plan.executable).toBe("partial");
    expect(result.plan.instructions).toHaveLength(4);
    expect(result.plan.manualItems).toHaveLength(2);
    expect(result.plan.manualItems[0].fromStep).toBe(2);
    expect(result.plan.compileHash).toHaveLength(64);

    // 缓存已写入
    const cached = await repo.getCompiledCache("TC040", result.plan.compileHash);
    expect(cached).not.toBeNull();
  });

  it("缓存命中：不再调用 LLM", async () => {
    const repo = new MemoryAutomationRepository();
    const first = stubChat([GOOD_LLM_OUTPUT]);
    const r1 = await compileFunctionalCase(TC040, { callChat: first.callChat, cache: repo });
    const second = stubChat([GOOD_LLM_OUTPUT]);
    const r2 = await compileFunctionalCase(TC040, { callChat: second.callChat, cache: repo });

    expect(r2.cacheHit).toBe(true);
    expect(second.calls).toHaveLength(0);
    expect(r2.plan.compileHash).toBe(r1.plan.compileHash);
  });

  it("首次校验失败 → 附错误重试一次后成功", async () => {
    const invalidThenValid = [
      JSON.stringify({ instructions: [{ id: 1, type: "click", text: "x" }] }),
      GOOD_LLM_OUTPUT,
    ];
    const { callChat, calls } = stubChat(invalidThenValid);
    const result = await compileFunctionalCase(TC040, { callChat });

    expect(result.usedFallback).toBe(false);
    expect(calls).toHaveLength(2);
    // 第二次调用带了校验错误反馈
    const retryMessage = calls[1][calls[1].length - 1].content;
    expect(retryMessage).toContain("未通过确定性校验");
  });

  it("两次都失败 → 降级直映（A 模式），标记 compileFailed", async () => {
    const { callChat, calls } = stubChat(["完全不是 JSON", "```json\n{\"instructions\":[{\"id\":1,\"type\":\"nope\",\"text\":\"x\"}]}\n```"]);
    const result = await compileFunctionalCase(TC040, { callChat });

    expect(result.usedFallback).toBe(true);
    expect(result.plan.compileFailed).toBe(true);
    expect(calls).toHaveLength(2);
    expect(result.validationErrors.length).toBeGreaterThan(0);
    // 直映产物：4 步 act + 4 条 assert
    const acts = result.plan.instructions.filter((s) => s.type === "act");
    const asserts = result.plan.instructions.filter((s) => s.type === "assert");
    expect(acts).toHaveLength(4);
    expect(asserts).toHaveLength(4);
    expect(result.plan.executable).toBe("full");
    expect(result.plan.setup[0]).toEqual({ type: "navigate", url: "https://staging.billing.example.com" });
  });
});

describe("buildDirectPlan", () => {
  it("步骤与预期按位置配对并带溯源", () => {
    const normalized = normalizeCaseText(TC040.steps, TC040.expectedResult);
    const plan = buildDirectPlan(TC040, normalized, "hash123");
    expect(plan.instructions[0]).toMatchObject({ type: "act", fromStep: 1, text: "确认累计用量500000条" });
    expect(plan.instructions[4]).toMatchObject({ type: "assert", fromExpected: 1, text: "累计确认50万条" });
    expect(plan.compileHash).toBe("hash123");
    expect(plan.compileFailed).toBe(true);
  });
});
