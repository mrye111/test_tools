import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAnalysisRepository } from "./repository.js";

// mock AI 模块：streamChatCompletionParts 按脚本队列产出响应
vi.mock("../testcase/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../testcase/ai.js")>("../testcase/ai.js");
  return { ...actual, streamChatCompletionParts: vi.fn() };
});

import { streamChatCompletionParts } from "../testcase/ai.js";
import { analyzeRequirement, AnalysisGenerateError, validateAnalysis, validateConditionsBatch } from "./analyze.js";
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

  it("titleHint 覆盖 AI 标题", async () => {
    scriptResponses(PASS_ONE, BATCH_CONDITIONS);
    const repo = new MemoryAnalysisRepository();
    const record = await analyzeRequirement(aiConfig, repo, { sourceText: SOURCE, titleHint: "  自定义标题  " });
    expect(record.title).toBe("自定义标题");
  });
});
