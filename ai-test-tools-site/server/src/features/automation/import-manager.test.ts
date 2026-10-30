import { describe, expect, it, vi } from "vitest";
import type { AnalysisRecordDetail, TestCondition } from "../requirement-v2/types.js";
import type { TestCaseStore } from "../testcase/store.js";
import type { GenerateJobRecord, TestSetRecord } from "../testcase/types.js";
import { ImportManager, type ImportEvent } from "./import-manager.js";
import type { NewAutomationCase } from "./types.js";

const HEADER = ["用例编号", "标题", "前置条件", "测试步骤", "预期结果"];

function makeCondition(id: string): TestCondition {
  return {
    id,
    recordId: "ra2_1",
    reqId: "rreq_1",
    criterionId: null,
    text: `条件 ${id}`,
    kind: "normal",
    relay: "none",
    testsetId: null,
    sort: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeRecord(conditions: TestCondition[]): AnalysisRecordDetail {
  const at = new Date();
  return {
    id: "ra2_1",
    title: "订单结算",
    sourceFileName: null,
    sourceText: "作为买家，我希望结算时能看到优惠明细。",
    previousRecordId: null,
    inheritedIssueCount: 0,
    createdAt: at,
    updatedAt: at,
    requirements: [],
    issues: [],
    criteria: [],
    conditions,
  };
}

/** 生成功能用例集行（runGeneration 替身写进 store 的假 job 结果）。 */
function generatedRows(count: number): { header: string[]; rows: string[][] } {
  return {
    header: HEADER,
    rows: Array.from({ length: count }, (_, i) => [
      `TC-${String(i + 1).padStart(3, "0")}`,
      `用例 ${i + 1}`,
      "已登录",
      "1. 点击结算",
      "1. 显示优惠明细",
    ]),
  };
}

/** 可过 validateCompiledPlan 的最小合法编译输出。 */
const OK_PLAN = JSON.stringify({
  executable: "full",
  variables: [],
  setup: [{ type: "navigate", url: "https://example.com" }],
  instructions: [{ id: 1, type: "act", text: "点击【结算】", fromStep: 1 }],
  manualItems: [],
  compileNotes: [],
});

type Harness = {
  manager: ImportManager;
  timeline: string[];
  events: ImportEvent[];
  createdCases: NewAutomationCase[];
  generatedCalls: string[];
  linked: Array<{ conditionIds: string[]; testsetId: string }>;
  chatCalls: number;
  maxConcurrentChat: number;
};

function makeHarness(
  options: {
    rowCount?: number;
    conditions?: TestCondition[];
    /** 该编号的用例落库时抛错。 */
    failCreateCase?: string;
    /** 其 user 消息含该标题的 LLM 调用返回无法解析的输出（走降级直映）。 */
    garbageChatTitle?: string;
    compileConcurrency?: number;
    chatDelayMs?: number;
  } = {},
): Harness {
  const rowCount = options.rowCount ?? 3;
  const conditions = options.conditions ?? [makeCondition("c1"), makeCondition("c2")];
  const timeline: string[] = [];
  const events: ImportEvent[] = [];
  const createdCases: NewAutomationCase[] = [];
  const generatedCalls: string[] = [];
  const linked: Array<{ conditionIds: string[]; testsetId: string }> = [];
  let chatCalls = 0;
  let inFlightChat = 0;
  let maxConcurrentChat = 0;

  const jobById = new Map<string, GenerateJobRecord>();
  const testcaseStore = {
    upsertTestSet: vi.fn((set: TestSetRecord) => set),
    createJob: vi.fn((job: GenerateJobRecord) => {
      jobById.set(job.id, job);
    }),
    getJob: vi.fn((id: string) => jobById.get(id)),
  } as unknown as TestCaseStore;

  const manager = new ImportManager({
    analysisRepo: {
      getRecord: async () => makeRecord(conditions),
      markConditionsGenerated: async (conditionIds, testsetId) => {
        timeline.push("link");
        linked.push({ conditionIds, testsetId });
        return conditionIds.length;
      },
    },
    automationRepo: {
      createCase: async (input) => {
        timeline.push(`case:${input.sourceFunctionalCaseId}`);
        if (input.sourceFunctionalCaseId === options.failCreateCase) throw new Error("落库失败");
        createdCases.push(input);
        return { id: `atc-${createdCases.length}`, caseNo: "ATC-001", ...input } as never;
      },
      getCompiledCache: async () => null,
      putCompiledCache: async () => undefined,
    },
    testcaseStore,
    runGeneration: async (jobId) => {
      generatedCalls.push(jobId);
      timeline.push("generate-done");
      const { header, rows } = generatedRows(rowCount);
      jobById.set(jobId, {
        ...(jobById.get(jobId) as GenerateJobRecord),
        status: "completed",
        resultHeader: header,
        resultRows: rows,
      });
    },
    createChatCaller: () => async (messages) => {
      timeline.push("chat");
      inFlightChat += 1;
      maxConcurrentChat = Math.max(maxConcurrentChat, inFlightChat);
      try {
        if (options.chatDelayMs) await new Promise((r) => setTimeout(r, options.chatDelayMs));
        chatCalls += 1;
        const hitGarbage = options.garbageChatTitle
          ? messages.some((m) => m.content.includes(options.garbageChatTitle as string))
          : false;
        return hitGarbage ? "这不是 JSON" : OK_PLAN;
      } finally {
        inFlightChat -= 1;
      }
    },
    compileConcurrency: options.compileConcurrency,
    jobTtlMs: 60_000,
  });
  return {
    manager,
    timeline,
    events,
    createdCases,
    generatedCalls,
    linked,
    get chatCalls() {
      return chatCalls;
    },
    get maxConcurrentChat() {
      return maxConcurrentChat;
    },
  };
}

async function runToDone(manager: ImportManager, importId: string, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const job = manager.getJob(importId);
    if (job?.stage === "done") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("导入任务超时未完成");
}

describe("ImportManager", () => {
  it("按 generate → link → compile → done 四段推进", async () => {
    const h = makeHarness();
    const job = h.manager.startImport({
      recordId: "ra2_1",
      conditionIds: ["c1", "c2"],
      projectId: "p1",
      entryUrl: "https://example.com",
      aiConfig: { apiKey: "k", model: "m", baseUrl: "http://ai.test/v1", provider: "codex", endpointType: "openai_chat" },
    });
    h.manager.subscribe(job.id, (e) => h.events.push(e));
    await runToDone(h.manager, job.id);

    const stages = h.events.filter((e) => e.kind === "stage").map((e) => (e as { stage: string }).stage);
    expect(stages).toEqual(["generate", "link", "compile", "done"]);
  });

  it("条件回写发生在编译落库之前（RTM 语义：生成用例集即算覆盖）", async () => {
    const h = makeHarness();
    const job = h.manager.startImport({
      recordId: "ra2_1",
      conditionIds: ["c1", "c2"],
      projectId: "p1",
      entryUrl: "https://example.com",
      aiConfig: { apiKey: "k", model: "m", baseUrl: "http://ai.test/v1", provider: "codex", endpointType: "openai_chat" },
    });
    await runToDone(h.manager, job.id);

    expect(h.linked).toHaveLength(1);
    expect(h.linked[0].conditionIds).toEqual(["c1", "c2"]);
    expect(h.timeline.indexOf("link")).toBeGreaterThanOrEqual(0);
    expect(h.timeline.indexOf("link")).toBeLessThan(h.timeline.findIndex((t) => t.startsWith("case:")));
  });

  it("单条落库失败进 failed，整批继续不中断", async () => {
    const h = makeHarness({ rowCount: 3, failCreateCase: "TC-002" });
    const job = h.manager.startImport({
      recordId: "ra2_1",
      conditionIds: ["c1"],
      projectId: "p1",
      entryUrl: "https://example.com",
      aiConfig: { apiKey: "k", model: "m", baseUrl: "http://ai.test/v1", provider: "codex", endpointType: "openai_chat" },
    });
    await runToDone(h.manager, job.id);

    const summary = h.manager.getJob(job.id)?.summary;
    expect(summary?.created).toBe(2);
    expect(summary?.failed).toHaveLength(1);
    expect(summary?.failed[0].caseId).toBe("TC-002");
  });

  it("LLM 输出无法解析时降级直映仍落库并计入 fallback，不进 failed", async () => {
    const h = makeHarness({ rowCount: 2, garbageChatTitle: "用例 1" });
    const job = h.manager.startImport({
      recordId: "ra2_1",
      conditionIds: ["c1"],
      projectId: "p1",
      entryUrl: "https://example.com",
      aiConfig: { apiKey: "k", model: "m", baseUrl: "http://ai.test/v1", provider: "codex", endpointType: "openai_chat" },
    });
    await runToDone(h.manager, job.id);

    const summary = h.manager.getJob(job.id)?.summary;
    expect(summary?.created).toBe(2);
    expect(summary?.failed).toEqual([]);
    expect(summary?.fallback).toBe(1);
  });

  it("进度事件单调递增且收尾时 done === total", async () => {
    const h = makeHarness({ rowCount: 4 });
    const job = h.manager.startImport({
      recordId: "ra2_1",
      conditionIds: ["c1"],
      projectId: "p1",
      entryUrl: "https://example.com",
      aiConfig: { apiKey: "k", model: "m", baseUrl: "http://ai.test/v1", provider: "codex", endpointType: "openai_chat" },
    });
    h.manager.subscribe(job.id, (e) => h.events.push(e));
    await runToDone(h.manager, job.id);

    const progress = h.events.filter((e) => e.kind === "progress") as Array<{ done: number; total: number }>;
    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i++) expect(progress[i].done).toBeGreaterThanOrEqual(progress[i - 1].done);
    expect(progress[progress.length - 1].done).toBe(4);
    expect(progress[progress.length - 1].total).toBe(4);
  });

  it("LLM 并发不超过闸门宽度", async () => {
    const h = makeHarness({ rowCount: 6, compileConcurrency: 2, chatDelayMs: 15 });
    const job = h.manager.startImport({
      recordId: "ra2_1",
      conditionIds: ["c1"],
      projectId: "p1",
      entryUrl: "https://example.com",
      aiConfig: { apiKey: "k", model: "m", baseUrl: "http://ai.test/v1", provider: "codex", endpointType: "openai_chat" },
    });
    await runToDone(h.manager, job.id);

    expect(h.chatCalls).toBe(6);
    expect(h.maxConcurrentChat).toBeLessThanOrEqual(2);
  });

  it("没有可用测试条件时报错并发出 error 事件", async () => {
    const h = makeHarness({ conditions: [makeCondition("c1")] });
    const job = h.manager.startImport({
      recordId: "ra2_1",
      conditionIds: ["不存在的条件"],
      projectId: "p1",
      entryUrl: "https://example.com",
      aiConfig: { apiKey: "k", model: "m", baseUrl: "http://ai.test/v1", provider: "codex", endpointType: "openai_chat" },
    });
    h.manager.subscribe(job.id, (e) => h.events.push(e));
    await runToDone(h.manager, job.id);

    expect(h.manager.getJob(job.id)?.error).toContain("没有可用的测试条件");
    expect(h.events.some((e) => e.kind === "error")).toBe(true);
    expect(h.linked).toHaveLength(0);
  });
});
