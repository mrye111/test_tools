import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAnalysisRepository } from "./repository.js";

// mock AI 模块：streamChatCompletionParts 按脚本队列产出响应
vi.mock("../testcase/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../testcase/ai.js")>("../testcase/ai.js");
  return { ...actual, streamChatCompletionParts: vi.fn() };
});

import { streamChatCompletionParts } from "../testcase/ai.js";
import { analyzeRequirement, AnalysisGenerateError, validateAnalysis } from "./analyze.js";
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

const VALID_ANALYSIS = JSON.stringify({
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
  conditions: [
    { reqId: "r1", text: "5 次错误触发锁定", kind: "normal" },
    { reqId: "r1", text: "第 4 次仍可登录", kind: "boundary" },
  ],
});

beforeEach(() => {
  mockStream.mockReset();
});

describe("validateAnalysis 校验", () => {
  it("合法输出通过并补默认状态", () => {
    const result = validateAnalysis(JSON.parse(VALID_ANALYSIS), SOURCE);
    expect(result.errors).toBeUndefined();
    expect(result.analysis!.issues[0].status).toBe("open");
    expect(result.analysis!.conditions[0].relay).toBe("none");
  });

  it("结构错误逐个报出：空条目/非法枚举/悬空引用", () => {
    const result = validateAnalysis(
      {
        title: "x",
        requirements: [],
        issues: [{ type: "weird", severity: "high", quote: "q", description: "d" }],
        conditions: [{ reqId: "ghost", text: "x", kind: "normal" }],
      },
      SOURCE,
    );
    expect(result.analysis).toBeUndefined();
    expect(result.errors!.join()).toContain("requirements 为空");
    expect(result.errors!.join()).toContain("type 非法");
    expect(result.errors!.join()).toContain("不存在的需求条目: ghost");
  });

  it("数据诚实：quote 无法在原文溯源则拒绝", () => {
    const parsed = JSON.parse(VALID_ANALYSIS);
    parsed.issues[0].quote = "原文里根本没有这句话";
    const result = validateAnalysis(parsed, SOURCE);
    expect(result.errors!.join()).toContain("无法在需求原文中找到");
  });

  it("quote 溯源容忍空白与中文引号差异", () => {
    const parsed = JSON.parse(VALID_ANALYSIS);
    parsed.issues[0].quote = "「连续输错密码后 账号锁定」";
    const result = validateAnalysis(parsed, SOURCE);
    expect(result.errors).toBeUndefined();
  });
});

describe("analyzeRequirement 管线", () => {
  it("一次通过：分析→校验→落库，done 事件带记录", async () => {
    scriptResponses(VALID_ANALYSIS);
    const repo = new MemoryAnalysisRepository();
    const events: string[] = [];
    const record = await analyzeRequirement(aiConfig, repo, { sourceText: SOURCE }, (e) => events.push(e.type));

    expect(record.title).toBe("登录需求分析");
    expect(record.issues).toHaveLength(1);
    expect(record.conditions).toHaveLength(2);
    expect(events).toEqual(["progress", "progress", "done"]);
    expect(await repo.countRecords()).toBe(1);
  });

  it("校验失败修复重试一次后成功", async () => {
    scriptResponses("这不是 JSON", VALID_ANALYSIS);
    const repo = new MemoryAnalysisRepository();
    const record = await analyzeRequirement(aiConfig, repo, { sourceText: SOURCE });
    expect(record.issues).toHaveLength(1);
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("两次都不合格抛 AnalysisGenerateError，不落库", async () => {
    scriptResponses("bad json", JSON.stringify({ requirements: [] }));
    const repo = new MemoryAnalysisRepository();
    await expect(analyzeRequirement(aiConfig, repo, { sourceText: SOURCE })).rejects.toThrow(AnalysisGenerateError);
    expect(await repo.countRecords()).toBe(0);
  });

  it("titleHint 覆盖 AI 标题", async () => {
    scriptResponses(VALID_ANALYSIS);
    const repo = new MemoryAnalysisRepository();
    const record = await analyzeRequirement(aiConfig, repo, { sourceText: SOURCE, titleHint: "  自定义标题  " });
    expect(record.title).toBe("自定义标题");
  });
});
