import { streamChatCompletionParts } from "../testcase/ai.js";
import type { AiRequestConfig } from "../testcase/types.js";
import { isObject, parseMaybeJsonObject } from "../testcase/utils.js";
import { logger } from "../../logger.js";
import { isChartAllowed } from "./chart-catalog.js";
import { loadChartFragments, loadMonoTokens } from "./fragments.js";
import {
  buildAssemblyMessages,
  buildAssemblyRepairInstruction,
  buildSelectionMessages,
  SELECTION_REPAIR_INSTRUCTION,
  type ReportSelection,
} from "./prompts.js";
import { validateReportHtml } from "./validate.js";
import type { ReportRepository, ReportSourceType, ReportType, TestReport } from "./types.js";

export class ReportGenerateError extends Error {
  constructor(
    message: string,
    readonly code: "SELECT" | "ASSEMBLE" | "VALIDATION" = "VALIDATION",
  ) {
    super(message);
    this.name = "ReportGenerateError";
  }
}

/** 生成过程的 SSE 事件。 */
export type ReportGenerateEvent =
  | { type: "progress"; stage: "select" | "assemble" | "validate" | "save"; message: string }
  | { type: "done"; report: TestReport }
  | { type: "error"; message: string; code: string };

export interface GenerateReportInput {
  reportType: ReportType;
  sourceType: ReportSourceType;
  /** 文本原文（text）或 CSV 解析 JSON 的字符串（csv） */
  sourceText: string;
  /** 报告标题建议（可由用户指定；空则由 AI 定） */
  titleHint?: string;
}

type StreamRequestOptions = Parameters<typeof streamChatCompletionParts>[1];

/** 消费一次流式调用，仅累积 content 片段（与 board-ai collectStream 模式一致）。 */
async function collectStream(config: AiRequestConfig, options: StreamRequestOptions): Promise<string> {
  let content = "";
  for await (const part of streamChatCompletionParts(config, options)) {
    if (part.type === "content") content += part.text;
  }
  return content;
}

/** 校验选图阶段输出：结构合法 + 图型编号在该报告类型白名单内。 */
function validateSelection(raw: unknown, reportType: ReportType): { selection?: ReportSelection; error?: string } {
  if (!isObject(raw)) return { error: "选型输出不是 JSON 对象" };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { error: "选型缺少 title" };
  if (!Array.isArray(raw.charts) || raw.charts.length === 0) return { error: "选型 charts 为空" };
  if (raw.charts.length > 8) return { error: "选型 charts 超过 8 张上限" };

  const charts: ReportSelection["charts"] = [];
  let placeholderCount = 0;
  for (const [index, item] of raw.charts.entries()) {
    if (!isObject(item)) return { error: `第 ${index + 1} 个选型条目不是对象` };
    if (item.code === "PLACEHOLDER") {
      placeholderCount++;
      if (typeof item.missing !== "string" || typeof item.title !== "string" || typeof item.need !== "string") {
        return { error: `第 ${index + 1} 个占位条目缺少 missing/title/need` };
      }
      charts.push({ code: "PLACEHOLDER", missing: item.missing, title: item.title, need: item.need });
      continue;
    }
    if (typeof item.code !== "string" || !isChartAllowed(reportType, item.code)) {
      return { error: `第 ${index + 1} 个选型条目的图型编号 ${String(item.code)} 不在该报告类型白名单内` };
    }
    if (typeof item.title !== "string" || typeof item.sub !== "string" || typeof item.source !== "string") {
      return { error: `第 ${index + 1} 个选型条目缺少 title/sub/source` };
    }
    if (item.data === undefined || item.data === null) {
      return { error: `第 ${index + 1} 个选型条目缺少 data` };
    }
    charts.push({ code: item.code, title: item.title, sub: item.sub, source: item.source, data: item.data });
  }
  if (placeholderCount > 2) return { error: "缺数占位条目超过 2 张上限" };
  return { selection: { title, charts } };
}

/** 从模型输出中提取完整 HTML（剥离 Markdown 围栏与前后杂散文本）。 */
export function extractHtml(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/<!doctype html/i);
  if (start >= 0) {
    text = text.slice(start);
  } else {
    const htmlStart = text.search(/<html[\s>]/i);
    if (htmlStart >= 0) text = text.slice(htmlStart);
  }
  const end = text.search(/<\/html>/i);
  if (end >= 0) text = text.slice(0, end + "</html>".length);
  return text;
}

/** 阶段一：选图与数据映射（严格 JSON，失败修复重试一次）。 */
async function selectCharts(config: AiRequestConfig, input: GenerateReportInput): Promise<ReportSelection> {
  const messages = buildSelectionMessages(input);
  const first = await collectStream(config, { messages, temperature: 0.2, maxTokens: 8192, responseJson: true });
  const parsedFirst = validateSelection(parseMaybeJsonObject(first), input.reportType);
  if (parsedFirst.selection) return parsedFirst.selection;

  logger.warn({ reason: parsedFirst.error }, "选图阶段输出不合格，发起一次修复重试");
  const repaired = await collectStream(config, {
    messages: [...messages, { role: "assistant", content: first }, { role: "user", content: SELECTION_REPAIR_INSTRUCTION }],
    temperature: 0.1,
    maxTokens: 8192,
    responseJson: true,
  });
  const parsedRepaired = validateSelection(parseMaybeJsonObject(repaired), input.reportType);
  if (!parsedRepaired.selection) {
    throw new ReportGenerateError(`AI 选图输出不合格：${parsedRepaired.error}`, "SELECT");
  }
  return parsedRepaired.selection;
}

/** 阶段二：注入真实图型片段组装 HTML，静态校验失败修复重试一次。 */
async function assembleHtml(config: AiRequestConfig, input: GenerateReportInput, selection: ReportSelection): Promise<string> {
  const chartCodes = selection.charts.filter((c) => c.code !== "PLACEHOLDER").map((c) => c.code);
  const messages = buildAssemblyMessages({
    reportType: input.reportType,
    selection,
    monoTokens: loadMonoTokens(),
    fragments: loadChartFragments(chartCodes),
    sourceText: input.sourceText,
  });
  const validateOptions = {
    requireHonesty: input.sourceType === "text",
    sourceText: input.sourceText,
    selection,
  };

  const first = extractHtml(await collectStream(config, { messages, temperature: 0.3, maxTokens: 32768 }));
  const firstIssues = validateReportHtml(first, validateOptions);
  if (firstIssues.length === 0) return first;

  logger.warn({ issues: firstIssues.map((i) => i.message) }, "组装阶段 HTML 未通过静态校验，发起一次修复重试");
  const repaired = extractHtml(
    await collectStream(config, {
      messages: [
        ...messages,
        { role: "assistant", content: first },
        { role: "user", content: buildAssemblyRepairInstruction(firstIssues.map((i) => i.message)) },
      ],
      temperature: 0.1,
      maxTokens: 32768,
    }),
  );
  const repairedIssues = validateReportHtml(repaired, validateOptions);
  if (repairedIssues.length > 0) {
    throw new ReportGenerateError(`报告 HTML 未通过静态校验：${repairedIssues[0].message} 等 ${repairedIssues.length} 项`, "VALIDATION");
  }
  return repaired;
}

/**
 * AI 报告生成管线：选图 → 组装 → 校验 → 落库。
 * 过程事件经 onEvent 流出（SSE）；任何阶段失败抛 ReportGenerateError，不落库。
 */
export async function generateReport(
  config: AiRequestConfig,
  repo: ReportRepository,
  input: GenerateReportInput,
  onEvent: (event: ReportGenerateEvent) => void = () => {},
): Promise<TestReport> {
  onEvent({ type: "progress", stage: "select", message: "正在分析素材并选择图型…" });
  const selection = await selectCharts(config, input);
  const chartCodes = selection.charts.map((c) => ("missing" in c ? `占位(${c.missing})` : c.code));
  onEvent({ type: "progress", stage: "assemble", message: `已选定 ${selection.charts.length} 张图（${chartCodes.join(" / ")}），正在组装报告…` });

  const html = await assembleHtml(config, input, selection);
  onEvent({ type: "progress", stage: "validate", message: "静态校验通过，正在保存报告…" });

  const report = await repo.createReport({
    title: input.titleHint?.trim() || selection.title,
    reportType: input.reportType,
    sourceType: input.sourceType,
    sourceDigest: input.sourceText.slice(0, 1000000),
    chartKinds: selection,
    html,
  });
  onEvent({ type: "done", report });
  return report;
}

/** 追改入参：原报告 id + 自然语言修改指令。 */
export interface ReviseReportInput {
  reportId: string;
  instruction: string;
}

/**
 * 对话式追改：原始素材 + 修改指令 + 上次选型重新装箱，整体重生成（一期不做局部 patch）。
 * 版本策略：仅保留当前版（一期不存历史快照）。
 */
export async function reviseReport(
  config: AiRequestConfig,
  repo: ReportRepository,
  input: ReviseReportInput,
  onEvent: (event: ReportGenerateEvent) => void = () => {},
): Promise<TestReport> {
  const existing = await repo.getReport(input.reportId);
  if (!existing) {
    throw new ReportGenerateError("报告记录不存在", "VALIDATION");
  }

  // 追改装箱：指令与上次选型进入溯源池，用户给出的数字视为可溯源素材
  const revisedInput: GenerateReportInput = {
    reportType: existing.reportType,
    sourceType: existing.sourceType,
    sourceText: [
      existing.sourceDigest ?? "",
      `【用户修改指令】${input.instruction}`,
      `【上一次选型】${JSON.stringify(existing.chartKinds ?? null)}`,
    ].join("\n\n"),
  };

  onEvent({ type: "progress", stage: "select", message: "正在按修改指令重新选图…" });
  const selection = await selectCharts(config, revisedInput);
  onEvent({ type: "progress", stage: "assemble", message: "正在重新组装报告…" });

  const html = await assembleHtml(config, revisedInput, selection);
  onEvent({ type: "progress", stage: "save", message: "校验通过，正在更新报告…" });

  const updated = await repo.updateReportContent(existing.id, { html, chartKinds: selection });
  onEvent({ type: "done", report: updated });
  return updated;
}
