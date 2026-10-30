// @vitest-environment node
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  executePlan,
  mapProgressEvent,
  substituteVars,
  type AgentProgressLike,
  type AgentSession,
  type ExecutionAgent,
  type SessionFactory,
} from "./runner.js";
import type { AutomationStep, RunEvent } from "./types.js";

const STEPS: AutomationStep[] = [
  { id: 1, type: "act", text: "在账号框输入 user_normal", enabled: true },
  { id: 2, type: "act", text: "在密码框输入 ${LOGIN_PASSWORD}", enabled: true },
  { id: 3, type: "assert", text: "页面跳转至首页并显示昵称", enabled: true },
];

type FakeBehavior = {
  failOn?: (step: string, call: string) => boolean;
  queryValue?: string;
  progress?: AgentProgressLike[];
};

function fakeSessionFactory(behavior: FakeBehavior = {}): {
  factory: SessionFactory;
  calls: string[];
  closed: () => boolean;
} {
  const calls: string[] = [];
  let closed = false;
  const agent: ExecutionAgent = {
    aiAct: async (text) => {
      calls.push(`act:${text}`);
      if (behavior.failOn?.("act", text)) throw new Error("定位失败：找不到元素");
    },
    aiAssert: async (text) => {
      calls.push(`assert:${text}`);
      if (behavior.failOn?.("assert", text)) throw new Error("断言失败：页面未显示预期内容");
    },
    aiQuery: async (_shape, demand) => {
      calls.push(`query:${demand}`);
      return { value: behavior.queryValue ?? "500000" };
    },
    aiWaitFor: async (text) => {
      calls.push(`wait:${text}`);
    },
    addProgressListener: (listener) => {
      for (const event of behavior.progress ?? []) listener(event);
      return () => undefined;
    },
    destroy: async () => undefined,
    reportFile: "/tmp/report-x.html",
  };
  const factory: SessionFactory = async ({ onProgress }) => {
    const session: AgentSession = {
      agent,
      goto: async (url) => {
        calls.push(`goto:${url}`);
      },
      close: async () => {
        closed = true;
        return agent.reportFile;
      },
    };
    // 模拟生产工厂：构造时注册监听器
    if (onProgress && agent.addProgressListener) agent.addProgressListener(onProgress);
    return session;
  };
  return { factory, calls, closed: () => closed };
}

describe("executePlan - 基本执行", () => {
  it("全部通过 → passed（含导航与变量替换、报告路径回收、会话关闭）", async () => {
    const { factory, calls, closed } = fakeSessionFactory();
    const events: RunEvent[] = [];
    const result = await executePlan(
      {
        steps: STEPS,
        manualItems: [],
        setup: [{ type: "navigate", url: "https://staging.example.com/login" }],
        variables: { LOGIN_PASSWORD: "ValidPass123" },
        onEvent: (e) => events.push(e),
      },
      { createSession: factory },
    );

    expect(result.verdict).toBe("passed");
    expect(result.stepResults.map((r) => r.status)).toEqual(["passed", "passed", "passed"]);
    expect(calls[0]).toBe("goto:https://staging.example.com/login");
    expect(calls[1]).toBe("act:在账号框输入 user_normal");
    // ${VAR} 凭据占位被替换
    expect(calls[2]).toBe("act:在密码框输入 ValidPass123");
    expect(result.reportFile).toBe("/tmp/report-x.html");
    expect(closed()).toBe(true);
    // 步骤事件完整
    expect(events.filter((e) => e.kind === "step-start")).toHaveLength(3);
    expect(events.filter((e) => e.kind === "step-done")).toHaveLength(3);
  });

  it("含人工项 → 自动步骤全过也是 partial，人工项记 skipped-manual", async () => {
    const { factory } = fakeSessionFactory();
    const result = await executePlan(
      {
        steps: STEPS.slice(0, 1),
        manualItems: [{ text: "触发结算", reason: "后端批处理，UI 无入口", fromStep: 3 }],
      },
      { createSession: factory },
    );
    expect(result.verdict).toBe("partial");
    const manual = result.stepResults.find((r) => r.status === "skipped-manual");
    expect(manual?.text).toBe("触发结算");
    expect(manual?.error).toContain("后端批处理");
  });

  it("断言失败 → failed 且失败即停（后续步骤不执行）", async () => {
    const { factory, calls } = fakeSessionFactory({
      failOn: (step) => step === "assert",
    });
    const steps: AutomationStep[] = [
      STEPS[0],
      STEPS[2],
      { id: 3, type: "act", text: "这一步不应执行", enabled: true },
    ];
    const result = await executePlan({ steps, manualItems: [] }, { createSession: factory });
    expect(result.verdict).toBe("failed");
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[1].status).toBe("failed");
    expect(result.stepResults[1].error).toContain("断言失败");
    expect(calls.some((c) => c.includes("不应执行"))).toBe(false);
  });

  it("禁用步骤记 skipped 且不执行", async () => {
    const { factory, calls } = fakeSessionFactory();
    const steps: AutomationStep[] = [
      { ...STEPS[0], enabled: false },
      STEPS[2],
    ];
    const result = await executePlan({ steps, manualItems: [] }, { createSession: factory });
    expect(result.stepResults[0].status).toBe("skipped");
    expect(calls.some((c) => c.includes("user_normal"))).toBe(false);
    expect(result.verdict).toBe("passed");
  });

  it("extract 写变量表并供后续步骤引用", async () => {
    const { factory, calls } = fakeSessionFactory({ queryValue: "500000" });
    const steps: AutomationStep[] = [
      { id: 1, type: "extract", text: "读取当前累计用量数值", saveAs: "usageBefore", enabled: true },
      { id: 2, type: "assert", text: "用量显示为 {{usageBefore}} 条", enabled: true },
    ];
    const events: RunEvent[] = [];
    const result = await executePlan(
      { steps, manualItems: [], onEvent: (e) => events.push(e) },
      { createSession: factory },
    );
    expect(result.variables.usageBefore).toBe("500000");
    expect(calls.some((c) => c === "assert:用量显示为 500000 条")).toBe(true);
    expect(events.some((e) => e.kind === "variable" && e.name === "usageBefore")).toBe(true);
    expect(result.stepResults[0].extractedValue).toBe("500000");
  });

  it("external 前置记 skipped-manual，不参与结论失败", async () => {
    const { factory } = fakeSessionFactory();
    const result = await executePlan(
      {
        steps: STEPS.slice(0, 1),
        manualItems: [],
        setup: [{ type: "external", text: "确保套餐PKG-O已生效", reason: "数据态前置" }],
      },
      { createSession: factory },
    );
    expect(result.stepResults[0]).toMatchObject({ type: "external", status: "skipped-manual" });
    expect(result.verdict).toBe("passed");
  });

  it("abortSignal 触发 → aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { factory } = fakeSessionFactory();
    const result = await executePlan(
      { steps: STEPS, manualItems: [], abortSignal: controller.signal },
      { createSession: factory },
    );
    expect(result.verdict).toBe("aborted");
  });
});

describe("substituteVars", () => {
  it("{{var}} 与 ${VAR} 都替换；未声明保留原样", () => {
    const vars = { a: "1", PASSWORD: "secret" };
    expect(substituteVars("值 {{a}} 与 ${PASSWORD} 与 {{unknown}}", vars)).toBe("值 1 与 secret 与 {{unknown}}");
  });

  it("单次替换：注入的值含 ${X} 字面量不会被二次替换（评审 M6）", () => {
    const vars = { a: "包含${b}的值", b: "不应出现" };
    expect(substituteVars("{{a}}", vars)).toBe("包含${b}的值");
    // extract 来的页面内容含 ${PASSWORD} 也不会在后续步骤里把真密码注入
    const vars2 = { fromPage: "页面文本${PASSWORD}", PASSWORD: "真密码" };
    expect(substituteVars("后续指令引用 {{fromPage}}", vars2)).toBe("后续指令引用 页面文本${PASSWORD}");
  });
});

describe("executePlan - 极速引擎集成", () => {
  function fakePage(): NonNullable<import("./runner.js").AgentSession["page"]> {
    return {} as NonNullable<import("./runner.js").AgentSession["page"]>;
  }

  it("auto 模式 + fastRunner 成功 → 不调 aiAct，步骤标 fast", async () => {
    const { factory, calls } = fakeSessionFactory();
    // 给会话补上 page（fake 会话默认没有）
    const factoryWithPage: typeof factory = async (opts) => {
      const session = await factory(opts);
      return { ...session, page: fakePage() };
    };
    const fastRunner = async () => ({ ok: true, fallback: false, decisions: 1, frames: [] });
    const result = await executePlan(
      { steps: [STEPS[0]], manualItems: [], engine: "auto", fastRunner },
      { createSession: factoryWithPage },
    );
    expect(result.verdict).toBe("passed");
    expect(result.stepResults[0].engine).toBe("fast");
    expect(calls.some((c) => c.startsWith("act:"))).toBe(false);
  });

  it("fastRunner 返回 fallback → 降级 aiAct，步骤标 visual", async () => {
    const { factory, calls } = fakeSessionFactory();
    const factoryWithPage: typeof factory = async (opts) => {
      const session = await factory(opts);
      return { ...session, page: fakePage() };
    };
    const fastRunner = async () => ({ ok: false, reason: "blocked", fallback: true, decisions: 1, frames: [] });
    const result = await executePlan(
      { steps: [STEPS[0]], manualItems: [], engine: "auto", fastRunner },
      { createSession: factoryWithPage },
    );
    expect(result.verdict).toBe("passed");
    expect(result.stepResults[0].engine).toBe("visual");
    expect(calls.some((c) => c.startsWith("act:"))).toBe(true);
  });

  it("visual 模式不走极速引擎", async () => {
    const { factory, calls } = fakeSessionFactory();
    const factoryWithPage: typeof factory = async (opts) => {
      const session = await factory(opts);
      return { ...session, page: fakePage() };
    };
    let fastCalled = false;
    const fastRunner = async () => {
      fastCalled = true;
      return { ok: true, fallback: false, decisions: 1, frames: [] };
    };
    const result = await executePlan(
      { steps: [STEPS[0]], manualItems: [], engine: "visual", fastRunner },
      { createSession: factoryWithPage },
    );
    expect(result.verdict).toBe("passed");
    expect(fastCalled).toBe(false);
    expect(calls.some((c) => c.startsWith("act:"))).toBe(true);
  });
});

describe("executePlan - 凭据防泄漏（评审 H4）", () => {
  it("StepResult 保留 ${KEY} 占位原文，真实值只传给 agent", async () => {
    const { factory, calls } = fakeSessionFactory({
      failOn: (step) => step === "assert",
    });
    const steps: AutomationStep[] = [
      { id: 1, type: "act", text: "在密码框输入 ${LOGIN_PASSWORD}", enabled: true },
      { id: 2, type: "assert", text: "页面显示昵称", enabled: true },
    ];
    const result = await executePlan(
      { steps, manualItems: [], variables: { LOGIN_PASSWORD: "TopSecret123" } },
      { createSession: factory },
    );
    // agent 收到替换后的真实值
    expect(calls.some((c) => c === "act:在密码框输入 TopSecret123")).toBe(true);
    // 但 stepResults 里全是占位原文
    expect(result.stepResults[0].text).toBe("在密码框输入 ${LOGIN_PASSWORD}");
    const allText = JSON.stringify(result.stepResults);
    expect(allText).not.toContain("TopSecret123");
    expect(result.verdict).toBe("failed");
  });

  it("步骤失败时错误消息中的真实值被脱敏", async () => {
    const { factory } = fakeSessionFactory({
      failOn: () => true,
    });
    // fake agent 的错误消息不含真实值——直接测 sanitize 行为经路由后的结果：
    // 构造一个会在错误消息中带入指令原文的失败
    const steps: AutomationStep[] = [
      { id: 1, type: "act", text: "在密码框输入 ${LOGIN_PASSWORD}", enabled: true },
    ];
    const result = await executePlan(
      { steps, manualItems: [], variables: { LOGIN_PASSWORD: "TopSecret123" } },
      { createSession: factory },
    );
    expect(result.stepResults[0].status).toBe("failed");
    expect(result.stepResults[0].error ?? "").not.toContain("TopSecret123");
  });
});

describe("mapProgressEvent", () => {
  const at = () => "2026-09-21T00:00:00.000Z";
  it("plan_thinking → screenshot；plan_planned → thought；action_* → action", () => {
    expect(
      mapProgressEvent({ scope: "aiAct", phase: "plan_thinking", data: { screenshot: "base64..." } }, at),
    ).toMatchObject({ kind: "screenshot", data: "base64..." });
    expect(
      mapProgressEvent({ scope: "aiAct", phase: "plan_planned", data: { thought: "我先点击登录" } }, at),
    ).toMatchObject({ kind: "thought", text: "我先点击登录" });
    expect(
      mapProgressEvent({ scope: "aiAct", phase: "action_running", data: { action: { name: "Tap", point: [100, 200] } } }, at),
    ).toMatchObject({ kind: "action", name: "Tap", point: [100, 200], phase: "start" });
  });
  it("非 aiAct scope 与未知 phase 返回 null", () => {
    expect(mapProgressEvent({ scope: "aiQuery", phase: "plan_planned" }, at)).toBeNull();
    expect(mapProgressEvent({ scope: "aiAct", phase: "complete" }, at)).toBeNull();
  });
});

describe("executePlan - 极速回放报告（Midscene 无流水时兜底）", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.MIDSCENE_RUN_DIR;
    process.env.MIDSCENE_RUN_DIR = mkdtempSync(join(tmpdir(), "at-runner-replay-"));
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.MIDSCENE_RUN_DIR;
    else process.env.MIDSCENE_RUN_DIR = prev;
  });

  const fastFrame = {
    iteration: 0,
    phase: "action" as const,
    operation: "TYPE_TEXT" as const,
    targetLabel: "[2] 密码框",
    text: "TopSecret123",
    screenshot: "ZmFrZS1qcGVn",
    at: new Date().toISOString(),
    durationMs: 100,
  };

  function factoryWithPageNoReport(): SessionFactory {
    const { factory } = fakeSessionFactory();
    return async (opts) => {
      const session = await factory(opts);
      return {
        ...session,
        page: {} as NonNullable<AgentSession["page"]>,
        // 模拟 Midscene 无任务流水：close 不产生报告
        close: async () => undefined,
      };
    };
  }

  it("全程极速 → 写 fast-replay 报告，且帧内真实凭据被脱敏", async () => {
    const fastRunner = async () => ({ ok: true, fallback: false, decisions: 1, frames: [fastFrame] });
    const result = await executePlan(
      {
        steps: [STEPS[1]],
        manualItems: [],
        variables: { LOGIN_PASSWORD: "TopSecret123" },
        engine: "auto",
        fastRunner,
        reportTitle: "登录",
        reportCaseNo: "ATC-001",
        entryUrl: "https://staging.example.com/login",
      },
      { createSession: factoryWithPageNoReport() },
    );
    expect(result.verdict).toBe("passed");
    expect(result.reportFile).toBeTruthy();
    expect(result.reportFile).toContain("fast-replay-");
    const html = readFileSync(result.reportFile as string, "utf-8");
    expect(html).toContain("midscene_web_dump");
    expect(html).not.toContain("TopSecret123");
    expect(html).toContain("在密码框输入 ${LOGIN_PASSWORD}");
  });

  it("Midscene 报告已存在时不写极速回放（视觉优先）", async () => {
    const fastRunner = async () => ({ ok: true, fallback: false, decisions: 1, frames: [fastFrame] });
    const result = await executePlan(
      { steps: [STEPS[1]], manualItems: [], engine: "auto", fastRunner },
      { createSession: fakeSessionFactory().factory },
    );
    expect(result.reportFile).toBe("/tmp/report-x.html");
  });

  it("无帧可写（截图全失败）→ reportFile 保持 undefined，不影响结论", async () => {
    const fastRunner = async () => ({ ok: true, fallback: false, decisions: 1, frames: [] });
    const result = await executePlan(
      { steps: [STEPS[1]], manualItems: [], engine: "auto", fastRunner },
      { createSession: factoryWithPageNoReport() },
    );
    expect(result.verdict).toBe("passed");
    expect(result.reportFile).toBeUndefined();
  });
});
