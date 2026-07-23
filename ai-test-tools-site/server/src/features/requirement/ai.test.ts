import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeRequirementText, AnalysisParseError } from "./ai.js";
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

function chatResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("analyzeRequirementText 解析容错", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("首次即返回合法 JSON 时不发起修复重试", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(chatResponse(validPayload));

    const result = await analyzeRequirementText(config, "用户通过手机号+验证码登录。");

    expect(result.title).toBe("登录需求");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("首次输出无法解析时，携带上一次输出发起一次修复重试", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("抱歉，我无法处理这个文档，请提供更多信息。"))
      .mockResolvedValueOnce(chatResponse(validPayload));

    const result = await analyzeRequirementText(config, "用户通过手机号+验证码登录。");

    expect(result.title).toBe("登录需求");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCallBody = String((fetchSpy.mock.calls[1][1] as RequestInit).body);
    expect(secondCallBody).toContain("无法解析");
    expect(secondCallBody).toContain("抱歉，我无法处理这个文档");
  });

  it("修复重试仍无法解析时抛出 AnalysisParseError", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("不是 JSON"))
      .mockResolvedValueOnce(chatResponse("依然不是 JSON"));

    await expect(analyzeRequirementText(config, "需求文本")).rejects.toBeInstanceOf(AnalysisParseError);
  });

  it("首次返回空正文（推理耗尽输出额度）时，提高输出预算重试一次", async () => {
    const emptyButReasoning = new Response(JSON.stringify({
      choices: [{
        message: { content: "", reasoning_content: "让我思考一下这个需求……（思考内容占满了输出额度）" },
        finish_reason: "length",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(emptyButReasoning)
      .mockResolvedValueOnce(chatResponse(validPayload));

    const result = await analyzeRequirementText(config, "用户通过手机号+验证码登录。");

    expect(result.title).toBe("登录需求");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as { max_tokens: number };
    const secondBody = JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body)) as { max_tokens: number };
    expect(secondBody.max_tokens).toBeGreaterThan(firstBody.max_tokens);
  });

  it("message.content 为分片数组时正确提取文本", async () => {
    const partsResponse = new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: "text", text: validPayload }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(partsResponse);

    const result = await analyzeRequirementText(config, "用户通过手机号+验证码登录。");

    expect(result.title).toBe("登录需求");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
