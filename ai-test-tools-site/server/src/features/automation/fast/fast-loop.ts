/** 极速执行回路：快照 → 决策 → 执行 → 再快照，直到 DONE/BLOCKED/超限（TS 重写 jev-ultrafast 回路，票据 09）。 */

import type { Page } from "playwright";
import { takeSnapshot, type FastElement, type FastSnapshot } from "./snapshot.js";
import type { FastDecision, FastDecisionBackend, FastTextWriter } from "./decision-backend.js";

export type FastLoopResult = {
  ok: boolean;
  /** 失败原因（blocked / low-confidence / iteration-limit / no-elements / no-text-value / error）。 */
  reason?: string;
  /** true = 应由视觉引擎降级重试。 */
  fallback: boolean;
  /** 实际执行的决策轮数。 */
  decisions: number;
  /** 回放帧（captureFrames 开启时采集；决策一帧、动作完成一帧、失败现场一帧）。 */
  frames: FastFrame[];
};

/** 极速回放帧：一次决策或一次动作的快照证据（拼 Midscene dump 的数据源）。 */
export type FastFrame = {
  iteration: number;
  phase: "decision" | "action" | "failed";
  operation?: FastDecision["operation"];
  /** 目标描述："[3] 登录按钮"；SELECT 为 "[i] 名称 i:j"。 */
  targetLabel?: string;
  /** 目标元素 bbox（视口坐标，报告高亮框用）。 */
  targetBox?: { x: number; y: number; w: number; h: number };
  /** TYPE_TEXT 的输入值（可能是解析后的真实凭据——写出报告前必须脱敏）。 */
  text?: string;
  confidence?: number;
  reason?: string;
  durationMs?: number;
  /** JPEG base64（无 data: 前缀）；截图失败为空串。 */
  screenshot: string;
  at: string;
  /** 采集时刻的页面 URL（P4 Agent Action View 站点图按它聚合节点）。 */
  url?: string;
};

export type FastPageAdapter = {
  page: Page;
  clickElement(element: FastElement): Promise<void>;
  fillElement(element: FastElement, text: string): Promise<void>;
  selectOption(element: FastElement, compositeIndex: string): Promise<void>;
  scroll(direction: "up" | "down"): Promise<void>;
};

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MIN_CONFIDENCE = 0.45;
/** 单次 act 的回放帧上限（防极端循环把报告撑爆）。 */
const MAX_FRAMES_PER_ACT = 40;

/** 元素中心点遮挡检查：该点最上层元素是目标自身或其子孙/祖先相关节点才算可点。 */
async function assertNotCovered(page: Page, element: FastElement): Promise<void> {
  const cx = element.bbox.x + element.bbox.w / 2;
  const cy = element.bbox.y + element.bbox.h / 2;
  const covered = await page.evaluate(
    `(({ cx, cy, index }) => {
      const top = document.elementFromPoint(cx, cy);
      if (!top) return true;
      const target = document.querySelector('[data-at-fidx="' + index + '"]');
      if (!target) return true;
      return !(top === target || target.contains(top) || top.contains(target));
    })(${JSON.stringify({ cx, cy, index: element.index })})`,
  );
  if (covered) {
    throw new Error(`元素 [${element.index}] 被遮挡，无法点击`);
  }
}

function createPlaywrightAdapter(page: Page): FastPageAdapter {
  return {
    page,
    clickElement: async (element) => {
      const locator = page.locator(`[data-at-fidx="${element.index}"]`);
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
      await assertNotCovered(page, element);
      await locator.click({ timeout: 5000 });
    },
    fillElement: async (element, text) => {
      const locator = page.locator(`[data-at-fidx="${element.index}"]`);
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
      await locator.click({ timeout: 3000 }).catch(() => undefined);
      await page.keyboard.press("ControlOrMeta+a").catch(() => undefined);
      await locator.fill(text, { timeout: 5000 }).catch(async () => {
        // contenteditable 等 fill 不支持的形态退化为逐键输入
        await page.keyboard.type(text, { delay: 10 });
      });
    },
    selectOption: async (element, compositeIndex) => {
      const optionIndex = Number(compositeIndex.split(":")[1]);
      const option = element.options?.[optionIndex - 1];
      if (!option) throw new Error(`选项 ${compositeIndex} 不存在`);
      await page.locator(`[data-at-fidx="${element.index}"]`).selectOption(option.value, { timeout: 5000 });
    },
    scroll: async (direction) => {
      await page.evaluate(`window.scrollBy(0, ${direction === "down" ? 600 : -600})`);
    },
  };
}

function findElement(snapshot: FastSnapshot, target: string): FastElement | null {
  if (target.includes(":")) {
    const elementIndex = Number(target.split(":")[0]);
    return snapshot.elements.find((el) => el.index === elementIndex) ?? null;
  }
  return snapshot.elements.find((el) => el.index === Number(target)) ?? null;
}

/**
 * 用极速回路执行一条 act 指令。返回 fallback=true 时由调用方降级视觉引擎。
 * 设计：单指令目标，DONE 必须发生在至少一次有效动作之后（防止模型开局直接宣布完成）。
 */
export async function runFastAct(
  goal: string,
  adapter: FastPageAdapter,
  deps: {
    backend: FastDecisionBackend;
    textWriter?: FastTextWriter;
    maxIterations?: number;
    minConfidence?: number;
    onDecision?: (decision: FastDecision, snapshot: FastSnapshot) => void;
    /** 采集回放帧（逐步截图 + 决策记录）；截图失败不阻塞回路。 */
    captureFrames?: boolean;
  },
): Promise<FastLoopResult> {
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const minConfidence = deps.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const history: string[] = [];
  const frames: FastFrame[] = [];
  let actionsTaken = 0;

  const fail = (reason: string, decisions: number): FastLoopResult => ({ ok: false, reason, fallback: true, decisions, frames });

  const capture = async (partial: Omit<FastFrame, "screenshot" | "at">): Promise<void> => {
    if (!deps.captureFrames || frames.length >= MAX_FRAMES_PER_ACT) return;
    let screenshot = "";
    try {
      screenshot = (await adapter.page.screenshot({ type: "jpeg", quality: 55 })).toString("base64");
    } catch {
      // 截图失败只丢帧，不影响执行
    }
    let url: string | undefined;
    try {
      url = adapter.page.url();
    } catch {
      // 页面已关闭等异常：帧无 URL，站点图按未知节点兜底
    }
    frames.push({ ...partial, screenshot, at: new Date().toISOString(), url });
  };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let snapshot: FastSnapshot;
    try {
      snapshot = await takeSnapshot(adapter.page);
    } catch (error) {
      return fail(`快照失败: ${error instanceof Error ? error.message : String(error)}`, iteration);
    }
    if (snapshot.elements.length === 0) {
      return fail("no-elements", iteration);
    }

    let decision: FastDecision;
    const tDecide = Date.now();
    try {
      decision = await deps.backend.decide({ goal, snapshot, history });
    } catch (error) {
      return fail(`决策失败: ${error instanceof Error ? error.message : String(error)}`, iteration);
    }
    deps.onDecision?.(decision, snapshot);

    const decisionElement = decision.target ? findElement(snapshot, decision.target) : null;
    await capture({
      iteration,
      phase: "decision",
      operation: decision.operation,
      targetLabel: decisionElement ? `[${decision.target}] ${decisionElement.name}` : decision.target,
      targetBox: decisionElement?.bbox,
      text: decision.text,
      confidence: decision.confidence,
      reason: decision.reason,
      durationMs: Date.now() - tDecide,
    });

    if (decision.confidence < minConfidence) {
      return fail(`low-confidence(${decision.confidence.toFixed(2)})`, iteration + 1);
    }

    switch (decision.operation) {
      case "DONE":
        return actionsTaken > 0
          ? { ok: true, fallback: false, decisions: iteration + 1, frames }
          : fail("done-without-action", iteration + 1);
      case "BLOCKED":
        return fail("blocked", iteration + 1);
      case "WAIT":
        history.push("WAIT");
        await new Promise((r) => setTimeout(r, 400));
        continue;
      case "SCROLL_UP":
      case "SCROLL_DOWN":
        await adapter.scroll(decision.operation === "SCROLL_DOWN" ? "down" : "up");
        history.push(decision.operation);
        continue;
      case "CLICK": {
        const element = decision.target ? findElement(snapshot, decision.target) : null;
        if (!element) {
          return fail(`目标元素不存在: ${decision.target}`, iteration + 1);
        }
        const t0 = Date.now();
        try {
          await adapter.clickElement(element);
          actionsTaken++;
          history.push(`CLICK [${element.index}] ${element.name}`);
          await capture({
            iteration,
            phase: "action",
            operation: "CLICK",
            targetLabel: `[${element.index}] ${element.name}`,
            targetBox: element.bbox,
            durationMs: Date.now() - t0,
          });
        } catch (error) {
          const reason = `点击失败: ${error instanceof Error ? error.message : String(error)}`;
          await capture({
            iteration,
            phase: "failed",
            operation: "CLICK",
            targetLabel: `[${element.index}] ${element.name}`,
            targetBox: element.bbox,
            reason,
            durationMs: Date.now() - t0,
          });
          return fail(reason, iteration + 1);
        }
        continue;
      }
      case "TYPE_TEXT": {
        const element = decision.target ? findElement(snapshot, decision.target) : null;
        if (!element) {
          return fail(`目标字段不存在: ${decision.target}`, iteration + 1);
        }
        let text = decision.text ?? null;
        if (!text && deps.textWriter) {
          text = await deps.textWriter({ goal, fieldLabel: element.name, pageText: snapshot.text });
        }
        if (!text) {
          return fail("no-text-value", iteration + 1);
        }
        const t0 = Date.now();
        try {
          await adapter.fillElement(element, text);
          actionsTaken++;
          history.push(`TYPE_TEXT [${element.index}] ${element.name} ← "${text}"`);
          await capture({
            iteration,
            phase: "action",
            operation: "TYPE_TEXT",
            targetLabel: `[${element.index}] ${element.name}`,
            targetBox: element.bbox,
            text,
            durationMs: Date.now() - t0,
          });
        } catch (error) {
          const reason = `输入失败: ${error instanceof Error ? error.message : String(error)}`;
          await capture({
            iteration,
            phase: "failed",
            operation: "TYPE_TEXT",
            targetLabel: `[${element.index}] ${element.name}`,
            targetBox: element.bbox,
            text,
            reason,
            durationMs: Date.now() - t0,
          });
          return fail(reason, iteration + 1);
        }
        continue;
      }
      case "SELECT": {
        const element = decision.target ? findElement(snapshot, decision.target) : null;
        if (!element || !decision.target) {
          return fail(`目标下拉框不存在: ${decision.target}`, iteration + 1);
        }
        const t0 = Date.now();
        try {
          await adapter.selectOption(element, decision.target);
          actionsTaken++;
          history.push(`SELECT [${decision.target}] ${element.name}`);
          await capture({
            iteration,
            phase: "action",
            operation: "SELECT",
            targetLabel: `[${decision.target}] ${element.name}`,
            targetBox: element.bbox,
            durationMs: Date.now() - t0,
          });
        } catch (error) {
          const reason = `选择失败: ${error instanceof Error ? error.message : String(error)}`;
          await capture({
            iteration,
            phase: "failed",
            operation: "SELECT",
            targetLabel: `[${decision.target}] ${element.name}`,
            targetBox: element.bbox,
            reason,
            durationMs: Date.now() - t0,
          });
          return fail(reason, iteration + 1);
        }
        continue;
      }
    }
  }
  return fail("iteration-limit", maxIterations);
}

export { createPlaywrightAdapter };
