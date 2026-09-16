import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAnalysisRepository } from "./repository.js";
import { makeInput } from "./repository-contract.test.js";

// mock AI 模块：streamChatCompletionParts 按脚本队列产出响应
vi.mock("../testcase/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../testcase/ai.js")>("../testcase/ai.js");
  return { ...actual, streamChatCompletionParts: vi.fn() };
});

import { streamChatCompletionParts } from "../testcase/ai.js";
import { analyzeRequirement, AnalysisGenerateError, reanalyzeRequirement, validateAnalysis, validateConditionsBatch } from "./analyze.js";
import type { AiRequestConfig } from "../testcase/types.js";

const mockStream = vi.mocked(streamChatCompletionParts);

const aiConfig: AiRequestConfig = {
  provider: "codex",
  endpointType: "openai_chat",
  baseUrl: "http://ai.test/v1",
  apiKey: "test-key",
  model: "test-model",
  isLocalModel: false,
};

function scriptResponses(...responses: string[]) {
  for (const text of responses) {
    mockStream.mockImplementationOnce(async function* () {
      yield { type: "content" as const, text };
    });
  }
}

const SOURCE = "用户登录：连续输错密码后账号锁定。登录失败时给出友好提示。支持多端登录。";

const PASS_ONE = JSON.stringify({
  title: "登录需求分析",
  requirements: [
    { id: "r1", parentId: null, level: 0, text: "账号锁定" },
    { id: "r2", parentId: null, level: 0, text: "失败提示" },
  ],
  issues: [
    {
      reqId: "r1",
      type: "missing",
      severity: "high",
      quote: "连续输错密码后账号锁定",
      description: "未说明锁定阈值与时长",
      suggestedQuestion: "错误几次触发锁定？",
    },
  ],
  criteria: [
    { reqId: "r1", originalText: "连续输错密码后账号锁定", rewrittenText: "10 分钟内连续 5 次错误 → 锁定 30 分钟" },
  ],
});

const BATCH_CONDITIONS = JSON.stringify({
  conditions: [
    { reqId: "r1", text: "5 次错误触发锁定", kind: "normal" },
    { reqId: "r1", text: "第 4 次仍可登录", kind: "boundary" },
    { reqId: "r2", text: "错误条 1s 内展示", kind: "normal" },
  ],
});

beforeEach(() => {
  mockStream.mockReset();
});

describe("validateAnalysis（阶段一）", () => {
  it("合法输出通过并补默认状态", () => {
    const result = validateAnalysis(JSON.parse(PASS_ONE), SOURCE);
    expect(result.errors).toBeUndefined();
    expect(result.analysis!.issues[0].status).toBe("open");
  });

  it("结构错误逐个报出：空条目/非法枚举", () => {
    const result = validateAnalysis(
      { title: "x", requirements: [], issues: [{ type: "weird", severity: "high", quote: "q", description: "d" }] },
      SOURCE,
    );
    expect(result.analysis).toBeUndefined();
    expect(result.errors!.join()).toContain("requirements 为空");
    expect(result.errors!.join()).toContain("type 非法");
  });

  it("数据诚实：quote 无法在原文溯源则拒绝", () => {
    const parsed = JSON.parse(PASS_ONE);
    parsed.issues[0].quote = "原文里根本没有这句话";
    const result = validateAnalysis(parsed, SOURCE);
    expect(result.errors!.join()).toContain("无法在需求原文中找到");
  });

  it("quote 溯源容忍空白与中文引号差异", () => {
    const parsed = JSON.parse(PASS_ONE);
    parsed.issues[0].quote = "「连续输错密码后 账号锁定」";
    const result = validateAnalysis(parsed, SOURCE);
    expect(result.errors).toBeUndefined();
  });
});

describe("validateConditionsBatch（阶段二·覆盖导向）", () => {
  const batch = [
    { id: "r1", text: "账号锁定" },
    { id: "r2", text: "失败提示" },
  ];

  it("合法批次通过", () => {
    const result = validateConditionsBatch(JSON.parse(BATCH_CONDITIONS), batch);
    expect(result.errors).toBeUndefined();
    expect(result.conditions).toHaveLength(3);
  });

  it("批次外引用拒绝", () => {
    const result = validateConditionsBatch({ conditions: [{ reqId: "r9", text: "x", kind: "normal" }] }, batch);
    expect(result.errors!.join()).toContain("批次外");
  });

  it("per-req 上限：单条目 5 条条件确定性截断为前 4 条（广度优先）", () => {
    const result = validateConditionsBatch(
      {
        conditions: [
          ...Array.from({ length: 5 }, (_, i) => ({ reqId: "r1", text: `条件${i + 1}`, kind: "normal" })),
          { reqId: "r2", text: "r2 的条件", kind: "normal" },
        ],
      },
      batch,
    );
    expect(result.errors).toBeUndefined();
    expect(result.conditions).toHaveLength(5);
    expect(result.conditions!.filter((c) => c.reqId === "r1")).toHaveLength(4);
    expect(result.conditions![0].text).toBe("条件1");
    expect(result.conditions![3].text).toBe("条件4");
  });

  it("覆盖缺失拒绝：有条目没有任何条件（#31 核心语义）", () => {
    const result = validateConditionsBatch({ conditions: [{ reqId: "r1", text: "x", kind: "normal" }] }, batch);
    expect(result.errors!.join()).toContain("未覆盖任何测试条件: r2");
  });
});

describe("analyzeRequirement 两阶段管线", () => {
  it("小文档：阶段一 + 单批条件 → 落库，done 带记录", async () => {
    scriptResponses(PASS_ONE, BATCH_CONDITIONS);
    const repo = new MemoryAnalysisRepository();
    const events: string[] = [];
    const record = await analyzeRequirement(aiConfig, repo, { sourceText: SOURCE }, (e) => events.push(e.type));

    expect(record.issues).toHaveLength(1);
    expect(record.conditions).toHaveLength(3);
    expect(events).toEqual(["progress", "progress", "progress", "done"]);
    expect(await repo.countRecords()).toBe(1);
  });

  it("阶段一不合格修复重试后成功", async () => {
    scriptResponses("这不是 JSON", PASS_ONE, BATCH_CONDITIONS);
    const repo = new MemoryAnalysisRepository();
    const record = await analyzeRequirement(aiConfig, repo, { sourceText: SOURCE });
    expect(record.issues).toHaveLength(1);
    expect(mockStream).toHaveBeenCalledTimes(3);
  });

  it("阶段一两次都不合格抛错，不落库", async () => {
    scriptResponses("bad json", JSON.stringify({ requirements: [] }));
    const repo = new MemoryAnalysisRepository();
    await expect(analyzeRequirement(aiConfig, repo, { sourceText: SOURCE })).rejects.toThrow(AnalysisGenerateError);
    expect(await repo.countRecords()).toBe(0);
  });

  it("条件批次两次不合格不阻断：该批次条目落入未覆盖，记录仍创建", async () => {
    scriptResponses(PASS_ONE, "bad json", JSON.stringify({ conditions: [{ reqId: "r9", text: "x", kind: "normal" }] }));
    const repo = new MemoryAnalysisRepository();
    const record = await analyzeRequirement(aiConfig, repo, { sourceText: SOURCE });
    expect(record.conditions).toHaveLength(0);
    expect(await repo.countRecords()).toBe(1);
  });

  it("需求条目 > 10 时分多批调用", async () => {
    const many = JSON.stringify({
      title: "大文档",
      requirements: Array.from({ length: 12 }, (_, i) => ({ id: `r${i + 1}`, parentId: null, level: 0, text: `条目${i + 1}` })),
      issues: [],
      criteria: [],
    });
    const batch1 = JSON.stringify({
      conditions: Array.from({ length: 10 }, (_, i) => ({ reqId: `r${i + 1}`, text: `条件${i + 1}`, kind: "normal" })),
    });
    const batch2 = JSON.stringify({
      conditions: [
        { reqId: "r11", text: "条件11", kind: "normal" },
        { reqId: "r12", text: "条件12", kind: "boundary" },
      ],
    });
    scriptResponses(many, batch1, batch2);
    const repo = new MemoryAnalysisRepository();
    const record = await analyzeRequirement(aiConfig, repo, { sourceText: SOURCE });
    expect(record.conditions).toHaveLength(12);
    // 阶段一 1 次 + 条件 2 批
    expect(mockStream).toHaveBeenCalledTimes(3);
  });

  it("条件批次并行：并发数不超过 3，乱序完成仍按批次顺序合并", async () => {
    // 30 条需求 = 3 批；deferred 流模拟并发，记录最大并发数
    const manyReqs = Array.from({ length: 30 }, (_, i) => ({ id: `r${i + 1}`, parentId: null, level: 0, text: `条目${i + 1}` }));
    const passOne = JSON.stringify({ title: "大文档", requirements: manyReqs, issues: [], criteria: [] });

    let activeCalls = 0;
    let maxActiveCalls = 0;
    const gates: Array<() => void> = [];
    mockStream.mockImplementation(async function* () {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      yield { type: "content" as const, text: passOne };
      activeCalls -= 1;
    });
    // 阶段一用第一个 mock；阶段二每批 deferred：先收集 gate，全部启动后逆序放行
    mockStream.mockReset();
    mockStream.mockImplementationOnce(async function* () {
      yield { type: "content" as const, text: passOne };
    });
    for (let b = 0; b < 3; b++) {
      mockStream.mockImplementationOnce(async function* () {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        await new Promise<void>((resolve) => gates.push(resolve));
        const conds = Array.from({ length: 10 }, (_, i) => ({ reqId: `r${b * 10 + i + 1}`, text: `批${b + 1}条件${i + 1}`, kind: "normal" }));
        activeCalls -= 1;
        yield { type: "content" as const, text: JSON.stringify({ conditions: conds }) };
      });
    }

    const repo = new MemoryAnalysisRepository();
    const run = analyzeRequirement(aiConfig, repo, { sourceText: SOURCE });
    // 等 3 批都进入（或并发上限内全部启动）
    await vi.waitFor(() => {
      expect(gates.length).toBe(3);
    });
    expect(maxActiveCalls).toBeLessThanOrEqual(3);
    // 逆序放行：批 3 先完成
    gates[2]();
    await new Promise((r) => setImmediate(r));
    gates[1]();
    await new Promise((r) => setImmediate(r));
    gates[0]();
    const record = await run;
    expect(record.conditions).toHaveLength(30);
    // 合并顺序 = 批次顺序（批1 的条件在最前），与完成顺序无关
    expect(record.conditions[0].text).toBe("批1条件1");
    expect(record.conditions[10].text).toBe("批2条件1");
    expect(record.conditions[20].text).toBe("批3条件1");
  });

  it("重新分析：新记录 + 继承已处理问题 + 旧记录不动", async () => {
    const repo = new MemoryAnalysisRepository();
    // 原文必须包含问题 quote（溯源校验）
    const oldInput = makeInput();
    oldInput.sourceText = "用户登录：连续输错密码后账号锁定。";
    const old = await repo.createRecord(oldInput);
    const oldIssueId = old.issues[0].id;
    await repo.patchIssue(oldIssueId, { status: "resolved" });

    // 新分析产出与旧记录同需求文本、同问题内容 → 继承 resolved
    const passOneSame = JSON.stringify({
      title: "登录需求分析",
      requirements: [
        { id: "x1", parentId: null, level: 0, text: "登录模块" },
        { id: "x2", parentId: "x1", level: 1, text: "账号锁定" },
      ],
      issues: [
        { reqId: "x2", type: "missing", severity: "high", quote: "「连续输错密码后账号锁定」", description: "未说明锁定阈值与时长", suggestedQuestion: "" },
      ],
      criteria: [],
    });
    const batch = JSON.stringify({ conditions: [
      { reqId: "x1", text: "根条件", kind: "normal" },
      { reqId: "x2", text: "锁定条件", kind: "normal" },
    ] });
    scriptResponses(passOneSame, batch);

    const record = await reanalyzeRequirement(aiConfig, repo, { recordId: old.id });
    expect(record.id).not.toBe(old.id);
    expect(record.previousRecordId).toBe(old.id);
    expect(record.inheritedIssueCount).toBe(1);
    expect(record.issues[0].status).toBe("resolved");
    // 旧记录原样
    const oldAfter = await repo.getRecord(old.id);
    expect(oldAfter!.issues).toHaveLength(1);
    expect(await repo.countRecords()).toBe(2);
  });

  it("重新分析：原文不变但问题内容变化的条目不继承", async () => {
    const repo = new MemoryAnalysisRepository();
    const oldInput = makeInput();
    oldInput.sourceText = "用户登录：连续输错密码后账号锁定。";
    const old = await repo.createRecord(oldInput);
    await repo.patchIssue(old.issues[0].id, { status: "accepted" });

    const passOneChanged = JSON.stringify({
      title: "登录需求分析",
      requirements: [
        { id: "x1", parentId: null, level: 0, text: "登录模块" },
        { id: "x2", parentId: "x1", level: 1, text: "账号锁定" },
      ],
      issues: [
        { reqId: "x2", type: "missing", severity: "high", quote: "「连续输错密码后账号锁定」", description: "完全不同的描述", suggestedQuestion: "" },
      ],
      criteria: [],
    });
    // 条件批次的 reqId 必须与本测试的需求 id（x1/x2）一致
    const batchX = JSON.stringify({ conditions: [
      { reqId: "x1", text: "根条件", kind: "normal" },
      { reqId: "x2", text: "锁定条件", kind: "normal" },
    ] });
    scriptResponses(passOneChanged, batchX);
    const record = await reanalyzeRequirement(aiConfig, repo, { recordId: old.id });
    expect(record.inheritedIssueCount).toBe(0);
    expect(record.issues[0].status).toBe("open");
  });

  it("重新分析：记录不存在抛错，不创建新记录", async () => {
    const repo = new MemoryAnalysisRepository();
    await expect(reanalyzeRequirement(aiConfig, repo, { recordId: "missing" })).rejects.toThrow(/不存在/);
    expect(await repo.countRecords()).toBe(0);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("titleHint 覆盖 AI 标题", async () => {
    scriptResponses(PASS_ONE, BATCH_CONDITIONS);
    const repo = new MemoryAnalysisRepository();
    const record = await analyzeRequirement(aiConfig, repo, { sourceText: SOURCE, titleHint: "  自定义标题  " });
    expect(record.title).toBe("自定义标题");
  });
});
