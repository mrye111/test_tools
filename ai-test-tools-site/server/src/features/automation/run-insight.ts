/** P4 运行洞察：run-data sidecar（帧序列 + 页面轨迹）读写、Agent Action View 站点图聚合、AI 根因生成。 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractJsonObject, type ChatMessage } from "./compiler.js";
import type { FastReplayFrame, PageTrailEntry, RootCauseInfo, StepResult } from "./types.js";

/** 运行洞察 sidecar：帧（含截图）与页面轨迹的落盘形态（报告之外的第二产物，供站点图/帧画廊按需读取）。 */
export type RunInsightData = {
  pageTrail: PageTrailEntry[];
  frames: FastReplayFrame[];
};

/** runId 进文件名，防路径穿越。 */
function isSafeRunId(runId: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(runId);
}

function runDataPath(baseDir: string, runId: string): string {
  return join(baseDir, "run-data", `${runId}.json`);
}

export async function writeRunInsight(baseDir: string, runId: string, data: RunInsightData): Promise<void> {
  if (!isSafeRunId(runId)) return;
  await mkdir(join(baseDir, "run-data"), { recursive: true });
  await writeFile(runDataPath(baseDir, runId), JSON.stringify(data), "utf8");
}

export async function readRunInsight(baseDir: string, runId: string): Promise<RunInsightData | null> {
  if (!isSafeRunId(runId)) return null;
  try {
    const raw = await readFile(runDataPath(baseDir, runId), "utf8");
    const parsed = JSON.parse(raw) as Partial<RunInsightData>;
    return { pageTrail: parsed.pageTrail ?? [], frames: parsed.frames ?? [] };
  } catch {
    return null;
  }
}

export type PageMapNode = {
  url: string;
  label: string;
  /** 触点：轨迹中在该页面上启动的步骤数。 */
  touches: number;
  /** 失败热点：该页面上有失败步骤。 */
  failed: boolean;
  /** 可回放帧数（0 = 该页无逐帧快照，看回放报告）。 */
  frameCount: number;
  firstAt: string;
  lastAt: string;
};

export type PageMapEdge = { from: string; to: string; count: number };

export type PageMap = {
  /** false = 该运行无轨迹/帧数据（老数据或视觉引擎全绿运行）。 */
  available: boolean;
  nodes: PageMapNode[];
  edges: PageMapEdge[];
};

/** URL 归一（去 hash）：同页不同锚点并为一个节点。 */
function normalizeUrl(url: string): string {
  return url.split("#")[0] ?? url;
}

function labelOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname === "/" ? u.host : u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** 轨迹 + 帧 → 站点图：节点=页面（触点/失败热点/帧数），边=页面转移。 */
export function buildPageMap(insight: RunInsightData, stepResults: StepResult[]): PageMap {
  const failedSteps = new Set(stepResults.filter((s) => s.status === "failed").map((s) => s.stepId));
  const nodes = new Map<string, PageMapNode>();
  const ensureNode = (url: string, at: string): PageMapNode => {
    const key = normalizeUrl(url);
    let node = nodes.get(key);
    if (!node) {
      node = { url: key, label: labelOf(key), touches: 0, failed: false, frameCount: 0, firstAt: at, lastAt: at };
      nodes.set(key, node);
    }
    return node;
  };

  for (const entry of insight.pageTrail) {
    const node = ensureNode(entry.url, entry.at);
    node.touches += 1;
    if (failedSteps.has(entry.stepId)) node.failed = true;
    if (entry.at < node.firstAt) node.firstAt = entry.at;
    if (entry.at > node.lastAt) node.lastAt = entry.at;
  }
  for (const frame of insight.frames) {
    if (!frame.url) continue;
    const node = ensureNode(frame.url, frame.at);
    node.frameCount += 1;
    if (frame.at < node.firstAt) node.firstAt = frame.at;
    if (frame.at > node.lastAt) node.lastAt = frame.at;
  }

  const edges = new Map<string, PageMapEdge>();
  for (let i = 1; i < insight.pageTrail.length; i++) {
    const from = normalizeUrl(insight.pageTrail[i - 1]!.url);
    const to = normalizeUrl(insight.pageTrail[i]!.url);
    if (from === to) continue;
    const key = `${from} ${to}`;
    const edge = edges.get(key) ?? { from, to, count: 0 };
    edge.count += 1;
    edges.set(key, edge);
  }

  return {
    available: insight.pageTrail.length > 0 || insight.frames.length > 0,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

export type RootCauseInput = {
  caseNo: string;
  title: string;
  entryUrl: string;
  stepResults: StepResult[];
  pageTrail?: PageTrailEntry[];
  /** 运行级错误（导航/会话级失败时步骤结果为空，以它作为失败上下文）。 */
  error?: string;
};

function buildFallbackFixPrompt(input: RootCauseInput): string {
  const failed = input.stepResults.filter((s) => s.status === "failed");
  return [
    `请修复 UI 自动化用例 ${input.caseNo}（${input.title}）暴露的问题：`,
    `入口：${input.entryUrl}`,
    ...(failed.length > 0
      ? failed.map((s) => `- 步骤 ${s.stepId}：${s.text}${s.error ? `（错误：${s.error}）` : ""}`)
      : [`- 运行未能开始：${input.error ?? "未知错误"}`]),
    "期望：该用例的全部步骤可顺利执行并通过断言。",
  ].join("\n");
}

/** AI 根因：对失败步骤调 LLM（入参：步骤 + 错误 + 所在页面），产出根因摘要 + 修复提示词。 */
export async function generateRootCause(
  input: RootCauseInput,
  callChat: (messages: ChatMessage[]) => Promise<string>,
): Promise<RootCauseInfo> {
  const failed = input.stepResults.filter((s) => s.status === "failed");
  if (failed.length === 0 && !input.error) {
    throw new Error("该运行没有失败步骤，无需生成根因");
  }
  const urlByStep = new Map((input.pageTrail ?? []).map((t) => [t.stepId, t.url]));
  const lines =
    failed.length > 0
      ? failed.map((s) => {
          const page = urlByStep.get(s.stepId);
          return `- 步骤 ${s.stepId}【${s.type}】${s.text}${page ? `（所在页面：${page}）` : ""}${s.error ? `\n  错误：${s.error}` : ""}`;
        })
      : [`- 运行未能开始（导航/会话级失败）：${input.error}`];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "你是 UI 自动化测试分析专家。分析运行失败的根因，并产出可交给开发者或 AI 编码助手的修复提示词。只输出 JSON 对象，不要输出其他内容。",
    },
    {
      role: "user",
      content: [
        `用例 ${input.caseNo} · ${input.title}`,
        `入口：${input.entryUrl}`,
        "失败步骤：",
        ...lines,
        "",
        '输出 JSON：{"rootCause": "失败根因分析（简洁，指明是产品缺陷还是用例/环境问题）", "fixPrompt": "修复提示词（面向开发者或 AI 编码助手：上下文、失败现象、排查建议、期望修复后的行为）"}',
      ].join("\n"),
    },
  ];
  const raw = await callChat(messages);
  const parsed = extractJsonObject(raw) as { rootCause?: unknown; fixPrompt?: unknown } | null;
  const summary = typeof parsed?.rootCause === "string" ? parsed.rootCause.trim() : "";
  const fixPrompt = typeof parsed?.fixPrompt === "string" ? parsed.fixPrompt.trim() : "";
  if (!summary && !fixPrompt) {
    // 模型未按 schema 输出：原文作摘要，fixPrompt 走模板兜底
    const text = raw.trim();
    if (!text) throw new Error("根因生成返回为空");
    return { summary: text, fixPrompt: buildFallbackFixPrompt(input), generatedAt: new Date().toISOString() };
  }
  return {
    summary: summary || "（模型未给出根因摘要）",
    fixPrompt: fixPrompt || buildFallbackFixPrompt(input),
    generatedAt: new Date().toISOString(),
  };
}
