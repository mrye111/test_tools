import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeRequirementText, AnalysisParseError, type RequirementAnalysisEvent } from "./ai.js";
import type { AiRequestConfig } from "../testcase/types.js";

const config: AiRequestConfig = {
  provider: "codex",
  endpointType: "openai_chat",
  baseUrl: "http://ai.test/v1",
  apiKey: "test-key",
  model: "test-model",
  isLocalModel: false,
};

const validPayload = JSON.stringify({
  title: "登录需求",
  tree: { id: "n1", title: "登录需求", children: [{ id: "n2", title: "验证码登录", children: [] }] },
  findings: [{ id: "f1", type: "risk", title: "验证码暴力破解", detail: "未说明错误次数限制", nodeId: "n2" }],
});

/** 新管道走流式 SSE 解析：mock 统一供应商返回 chat.completion chunk 帧序列。 */
function chatSseResponse(deltas: Array<Record<string, unknown>>) {
  const frames = deltas
    .map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
    .join("");
  return new Response(`${frames}data: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function contentSseResponse(content: string) {
  return chatSseResponse([{ content }]);
}

describe("analyzeRequirementText 解析容错", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("首次即返回合法 JSON 时不发起修复重试，content 片段经 onEvent 转发", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(contentSseResponse(validPayload));
    const events: RequirementAnalysisEvent[] = [];

    const result = await analyzeRequirementText(config, "用户通过手机号+验证码登录。", (event) => {
      events.push(event);
    });

    expect(result.title).toBe("登录需求");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "content", text: validPayload }]);
  });

  it("首次输出无法解析时，发出 attempt 分隔并携带上一次输出发起一次修复重试", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(contentSseResponse("抱歉，我无法处理这个文档，请提供更多信息。"))
      .mockResolvedValueOnce(contentSseResponse(validPayload));
    const events: RequirementAnalysisEvent[] = [];

    const result = await analyzeRequirementText(config, "用户通过手机号+验证码登录。", (event) => {
      events.push(event);
    });

    expect(result.title).toBe("登录需求");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCallBody = String((fetchSpy.mock.calls[1][1] as RequestInit).body);
    expect(secondCallBody).toContain("无法解析");
    expect(secondCallBody).toContain("抱歉，我无法处理这个文档");
    const attempts = events.filter((event) => event.type === "attempt");
    expect(attempts).toEqual([{ type: "attempt", reason: "输出无法解析，正在修复重试" }]);
    // 两次尝试的流都保留：第一次的原文片段也在事件流中。
    expect(events[0]).toEqual({ type: "content", text: "抱歉，我无法处理这个文档，请提供更多信息。" });
  });

  it("修复重试仍无法解析时抛出 AnalysisParseError", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(contentSseResponse("不是 JSON"))
      .mockResolvedValueOnce(contentSseResponse("依然不是 JSON"));

    await expect(analyzeRequirementText(config, "需求文本")).rejects.toBeInstanceOf(AnalysisParseError);
  });

  it("首次只有 reasoning（推理耗尽输出额度）时，发出 attempt 并提高输出预算重试一次", async () => {
    const reasoningOnly = chatSseResponse([
      { reasoning_content: "让我思考一下这个需求……（思考内容占满了输出额度）" },
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(reasoningOnly)
      .mockResolvedValueOnce(contentSseResponse(validPayload));
    const events: RequirementAnalysisEvent[] = [];

    const result = await analyzeRequirementText(config, "用户通过手机号+验证码登录。", (event) => {
      events.push(event);
    });

    expect(result.title).toBe("登录需求");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as { max_tokens: number };
    const secondBody = JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body)) as { max_tokens: number };
    expect(secondBody.max_tokens).toBeGreaterThan(firstBody.max_tokens);
    // reasoning 片段实时转发，但不参与正文解析；重试边界有 attempt 分隔。
    expect(events[0]).toEqual({ type: "reasoning", text: "让我思考一下这个需求……（思考内容占满了输出额度）" });
    expect(events.filter((event) => event.type === "attempt"))
      .toEqual([{ type: "attempt", reason: "输出不完整，正在提高额度重试" }]);
  });

  it("content 分多个 delta 到达时按序拼接后再解析", async () => {
    const splitAt = Math.floor(validPayload.length / 2);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(chatSseResponse([
      { reasoning_content: "先过一遍需求" },
      { content: validPayload.slice(0, splitAt) },
      { content: validPayload.slice(splitAt) },
    ]));
    const events: RequirementAnalysisEvent[] = [];

    const result = await analyzeRequirementText(config, "用户通过手机号+验证码登录。", (event) => {
      events.push(event);
    });

    expect(result.title).toBe("登录需求");
    expect(result.findings).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const content = events
      .filter((event): event is Extract<RequirementAnalysisEvent, { text: string }> => event.type === "content")
      .map((event) => event.text)
      .join("");
    expect(content).toBe(validPayload);
  });

  it("带 ```json 围栏的输出也能解析（围栏不剥离，交给 JSON 提取处理）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(contentSseResponse(`\`\`\`json\n${validPayload}\n\`\`\``));

    const result = await analyzeRequirementText(config, "用户通过手机号+验证码登录。");

    expect(result.title).toBe("登录需求");
  });
});
