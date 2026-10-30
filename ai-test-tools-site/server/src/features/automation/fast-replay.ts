/**
 * 极速回放报告（票据 09 后续）：极速路径绕过 Midscene agent，agent 无任务流水也就没有报告。
 * 这里把 fast 帧序列拼成 Midscene GroupedActionDump，交给官方 writeDumpReport 写入
 * MIDSCENE_RUN_DIR/report/，产物就是原生 Midscene 报告（逐步截图 + 决策记录 + 耗时）。
 */

import { randomUUID } from "node:crypto";
import { writeDumpReport } from "@midscene/core/utils";
import type { FastFrame } from "./fast/fast-loop.js";
import type { RunVerdict, StepResult } from "./types.js";

export type FastReplayFrame = FastFrame & { stepId: number };

export type FastReplayInput = {
  caseNo: string;
  title: string;
  entryUrl: string;
  verdict: RunVerdict;
  steps: StepResult[];
  frames: FastReplayFrame[];
};

const VERDICT_LABEL: Record<RunVerdict, string> = {
  passed: "通过",
  partial: "部分通过",
  failed: "失败",
  aborted: "已中止",
};

const PHASE_LABEL: Record<FastFrame["phase"], string> = {
  decision: "决策快照",
  action: "动作完成",
  failed: "失败现场",
};

/** 动作帧的 subType 对齐 Midscene 原生动作名（查看器标题/图标按此渲染）。 */
const ACTION_LABEL: Partial<Record<NonNullable<FastFrame["operation"]>, string>> = {
  CLICK: "Tap",
  TYPE_TEXT: "Input",
  SELECT: "Select",
  SCROLL_DOWN: "Scroll",
  SCROLL_UP: "Scroll",
  WAIT: "Sleep",
};

/** 视口与 browser-pool 的 VIEWPORT 一致；回放查看器的坐标系以它为准。 */
const SHOT_SIZE = { width: 1440, height: 900 };

function decisionThought(frame: FastFrame): string {
  const parts = [`操作 ${frame.operation ?? "?"}`];
  if (frame.confidence !== undefined) parts.push(`置信度 ${(frame.confidence * 100).toFixed(0)}%`);
  if (frame.targetLabel) parts.push(`目标 ${frame.targetLabel}`);
  if (frame.text) parts.push(`输入 "${frame.text}"`);
  if (frame.reason) parts.push(frame.reason);
  return parts.join(" · ");
}

/** bbox → Midscene LocateResultElement（驱动查看器的缩放到元素 + 指针跟随）。 */
function elementOf(frame: FastFrame): Record<string, unknown> | undefined {
  if (!frame.targetBox) return undefined;
  const { x, y, w, h } = frame.targetBox;
  return {
    center: [Math.round(x + w / 2), Math.round(y + h / 2)],
    rect: { left: Math.round(x), top: Math.round(y), width: Math.round(w), height: Math.round(h) },
    description: frame.targetLabel ?? "",
    dpr: 1,
  };
}

function toDataUri(base64: string): string {
  return base64.startsWith("data:") ? base64 : `data:image/jpeg;base64,${base64}`;
}

/** 查看器把 screenshot.base64 直接当 <img src>（回放脚本同样读 .base64）：必须带 data: 前缀。 */
function screenshotItem(frame: FastFrame): { base64: string; capturedAt: number } | undefined {
  if (!frame.screenshot) return undefined;
  return { base64: toDataUri(frame.screenshot), capturedAt: Date.parse(frame.at) };
}

/**
 * 单帧 → 单任务。
 * 决策帧 = Planning（有目标元素时 subType=Locate → 回放出现缩放与指针跟随）；
 * 动作帧 = Action Space（原生动作名；失败帧 status=failed）。
 * 每个任务都带 uiContext.shotSize——没有它查看器构建不出回放脚本（不会出播放器）。
 */
function frameToTask(frame: FastReplayFrame, stepText: string): Record<string, unknown> {
  const ts = Date.parse(frame.at);
  const cost = frame.durationMs ?? 0;
  const element = elementOf(frame);
  const shot = screenshotItem(frame);
  const uiContext = shot
    ? { shotSize: { ...SHOT_SIZE }, screenshot: shot, shrunkShotToLogicalRatio: 1, deprecatedDpr: 1 }
    : undefined;
  const recorder = shot ? [{ type: "screenshot", ts, screenshot: shot, timing: PHASE_LABEL[frame.phase] }] : [];
  const timing = { start: ts, end: ts + cost, cost };

  if (frame.phase === "decision") {
    return {
      taskId: randomUUID(),
      type: "Planning",
      subType: element ? "Locate" : "fast-decision",
      status: "finished",
      param: element
        ? { prompt: frame.targetLabel, deepLocate: false, cacheable: false }
        : { userInstruction: stepText },
      ...(element ? { output: { element } } : {}),
      thought: decisionThought(frame),
      ...(uiContext ? { uiContext } : {}),
      recorder,
      timing,
    };
  }
  return {
    taskId: randomUUID(),
    type: "Action Space",
    subType: ACTION_LABEL[frame.operation ?? "DONE"] ?? frame.operation,
    status: frame.phase === "failed" ? "failed" : "finished",
    param: {
      ...(element ? { locate: element } : {}),
      ...(frame.text ? { value: frame.text } : {}),
      ...(frame.operation === "SCROLL_DOWN" || frame.operation === "SCROLL_UP"
        ? { direction: frame.operation === "SCROLL_DOWN" ? "down" : "up", scrollType: "singleAction" }
        : {}),
    },
    ...(frame.phase === "failed" && frame.reason ? { errorMessage: frame.reason } : {}),
    ...(uiContext ? { uiContext } : {}),
    recorder,
    timing,
  };
}

/** 帧按步骤分组为 executions（每步一个执行卡片，标题为步骤原文）。 */
export function buildFastReplayDump(input: FastReplayInput): Record<string, unknown> {
  const stepTextById = new Map(input.steps.map((s) => [s.stepId, s.text]));
  const byStep = new Map<number, FastReplayFrame[]>();
  for (const frame of input.frames) {
    const list = byStep.get(frame.stepId) ?? [];
    list.push(frame);
    byStep.set(frame.stepId, list);
  }

  const executions = [...byStep.entries()].map(([stepId, frames]) => {
    const stepText = stepTextById.get(stepId) ?? `第 ${stepId} 步`;
    return {
      id: randomUUID(),
      logTime: Date.parse(frames[0]?.at ?? "") || Date.now(),
      name: `第 ${stepId} 步`,
      description: stepText,
      tasks: frames.map((frame) => frameToTask(frame, stepText)),
    };
  });

  return {
    sdkVersion: "1.13.0",
    groupName: `${input.caseNo} · ${input.title}`,
    groupDescription: `极速引擎回放 · ${input.entryUrl} · 结论：${VERDICT_LABEL[input.verdict]}（本报告不含视觉模型思考，极速路径为 DOM 决策表执行）`,
    modelBriefs: [{ intent: "fast-engine", name: "fast-replay", modelDescription: "极速引擎逐步回放" }],
    deviceType: "playwright",
    executions,
  };
}

/** 写报告到 MIDSCENE_RUN_DIR/report/fast-replay-*.html，返回绝对路径。 */
export function writeFastReplayReport(input: FastReplayInput): string {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const reportPath = writeDumpReport(`fast-replay-${stamp}`, JSON.stringify(buildFastReplayDump(input)));
  if (!reportPath) throw new Error("writeDumpReport 未返回路径");
  return reportPath;
}
