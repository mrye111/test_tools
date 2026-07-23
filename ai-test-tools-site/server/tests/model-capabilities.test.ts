import { describe, expect, it } from "vitest";
import { resolveGenerationMaxTokens } from "../src/features/testcase/model-capabilities.js";
import type { AiRequestConfig } from "../src/features/testcase/types.js";

function config(overrides: Partial<AiRequestConfig> = {}): AiRequestConfig {
  return {
    apiKey: "test-key",
    model: "unknown-model",
    baseUrl: "https://api.example.com/v1",
    provider: "codex",
    endpointType: "openai_chat",
    ...overrides,
  };
}

describe("模型生成输出预算", () => {
  it("Kimi K2.7 Code 自动使用 32768 tokens", () => {
    expect(resolveGenerationMaxTokens(config({
      model: "kimi-k2.7-code",
      baseUrl: "https://api.kimi.com/coding/v1",
    }))).toBe(32_768);
  });

  it("显式模型配置优先于内置能力表", () => {
    expect(resolveGenerationMaxTokens(config({
      model: "kimi-k2.7-code",
      maxOutputTokens: 48_000,
    }))).toBe(48_000);
  });

  it("未知模型使用保守默认值", () => {
    expect(resolveGenerationMaxTokens(config())).toBe(16_000);
  });
});
