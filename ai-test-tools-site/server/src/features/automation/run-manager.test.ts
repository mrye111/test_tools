import { describe, expect, it, vi } from "vitest";
import { MemoryAutomationRepository } from "./memory-repository.js";
import { RunManager } from "./run-manager.js";
import type { AgentSession, SessionFactory } from "./runner.js";
import type { AutomationCase, AutomationStep, RunEvent } from "./types.js";

const STEPS: AutomationStep[] = [
  { id: 1, type: "act", text: "点击【登录】", enabled: true },
  { id: 2, type: "assert", text: "显示首页昵称", enabled: true },
];

function makeCase(overrides: Partial<AutomationCase> = {}): AutomationCase {
  return {
    id: "case-1",
    projectId: "p1",
    caseNo: "ATC-001",
    title: "登录",
    source: "manual",
    entryUrl: "https://staging.example.com/login",
    preconditionText: "",
    varDefs: {},
    steps: STEPS,
    manualItems: [],
    executable: "full",
    lastRunStatus: "never",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function instantFactory(delayMs = 0): SessionFactory {
  return async () => {
    const session: AgentSession = {
      agent: {
        aiAct: async () => {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        },
        aiAssert: async () => undefined,
        aiQuery: async () => ({ value: "v" }),
        aiWaitFor: async () => undefined,
        destroy: async () => undefined,
        reportFile: "/tmp/r.html",
      },
      goto: async () => undefined,
      close: async () => "/tmp/r.html",
    };
    return session;
  };
}

async function waitForDone(manager: RunManager, runId: string, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (manager.getRun(runId)?.status === "done") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("运行超时未完成");
}

describe("RunManager - 生命周期", () => {
  it("用例执行：queued→running→done，结果持久化并回写用例状态", async () => {
    const repo = new MemoryAutomationRepository();
    const created = await repo.createCase({ projectId: "p1", title: "登录", steps: STEPS });
    const manager = new RunManager({ repo, sessionFactory: instantFactory(), concurrency: 3 });

    const record = await manager.startRun({ kind: "case", automationCase: makeCase({ id: created.id }) });
    // pump 同步推进，返回时可能已从 queued 进入 running
    expect(["queued", "running"]).toContain(record.status);
    expect(record.cacheId).toBe(`case-${created.id}`);

    await waitForDone(manager, record.id);
    const done = manager.getRun(record.id);
    expect(done?.status).toBe("done");
    expect(done?.verdict).toBe("passed");
    expect(done?.stepResults).toHaveLength(2);
    expect(done?.reportFile).toBe("/tmp/r.html");

    // 持久化
    const persisted = await repo.getRunRecord(record.id);
    expect(persisted?.verdict).toBe("passed");
    // 回写用例
    const updatedCase = await repo.getCase(created.id);
    expect(updatedCase?.lastRunStatus).toBe("passed");
    expect(updatedCase?.lastRunAt).toBeTruthy();
  });

  it("onDone 回调收到最终记录", async () => {
    const repo = new MemoryAutomationRepository();
    const manager = new RunManager({ repo, sessionFactory: instantFactory() });
    const onDone = vi.fn();
    const record = await manager.startRun({ kind: "case", automationCase: makeCase(), onDone });
    await waitForDone(manager, record.id);
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone.mock.calls[0][0].verdict).toBe("passed");
  });

  it("batchId 透传到运行记录并持久化（套件批次聚合的数据基础）", async () => {
    const repo = new MemoryAutomationRepository();
    const manager = new RunManager({ repo, sessionFactory: instantFactory() });
    const r1 = await manager.startRun({ kind: "case", automationCase: makeCase({ id: "c1" }), batchId: "batch-1" });
    const r2 = await manager.startRun({ kind: "case", automationCase: makeCase({ id: "c2" }), batchId: "batch-1" });
    const r3 = await manager.startRun({ kind: "case", automationCase: makeCase({ id: "c3" }) });
    await waitForDone(manager, r1.id);
    await waitForDone(manager, r2.id);
    await waitForDone(manager, r3.id);

    const batch = await repo.listRunsByBatch("batch-1");
    expect(batch.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());
    // 无批次的运行不出现在聚合里
    expect(batch.some((r) => r.id === r3.id)).toBe(false);
  });
});

describe("RunManager - 并发与串行", () => {
  it("同用例串行：第二个同 caseId 运行排队等第一个完成", async () => {
    const repo = new MemoryAutomationRepository();
    const manager = new RunManager({ repo, sessionFactory: instantFactory(80), concurrency: 3 });
    const order: string[] = [];
    const onDone = (tag: string) => () => { order.push(tag); };

    const r1 = await manager.startRun({ kind: "case", automationCase: makeCase(), onDone: onDone("first") });
    const r2 = await manager.startRun({ kind: "case", automationCase: makeCase(), onDone: onDone("second") });
    await waitForDone(manager, r1.id);
    await waitForDone(manager, r2.id);
    expect(order).toEqual(["first", "second"]);
  });

  it("全局并发闸：concurrency=1 时不同用例也串行", async () => {
    const repo = new MemoryAutomationRepository();
    const manager = new RunManager({ repo, sessionFactory: instantFactory(60), concurrency: 1 });
    const r1 = await manager.startRun({ kind: "case", automationCase: makeCase({ id: "c1" }) });
    const r2 = await manager.startRun({ kind: "case", automationCase: makeCase({ id: "c2" }) });
    await waitForDone(manager, r1.id);
    await waitForDone(manager, r2.id);
    const s1 = new Date(manager.getRun(r1.id)!.finishedAt!).getTime();
    const s2 = new Date(manager.getRun(r2.id)!.startedAt!).getTime();
    expect(s2).toBeGreaterThanOrEqual(s1 - 50); // 第二个在第一个结束后才开始（容忍时钟粒度）
  });

  it("排队中中止：直接标 aborted 不执行", async () => {
    const repo = new MemoryAutomationRepository();
    const manager = new RunManager({ repo, sessionFactory: instantFactory(200), concurrency: 1 });
    const r1 = await manager.startRun({ kind: "case", automationCase: makeCase({ id: "c1" }) });
    const r2 = await manager.startRun({ kind: "case", automationCase: makeCase({ id: "c2" }) });
    expect(manager.abortRun(r2.id)).toBe(true);
    await waitForDone(manager, r2.id);
    expect(manager.getRun(r2.id)?.verdict).toBe("aborted");
    await waitForDone(manager, r1.id);
    expect(manager.getRun(r1.id)?.verdict).toBe("passed");
  });
});

describe("RunManager - 事件订阅", () => {
  it("回放 + 直播：后订阅者也能看到完整步骤序列", async () => {
    const repo = new MemoryAutomationRepository();
    const manager = new RunManager({ repo, sessionFactory: instantFactory() });
    const record = await manager.startRun({ kind: "case", automationCase: makeCase() });
    await waitForDone(manager, record.id);

    const replayed: RunEvent[] = [];
    manager.subscribe(record.id, (e) => replayed.push(e));
    const kinds = replayed.map((e) => e.kind);
    expect(kinds).toContain("status");
    expect(kinds).toContain("step-start");
    expect(kinds).toContain("step-done");
    expect(kinds).toContain("verdict");
    // 步骤顺序保持
    const starts = replayed.filter((e) => e.kind === "step-start").map((e) => (e as { stepId: number }).stepId);
    expect(starts).toEqual([1, 2]);
  });
});
