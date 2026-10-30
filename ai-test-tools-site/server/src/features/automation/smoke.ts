/** 定位链路启动冒烟：金丝雀页面 + 真值 bbox 校验；异常自动回退 low 档（票据 08 方案落地）。 */

import { chromium } from "playwright";
import { PlaywrightAgent } from "@midscene/web/playwright";
import { logger } from "../../logger.js";

/** 固定金丝雀页面：data: URL 自带真值，不依赖被测系统状态。 */
const CANARY_URL =
  'data:text/html,<body style="margin:0">' +
  '<button style="position:absolute;left:120px;top:80px;width:100px;height:40px">OK</button></body>';
const CANARY_BBOX = { x: 120, y: 80, w: 100, h: 40 };
const LATENCY_THRESHOLD_MS = 10_000;

export type SmokeResult = { tier: "disabled" | "low"; latencyMs: number };

async function canary(): Promise<{ hit: boolean; latencyMs: number }> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    await page.goto(CANARY_URL);
    // 金丝雀不需要报告文件（避免每次启动堆积杂物，评审 LOW-15）
    const agent = new PlaywrightAgent(page, { generateReport: false });
    const t0 = Date.now();
    const { center } = await agent.aiLocate("页面中的「OK」按钮");
    const latencyMs = Date.now() - t0;
    await agent.destroy().catch(() => undefined);
    const [x, y] = center ?? [-1, -1];
    const hit =
      x >= CANARY_BBOX.x && x <= CANARY_BBOX.x + CANARY_BBOX.w &&
      y >= CANARY_BBOX.y && y <= CANARY_BBOX.y + CANARY_BBOX.h;
    return { hit, latencyMs };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * 启动金丝雀：验证定位链路当前档位可用（disabled 属未文档化行为，可能被端点收紧）。
 * 默认档失败 → 回退 reasoning_effort=low 再试；仍失败 → 抛错（调用方标记引擎降级，拒绝执行）。
 */
export async function locatingSmokeCheck(): Promise<SmokeResult> {
  try {
    const first = await canary();
    if (first.hit && first.latencyMs <= LATENCY_THRESHOLD_MS) {
      return { tier: "disabled", latencyMs: first.latencyMs };
    }
    logger.warn(first, "[automation] 冒烟默认档异常（disabled 可能被收紧），回退 low 档");
  } catch (error) {
    logger.warn({ err: error }, "[automation] 冒烟默认档调用失败，回退 low 档");
  }
  process.env.MIDSCENE_MODEL_REASONING_ENABLED = "true";
  // 合并而非覆写：保留用户已有的 extra body 配置（评审 LOW-15）
  const existingExtra = (() => {
    try {
      return JSON.parse(process.env.MIDSCENE_MODEL_EXTRA_BODY_JSON ?? "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  process.env.MIDSCENE_MODEL_EXTRA_BODY_JSON = JSON.stringify({ ...existingExtra, reasoning_effort: "low" });
  const second = await canary();
  if (!second.hit) {
    throw new Error("定位链路在 low 档亦不可用");
  }
  return { tier: "low", latencyMs: second.latencyMs };
}
