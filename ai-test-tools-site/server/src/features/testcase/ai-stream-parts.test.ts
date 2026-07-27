import { afterEach, describe, expect, it, vi } from "vitest";
import { AiStreamProviderError, EmptyAiResponseError, streamChatCompletionParts, type ChatCompletionPart } from "./ai.js";
import type { AiRequestConfig } from "./types.js";

const chatConfig: AiRequestConfig = {
  provider: "codex",
  endpointType: "openai_chat",
  baseUrl: "http://ai.test/v1",
  apiKey: "test-key",
  model: "test-model",
  isLocalModel: false,
};

const responsesConfig: AiRequestConfig = {
  ...chatConfig,
  endpointType: "openai_responses",
};

const anthropicConfig: AiRequestConfig = {
  provider: "claude",
  endpointType: "anthropic",
  baseUrl: "http://ai.test/v1",
  apiKey: "test-key",
  model: "claude-test",
  isLocalModel: false,
};

function sseChatResponse(deltas: Array<Record<string, unknown>>): Response {
  const frames = deltas
    .map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
    .join("");
  return new Response(`${frames}data: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collectParts(config: AiRequestConfig): Promise<ChatCompletionPart[]> {
  const parts: ChatCompletionPart[] = [];
  for await (const part of streamChatCompletionParts(config, {
    messages: [{ role: "user", content: "你好" }],
    maxTokens: 1024,
  })) {
    parts.push(part);
  }
  return parts;
}

describe("streamChatCompletionParts 类型化流式解析", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("openai_chat：reasoning_content 与 content 分离产出，且保留代码围栏", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseChatResponse([
      { reasoning_content: "先拆解需求" },
      { reasoning_content: "，再识别风险" },
      { content: "```json\n{\"title\":" },
      { content: "\"登录需求\"}\n```" },
    ]));

    const parts = await collectParts(chatConfig);

    expect(parts).toEqual([
      { type: "reasoning", text: "先拆解需求" },
      { type: "reasoning", text: "，再识别风险" },
      { type: "content", text: "```json\n{\"title\":" },
      { type: "content", text: "\"登录需求\"}\n```" },
    ]);
    // 不剥离 ``` 围栏：下游 parseMaybeJsonObject 自行处理。
    const content = parts.filter((part) => part.type === "content").map((part) => part.text).join("");
    expect(content).toContain("```json");
  });

  it("openai_chat：只有 reasoning 没有 content 时抛 EmptyAiResponseError（触发空正文重试）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseChatResponse([
      { reasoning_content: "思考占满了全部输出额度……" },
    ]));

    await expect(collectParts(chatConfig)).rejects.toBeInstanceOf(EmptyAiResponseError);
  });

  it("openai_responses：output_text.delta 产出 content，completed 整段正文不重复", async () => {
    const fullText = "{\"title\":\"登录需求\"}";
    const frames = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "{\"title\":" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "\"登录需求\"}" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "整理结构" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.completed", output_text: fullText })}\n\n`,
      "data: [DONE]\n\n",
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(frames.join(""), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));

    const parts = await collectParts(responsesConfig);

    expect(parts).toEqual([
      { type: "content", text: "{\"title\":" },
      { type: "content", text: "\"登录需求\"}" },
      { type: "reasoning", text: "整理结构" },
    ]);
  });

  it("anthropic：降级为一次性返回，产出单个 content chunk", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ content: [{ type: "text", text: "{\"title\":\"登录需求\"}" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const parts = await collectParts(anthropicConfig);

    expect(parts).toEqual([{ type: "content", text: "{\"title\":\"登录需求\"}" }]);
  });

  it("openai_chat：200 流内携带 error 事件时抛 AiStreamProviderError（不降级为空正文重试）", async () => {
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "先想一下" } }] })}\n\n`,
      `data: ${JSON.stringify({ error: { message: "Invalid API key", code: "invalid_api_key" } })}\n\n`,
      "data: [DONE]\n\n",
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(frames.join(""), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));

    const promise = collectParts(chatConfig);
    await expect(promise).rejects.toBeInstanceOf(AiStreamProviderError);
    await expect(promise).rejects.toThrow("Invalid API key");
  });

  it("openai_responses：response.failed 事件抛 AiStreamProviderError 并透传错误信息", async () => {
    const frames = [
      `data: ${JSON.stringify({ type: "response.failed", response: { status: "failed", error: { message: "model overloaded" } } })}\n\n`,
      "data: [DONE]\n\n",
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(frames.join(""), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));

    const promise = collectParts(responsesConfig);
    await expect(promise).rejects.toBeInstanceOf(AiStreamProviderError);
    await expect(promise).rejects.toThrow("model overloaded");
  });

  it("消费者提前停止时中止上游读取（AbortSignal 传导到 fetch）", async () => {
    let upstreamAborted = false;
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: "部分正文" } }] })}\n\n`;
    // 只发一帧后保持打开，模拟未完成的长生成。
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode(frame));
      },
    });
    // mock 的 fetch 不具备 undici 的 signal→body 联动，这里按真实行为补线：
    // signal 中止时让 body 报错，等待中的 reader.read() 随之拒绝。
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      (init?.signal as AbortSignal | null)?.addEventListener("abort", () => {
        upstreamAborted = true;
        streamController.error(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    for await (const part of streamChatCompletionParts(chatConfig, {
      messages: [{ role: "user", content: "你好" }],
      maxTokens: 1024,
    })) {
      expect(part).toEqual({ type: "content", text: "部分正文" });
      break; // 拿到第一个片段即停止（等价于客户端断开）
    }

    await vi.waitFor(() => {
      expect(upstreamAborted).toBe(true);
    });
  });
});
