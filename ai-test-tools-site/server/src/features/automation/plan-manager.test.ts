// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./compiler.js";
import { PlanManager, type PlanEvent, type PlanManagerDeps, type StartPlanInput } from "./plan-manager.js";
import type { NewPlanProposal, PlanProposal } from "./types.js";

function makeRepo() {
  const batches: NewPlanProposal[][] = [];
  const deps: Pick<PlanManagerDeps, "automationRepo"> = {
    automationRepo: {
      createProposals: async (inputs) => {
        batches.push(inputs);
        return inputs.map(
          (input, i): PlanProposal => ({
            ...input,
            id: `p-${batches.length}-${i}`,
            caseNo: `ATP-${String(i + 1).padStart(3, "0")}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );
      },
    },
  };
  return { batches, deps };
}

const VALID_OUTPUT = JSON.stringify({
  proposals: [
    {
      useCase: "登录",
      title: "标准用户登录成功",
      goal: "验证登录主流程",
      expected: ["进入商品列表"],
      priority: "high",
      estSteps: ["打开登录页", "输入账号密码", "点击登录"],
    },
    {
      useCase: "购物车",
      title: "加入购物车",
      goal: "验证商品可加购",
      expected: ["购物车角标 +1"],
      priority: "medium",
      estSteps: ["打开商品页", "点击加购"],
    },
  ],
});

function makeInput(overrides: Partial<StartPlanInput> = {}): StartPlanInput {
  return {
    projectId: "proj-1",
    sourceId: "src-1",
    entryUrl: "https://demo.test",
    prdText: "购物流程 PRD",
    extraInstructions: "避免破坏性操作",
    pages: [{ url: "https://demo.test/", title: "首页", aiSummary: "商品列表", elementNames: ["加购按钮"] }],
    aiConfig: { provider: "openai", endpointType: "chat", apiKey: "sk-test", model: "test" } as unknown as StartPlanInput["aiConfig"],
    ...overrides,
  };
}

function collect(manager: PlanManager, jobId: string): PlanEvent[] {
  const events: PlanEvent[] = [];
  manager.subscribe(jobId, (event) => events.push(event));
  return events;
}

async function waitDone(events: PlanEvent[]): Promise<void> {
  for (let i = 0; i < 100 && !events.some((e) => e.kind === "done"); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("PlanManager", () => {
  it("生成流程：stage 顺序 generate→validate→done，提案带批次/来源/默认勾选落库", async () => {
    const { batches, deps } = makeRepo();
    let received: ChatMessage[][] = [];
    const manager = new PlanManager({
      ...deps,
      createChatCaller: () => async (messages) => {
        received.push(messages);
        return VALID_OUTPUT;
      },
    });
    const job = manager.startGenerate(makeInput());
    const events = collect(manager, job.id);
    await waitDone(events);

    expect(events.filter((e) => e.kind === "stage").map((e) => (e.kind === "stage" ? e.stage : ""))).toEqual([
      "generate",
      "validate",
      "done",
    ]);
    expect(received).toHaveLength(1);
    expect(received[0][0].content).toContain("测试架构师");
    expect(received[0][1].content).toContain("购物流程 PRD");
    expect(received[0][1].content).toContain("避免破坏性操作");

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0][0]).toMatchObject({
      projectId: "proj-1",
      batchId: job.batchId,
      sourceId: "src-1",
      included: true,
      status: "proposed",
    });
    const done = events.find((e) => e.kind === "done");
    expect(done && done.kind === "done" ? done.summary?.created : null).toBe(2);
    expect(done && done.kind === "done" ? done.summary?.useCases : null).toBe(2);
    expect(manager.getJob(job.id)?.stage).toBe("done");
  });

  it("整体校验失败带错误重试一次，第二次合法即成功", async () => {
    const { deps } = makeRepo();
    const calls: ChatMessage[][] = [];
    const manager = new PlanManager({
      ...deps,
      createChatCaller: () => async (messages) => {
        calls.push(messages);
        return calls.length === 1 ? "完全不是 JSON" : VALID_OUTPUT;
      },
    });
    const job = manager.startGenerate(makeInput());
    const events = collect(manager, job.id);
    await waitDone(events);

    expect(calls).toHaveLength(2);
    expect(calls[1][2]?.content).toContain("未通过校验");
    expect(events.some((e) => e.kind === "done")).toBe(true);
    expect(manager.getJob(job.id)?.error).toBeUndefined();
  });

  it("两次输出均非法：error + done 事件收尾，job 记错误", async () => {
    const { batches, deps } = makeRepo();
    const manager = new PlanManager({ ...deps, createChatCaller: () => async () => "垃圾输出" });
    const job = manager.startGenerate(makeInput());
    const events = collect(manager, job.id);
    await waitDone(events);

    expect(batches).toHaveLength(0);
    expect(events.some((e) => e.kind === "error")).toBe(true);
    expect(events.some((e) => e.kind === "done")).toBe(true);
    expect(manager.getJob(job.id)?.error).toContain("提案生成失败");
  });

  it("逐项非法丢弃：合法项照常落库，warn 日志带丢弃说明", async () => {
    const { batches, deps } = makeRepo();
    const output = JSON.stringify({
      proposals: [
        { ...JSON.parse(VALID_OUTPUT).proposals[0] },
        { useCase: "x", title: "", goal: "g", expected: ["e"], estSteps: ["s"] },
      ],
    });
    const manager = new PlanManager({ ...deps, createChatCaller: () => async () => output });
    const job = manager.startGenerate(makeInput());
    const events = collect(manager, job.id);
    await waitDone(events);

    expect(batches[0]).toHaveLength(1);
    const done = events.find((e) => e.kind === "done");
    expect(done && done.kind === "done" ? done.summary?.dropped : null).toBe(1);
    expect(
      events.some((e) => e.kind === "log" && e.level === "warn" && e.text.includes("丢弃")),
    ).toBe(true);
  });

  it("订阅回放：后订阅者能拿到已缓冲事件", async () => {
    const { deps } = makeRepo();
    const manager = new PlanManager({ ...deps, createChatCaller: () => async () => VALID_OUTPUT });
    const job = manager.startGenerate(makeInput());
    await waitDone(collect(manager, job.id));

    const replayed: PlanEvent[] = [];
    manager.subscribe(job.id, (e) => replayed.push(e));
    expect(replayed.some((e) => e.kind === "stage" && e.stage === "generate")).toBe(true);
    expect(replayed.some((e) => e.kind === "done")).toBe(true);
  });
});
