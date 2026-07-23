import type { AiRequestConfig } from "./types.js";

const DEFAULT_GENERATION_MAX_TOKENS = 16_000;
const MIN_GENERATION_MAX_TOKENS = 1_024;
const MAX_GENERATION_MAX_TOKENS = 131_072;

const MODEL_OUTPUT_BUDGETS: Array<{ matches: (model: string, baseUrl: string) => boolean; maxOutputTokens: number }> = [
  {
    matches: (model, baseUrl) => baseUrl.includes("api.kimi.com/coding") || /^kimi-(?:k2\.7-code|for-coding)$/.test(model),
    maxOutputTokens: 32_768,
  },
  {
    matches: (model) => /claude-(?:opus|sonnet)-4[.-]6/.test(model),
    maxOutputTokens: 64_000,
  },
  {
    matches: (model) => /gemini-(?:2\.5|3)/.test(model),
    maxOutputTokens: 65_536,
  },
  {
    matches: (model) => /(?:^|\/)gpt-5/.test(model),
    maxOutputTokens: 32_768,
  },
  {
    matches: (model) => /deepseek/.test(model),
    maxOutputTokens: 8_192,
  },
];

function boundedTokens(value: number): number {
  return Math.max(MIN_GENERATION_MAX_TOKENS, Math.min(MAX_GENERATION_MAX_TOKENS, Math.floor(value)));
}

export function resolveGenerationMaxTokens(config: AiRequestConfig): number {
  if (Number.isFinite(config.maxOutputTokens) && Number(config.maxOutputTokens) > 0) {
    return boundedTokens(Number(config.maxOutputTokens));
  }

  const model = config.model.trim().toLowerCase();
  const baseUrl = config.baseUrl.trim().toLowerCase();
  const capability = MODEL_OUTPUT_BUDGETS.find((item) => item.matches(model, baseUrl));
  return capability?.maxOutputTokens ?? DEFAULT_GENERATION_MAX_TOKENS;
}
