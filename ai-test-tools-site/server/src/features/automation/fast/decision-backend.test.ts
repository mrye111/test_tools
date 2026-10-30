import { describe, expect, it } from "vitest";
import { createOpenAiBackend, type OpenAiBackendOptions } from "./decision-backend.js";
import type { FastDecisionInput } from "./decision-backend.js";
import type { FastSnapshot } from "./snapshot.js";

const SNAPSHOT: FastSnapshot = {
  url: "https://app.example.com/login",
  title: "登录",
  text: "登录页 账号 密码 登录",
  elements: [
    { index: 1, kind: "fill", role: "textbox", name: "账号输入框", value: "", bbox: { x: 0, y: 0, w: 100, h: 30 } },
    { index: 2, kind: "click", role: "button", name: "登录", bbox: { x: 0, y: 40, w: 80, h: 30 } },
  ],
};

const INPUT: FastDecisionInput = { goal: "在账号输入框输入user_normal", snapshot: SNAPSHOT, history: [] };

function stubFetch(responseBody: unknown, status = 200): { options: OpenAiBackendOptions; lastBody: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  const fetchImpl = async (_url: unknown, init?: { body?: unknown }) => {
    captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify(responseBody), { status, headers: { "Content-Type": "application/json" } });
  };
  const options: OpenAiBackendOptions = {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "test-model",
    fetchImpl: fetchImpl as typeof fetch,
  };
  return { options, lastBody: () => captured };
}

function chatResponse(content: unknown): unknown {
  return { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] };
}

describe("createOpenAiBackend", () => {
  it("合法响应映射为 FastDecision；请求带 response_format 与元素表", async () => {
    const { options, lastBody } = stubFetch(chatResponse({
      operation: "TYPE_TEXT",
      target: "1",
      text: "user_normal",
      confidence: 0.87,
      reason: "字段为空且目标要求输入",
    }));
    const backend = createOpenAiBackend(options);
    const decision = await backend.decide(INPUT);
    expect(decision).toMatchObject({
      operation: "TYPE_TEXT",
      target: "1",
      text: "user_normal",
      confidence: 0.87,
    });
    expect(lastBody().response_format).toEqual({ type: "json_object" });
    expect(String((lastBody().messages as { content: string }[])[1].content)).toContain("账号输入框");
  });

  it("operation 非法直接抛错（交给上层 fallback）", async () => {
    const { options } = stubFetch(chatResponse({ operation: "EXPLODE", confidence: 0.9 }));
    const backend = createOpenAiBackend(options);
    await expect(backend.decide(INPUT)).rejects.toThrow("operation 非法");
  });

  it("CLICK 的 target 必须是纯数字序号", async () => {
    const { options } = stubFetch(chatResponse({ operation: "CLICK", target: "abc", confidence: 0.9 }));
    const backend = createOpenAiBackend(options);
    await expect(backend.decide(INPUT)).rejects.toThrow("target 非法");
  });

  it("SELECT 的 target 必须是 i:j 复合序号", async () => {
    const { options } = stubFetch(chatResponse({ operation: "SELECT", target: "3", confidence: 0.9 }));
    const backend = createOpenAiBackend(options);
    await expect(backend.decide(INPUT)).rejects.toThrow("SELECT target 非法");
  });

  it("confidence 超界被夹取到 0..1", async () => {
    const { options } = stubFetch(chatResponse({ operation: "DONE", confidence: 1.8 }));
    const backend = createOpenAiBackend(options);
    const decision = await backend.decide(INPUT);
    expect(decision.confidence).toBe(1);
  });

  it("HTTP 错误抛错", async () => {
    const { options } = stubFetch({}, 500);
    const backend = createOpenAiBackend(options);
    await expect(backend.decide(INPUT)).rejects.toThrow("HTTP 500");
  });
});
