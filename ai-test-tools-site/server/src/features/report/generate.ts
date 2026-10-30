import { streamChatCompletionParts } from "../testcase/ai.js";
import type { AiRequestConfig } from "../testcase/types.js";
import { isObject, parseMaybeJsonObject } from "../testcase/utils.js";
import { logger } from "../../logger.js";
import { isChartAllowed } from "./chart-catalog.js";
import { loadChartFragment, loadMonoTokens } from "./fragments.js";
import {
  buildSelectionMessages,
  SELECTION_REPAIR_INSTRUCTION,
  type ReportDraft,
} from "./prompts.js";
import { renderReportHtml } from "./template.js";
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

/** 校验选图阶段输出：图表结构 + 图型编号白名单；文档槽位宽松透传（模板侧已转义 + 容错）。 */
function validateSelection(raw: unknown, reportType: ReportType): { selection?: ReportDraft; error?: string } {
  if (!isObject(raw)) return { error: "选型输出不是 JSON 对象" };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { error: "选型缺少 title" };
  if (!Array.isArray(raw.charts) || raw.charts.length === 0) return { error: "选型 charts 为空" };
  if (raw.charts.length > 8) return { error: "选型 charts 超过 8 张上限" };

  const charts: ReportDraft["charts"] = [];
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
    const entry: ReportDraft["charts"][number] = {
      code: item.code,
      title: item.title,
      sub: item.sub,
      source: item.source,
      data: item.data,
    };
    // 数据表孪生：列名与行数做了最低限度的形状检查
    if (isObject(item.table) && Array.isArray(item.table.columns) && Array.isArray(item.table.rows)) {
      entry.table = {
        columns: item.table.columns.map((c) => String(c)),
        rows: item.table.rows
          .filter((r): r is unknown[] => Array.isArray(r))
          .map((r) => r.map((c) => (typeof c === "number" ? c : String(c)))),
      };
    }
    charts.push(entry);
  }
  if (placeholderCount > 2) return { error: "缺数占位条目超过 2 张上限" };

  // 文档槽位宽松透传：模板对缺省字段一律容错，且文本进 HTML 前已转义
  const draft: ReportDraft = { title, charts, ...(raw as Partial<ReportDraft>) };
  draft.title = title;
  draft.charts = charts;
  return { selection: draft };
}

/** 一次出稿尝试的产物：槽位 JSON + 拼装出的 HTML。 */
interface DraftAttempt {
  draft: ReportDraft;
  html: string;
}

/**
 * 把一次模型输出跑完整条确定性链路：解析 → 槽位校验 → 模板拼装 → 静态校验。
 * 任何一环不过都返回可读的 error，供修复重试带上。
 */
function tryDraft(raw: string, input: GenerateReportInput):
  | { ok: true; value: DraftAttempt }
  | { ok: false; error: string } {
  const parsed = validateSelection(parseMaybeJsonObject(raw), input.reportType);
  if (parsed.error || !parsed.selection) return { ok: false, error: parsed.error ?? "选型输出不合格" };

  const html = renderReportHtml(parsed.selection, {
    monoTokens: loadMonoTokens(),
    fragment: loadChartFragment,
  });
  const issues = validateReportHtml(html, {
    requireHonesty: input.sourceType === "text",
    sourceText: input.sourceText,
    selection: parsed.selection,
  });
  if (issues.length > 0) {
    return { ok: false, error: `内容未通过静态校验：${issues.map((i) => i.message).join("；")}` };
  }
  return { ok: true, value: { draft: parsed.selection, html } };
}

/**
 * 出稿（阶段一）：模型只产出槽位 JSON，服务端模板拼装并静态校验，失败修复重试一次。
 * 阶段二不再消耗 LLM 调用 —— 版式由 renderReportHtml 恒定产出。
 */
async function draftReport(config: AiRequestConfig, input: GenerateReportInput): Promise<DraftAttempt> {
  const messages = buildSelectionMessages(input);
  const first = await collectStream(config, { messages, temperature: 0.2, maxTokens: 8192, responseJson: true });
  const attempt1 = tryDraft(first, input);
  if (attempt1.ok) return attempt1.value;

  logger.warn({ reason: attempt1.error }, "出稿不合格，发起一次修复重试");
  const repaired = await collectStream(config, {
    messages: [
      ...messages,
      { role: "assistant", content: first },
      { role: "user", content: `${SELECTION_REPAIR_INSTRUCTION}\n上一次未通过的原因：${attempt1.error}` },
    ],
    temperature: 0.1,
    maxTokens: 8192,
    responseJson: true,
  });
  const attempt2 = tryDraft(repaired, input);
  if (!attempt2.ok) {
    throw new ReportGenerateError(`AI 出稿不合格：${attempt2.error}`, attempt2.error.includes("白名单") ? "SELECT" : "VALIDATION");
  }
  return attempt2.value;
}

/**
 * AI 报告生成管线：出稿（模型出槽位 JSON）→ 模板拼装 → 静态校验 → 落库。
 * 过程事件经 onEvent 流出（SSE）；任何阶段失败抛 ReportGenerateError，不落库。
 */
export async function generateReport(
  config: AiRequestConfig,
  repo: ReportRepository,
  input: GenerateReportInput,
  onEvent: (event: ReportGenerateEvent) => void = () => {},
): Promise<TestReport> {
  onEvent({ type: "progress", stage: "select", message: "正在分析素材并出稿…" });
  const { draft, html } = await draftReport(config, input);
  const chartCodes = draft.charts.map((c) => ("missing" in c ? `占位(${c.missing})` : c.code));
  onEvent({ type: "progress", stage: "assemble", message: `已选定 ${draft.charts.length} 张图（${chartCodes.join(" / ")}），版式由模板拼装…` });
  onEvent({ type: "progress", stage: "validate", message: "静态校验通过，正在保存报告…" });

  const report = await repo.createReport({
    title: input.titleHint?.trim() || draft.title,
    reportType: input.reportType,
    sourceType: input.sourceType,
    sourceDigest: input.sourceText.slice(0, 1000000),
    chartKinds: draft,
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

  onEvent({ type: "progress", stage: "select", message: "正在按修改指令重新出稿…" });
  const { draft, html } = await draftReport(config, revisedInput);
  onEvent({ type: "progress", stage: "assemble", message: "版式由模板拼装完成…" });
  onEvent({ type: "progress", stage: "save", message: "校验通过，正在更新报告…" });

  const updated = await repo.updateReportContent(existing.id, { html, chartKinds: draft });
  onEvent({ type: "done", report: updated });
  return updated;
}
