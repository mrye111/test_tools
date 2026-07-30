import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../testcase/ai.js", async () => {
  const actual = await vi.importActual<typeof import("../testcase/ai.js")>("../testcase/ai.js");
  return { ...actual, streamChatCompletionParts: vi.fn() };
});

import { streamChatCompletionParts } from "../testcase/ai.js";
import { generateBoardChartDraft, BoardDraftParseError } from "./board-ai.js";
import { buildBoardChartMessages } from "./board-prompts.js";
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

describe("buildBoardChartMessages flowchart", () => {
  it("应包含 flowchart 的 nodes/edges 契约", () => {
    const messages = buildBoardChartMessages({
      nodeTitle: "登录流程",
      nodeSubtreeText: "用户输入账号密码，验证通过后进入首页",
      chartKind: "flowchart",
    });
    expect(messages).toHaveLength(2);
    const system = messages[0].content;
    expect(system).toContain("流程图");
    expect(system).toContain('"nodes"');
    expect(system).toContain('"edges"');
    expect(system).toContain('"kind"');
    expect(system).toContain('"process"');
    expect(system).toContain('"decision"');
    expect(system).toContain("start");
    expect(system).toContain("end");
    expect(system).toContain("≤60");
    expect(system).toContain("≤200");
  });
});

describe("generateBoardChartDraft", () => {
  it("一次成功：解析 content 片段为 JSON draft", async () => {
    mockStream(['{"nodes":[{"role":"cause","text":"A"}],"edges":[]}]']);
    const draft = await generateBoardChartDraft(config, input);
    expect(draft).toMatchObject({ nodes: [{ role: "cause", text: "A" }] });
  });

  it("首次输出非 JSON → 修复重试一次后成功", async () => {
    mockStream(["无法解析的垃圾", '{"nodes":[],"edges":[]}]']);
    const draft = await generateBoardChartDraft(config, input);
    expect(draft).toMatchObject({ nodes: [] });
    expect(vi.mocked(streamChatCompletionParts)).toHaveBeenCalledTimes(2);
  });

  it("两次都失败 → 抛 BoardDraftParseError", async () => {
    mockStream(["垃圾1", "垃圾2"]);
    await expect(generateBoardChartDraft(config, input)).rejects.toBeInstanceOf(BoardDraftParseError);
  });

  it("flowchart：解析合法流程图 JSON 为 draft", async () => {
    mockStream([
      JSON.stringify({
        nodes: [
          { id: "start", text: "开始", kind: "start", x: 0, y: 0 },
          { id: "check", text: "验证通过？", kind: "decision", x: 1, y: 0 },
          { id: "home", text: "进入首页", kind: "process", x: 2, y: 0 },
          { id: "end", text: "结束", kind: "end", x: 3, y: 0 },
        ],
        edges: [
          { from: "start", to: "check" },
          { from: "check", to: "home", label: "是" },
          { from: "check", to: "end", label: "否" },
        ],
      }),
    ]);
    const draft = await generateBoardChartDraft(config, {
      nodeTitle: "登录流程",
      nodeSubtreeText: "用户输入账号密码，验证通过后进入首页",
      chartKind: "flowchart",
    });
    expect(draft).toMatchObject({
      nodes: [
        { id: "start", text: "开始", kind: "start", x: 0, y: 0 },
        { id: "check", text: "验证通过？", kind: "decision", x: 1, y: 0 },
        { id: "home", text: "进入首页", kind: "process", x: 2, y: 0 },
        { id: "end", text: "结束", kind: "end", x: 3, y: 0 },
      ],
      edges: [
        { from: "start", to: "check" },
        { from: "check", to: "home", label: "是" },
        { from: "check", to: "end", label: "否" },
      ],
    });
  });
});
