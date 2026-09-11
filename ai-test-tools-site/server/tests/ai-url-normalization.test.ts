import { describe, expect, it } from "vitest";
import {
  inferApiFormatFromBaseUrl,
  normalizeOpenAiChatUrl,
  normalizeOpenAiResponsesUrl,
  parseAiRequestConfig,
} from "../src/features/testcase/ai.js";
import {
  detectSpecificApiFormatFromUrl,
  inferApiFormatFromBaseUrl as clientInferApiFormat,
  toAiConfig,
  type UniversalProvider,
} from "../../src/shared/api-types.js";

describe("服务端 URL 规范化", () => {
  it("纯 origin 地址自动补全 /v1 后拼接 /chat/completions", () => {
    expect(normalizeOpenAiChatUrl("http://127.0.0.1:8317")).toBe(
      "http://127.0.0.1:8317/v1/chat/completions",
    );
    expect(normalizeOpenAiChatUrl("https://api.openai.com")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("已含 /v1 的地址不重复补全 /v1", () => {
    expect(normalizeOpenAiChatUrl("http://127.0.0.1:8317/v1")).toBe(
      "http://127.0.0.1:8317/v1/chat/completions",
    );
    expect(normalizeOpenAiChatUrl("https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("已有 /chat/completions 完整路径时保持原样", () => {
    expect(
      normalizeOpenAiChatUrl("http://127.0.0.1:8317/v1/chat/completions"),
    ).toBe("http://127.0.0.1:8317/v1/chat/completions");
  });

  it("纯 origin 地址自动补全 /v1 后拼接 /responses", () => {
    expect(normalizeOpenAiResponsesUrl("http://127.0.0.1:8317")).toBe(
      "http://127.0.0.1:8317/v1/responses",
    );
  });
});

describe("API 格式自动推断", () => {
  it("通用代理地址默认回退为兼容性最好的 openai_chat", () => {
    expect(inferApiFormatFromBaseUrl("http://127.0.0.1:8317")).toBe("openai_chat");
    expect(clientInferApiFormat("http://127.0.0.1:8317")).toBe("openai_chat");
    expect(detectSpecificApiFormatFromUrl("http://127.0.0.1:8317")).toBeNull();
  });

  it("明确特征域名推断为对应原生或专用协议", () => {
    expect(clientInferApiFormat("https://api.anthropic.com/v1")).toBe("anthropic");
    expect(
      clientInferApiFormat("https://generativelanguage.googleapis.com/v1beta"),
    ).toBe("gemini_native");
    expect(clientInferApiFormat("https://api.example.com/v1/responses")).toBe(
      "openai_responses",
    );
  });
});

describe("解析请求配置与客户端归一化联动", () => {
  it("服务端解析纯 origin 配置时默认推断为 openai_chat", () => {
    const config = parseAiRequestConfig({
      baseUrl: "http://127.0.0.1:8317",
      apiKey: "123456",
      model: "gemini-3.8-flash-high",
    });

    expect(config.endpointType).toBe("openai_chat");
    expect(config.baseUrl).toBe("http://127.0.0.1:8317");
  });

  it("客户端 toAiConfig 为纯 origin 的 OpenAI 格式地址自动补全 /v1", () => {
    const provider: UniversalProvider = {
      id: "p1",
      name: "本地代理",
      providerType: "custom",
      baseUrl: "http://127.0.0.1:8317",
      apiKey: "123456",
      model: "gemini-3.8-flash-high",
      apiFormat: "openai_chat",
    };

    const runtime = toAiConfig(provider);
    expect(runtime.baseUrl).toBe("http://127.0.0.1:8317/v1");
    expect(runtime.endpointType).toBe("openai_chat");
  });
});
