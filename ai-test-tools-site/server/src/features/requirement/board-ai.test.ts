import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../testcase/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../testcase/ai.js")>("../testcase/ai.js");
  return { ...actual, streamChatCompletionParts: vi.fn() };
});

import { streamChatCompletionParts } from "../testcase/ai.js";
import { generateBoardChartDraft, BoardDraftParseError } from "./board-ai.js";
import type { AiRequestConfig } from "../testcase/types.js";

const config = { endpointType: "openai", baseUrl: "https://x", apiKey: "k", model: "m" } as unknown as AiRequestConfig;
const input = { nodeTitle: "第4步-分发问卷", nodeSubtreeText: "短信≤210字+变量……", chartKind: "cause-effect" as const };

afterEach(() => {
  vi.clearAllMocks();
});

function mockStream(outputs: string[]) {
  let call = 0;
  vi.mocked(streamChatCompletionParts).mockImplementation(async function* () {
    const text = outputs[Math.min(call, outputs.length - 1)];
    call += 1;
    yield { type: "content" as const, text };
  });
}

describe("generateBoardChartDraft", () => {
  it("一次成功：解析 content 片段为 JSON draft", async () => {
    mockStream(['{"nodes":[{"role":"cause","text":"A"}],"edges":[]}]']);
    const draft = await generateBoardChartDraft(config, input);
    expect(draft).toMatchObject({ nodes: [{ role: "cause", text: "A" }] });
  });

  it("首次输出非 JSON → 修复重试一次后成功", async () => {
    mockStream(["无法解析的垃圾", '{"nodes":[],"edges":[]}']);
    const draft = await generateBoardChartDraft(config, input);
    expect(draft).toMatchObject({ nodes: [] });
    expect(vi.mocked(streamChatCompletionParts)).toHaveBeenCalledTimes(2);
  });

  it("两次都失败 → 抛 BoardDraftParseError", async () => {
    mockStream(["垃圾1", "垃圾2"]);
    await expect(generateBoardChartDraft(config, input)).rejects.toBeInstanceOf(BoardDraftParseError);
  });
});
