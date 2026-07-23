import express, { type Express, type Request, type Response } from "express";
import { parseAiRequestConfig } from "../testcase/ai.js";
import type { JsonObject } from "../testcase/types.js";
import { isObject, safeDownloadName, text } from "../testcase/utils.js";
import { sendSseEvent } from "../../ai-generator.js";
import { analyzeRequirementText } from "./ai.js";
import { buildRequirementXmind } from "./exporters.js";
import { DocumentParseError, parseRequirementDocument, truncateText } from "./parsers.js";
import type { Finding, RequirementAnalysisResult, RequirementChartType, RequirementNode } from "./types.js";

type AnalysisStage = "parsing" | "analyzing" | "finalizing";

const ANALYZE_BODY_LIMIT = "10mb";

function flushSse(res: Response): void {
  (res as Response & { flush?: () => void }).flush?.();
}

function emit(res: Response, event: string, data: unknown): void {
  sendSseEvent(res, event, JSON.stringify(data));
  flushSse(res);
}

function emitStage(res: Response, stage: AnalysisStage): void {
  emit(res, "stage", { stage });
}

function beginSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function endSse(res: Response, ok: boolean): void {
  res.write(`event: end\ndata: ${JSON.stringify({ ok })}\n\n`);
  res.end();
}

function decodeHeaderValue(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeChartType(value: unknown): RequirementChartType {
  const chartType = text(value, "mindmap").trim();
  return chartType === "tree" || chartType === "logic" ? chartType : "mindmap";
}

function normalizeNode(value: unknown): RequirementNode | null {
  if (!isObject(value)) return null;
  const title = text(value.title).trim();
  if (!title) return null;
  return {
    id: text(value.id).trim() || title,
    title,
    children: Array.isArray(value.children)
      ? value.children.map(normalizeNode).filter((node): node is RequirementNode => node !== null)
      : [],
  };
}

function normalizeFinding(value: unknown): Finding | null {
  if (!isObject(value)) return null;
  const title = text(value.title).trim();
  const detail = text(value.detail).trim();
  const nodeId = text(value.nodeId).trim();
  if (!title || !nodeId) return null;
  const rawType = text(value.type).trim();
  const type = rawType === "risk" || rawType === "ambiguity" ? rawType : "clarification";
  return { id: text(value.id).trim() || `${type}_${nodeId}_${title.slice(0, 8)}`, type, title, detail, nodeId };
}

/** 从请求中取出解析输入：JSON {text} 或 octet-stream 文件字节。 */
async function resolveSourceText(req: Request): Promise<{ text: string; warnings: string[]; truncated: boolean }> {
  const contentType = text(req.headers["content-type"]).toLowerCase();
  if (contentType.includes("application/octet-stream")) {
    const filename = decodeHeaderValue(text(req.headers["x-file-name"]));
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!filename) throw new DocumentParseError("缺少文件名（x-file-name），无法识别文档格式。");
    if (!buffer.length) throw new DocumentParseError("上传文件为空。");
    return parseRequirementDocument(filename, buffer);
  }

  const data = isObject(req.body) ? req.body : {};
  const pasted = text(data.text).trim();
  if (!pasted) throw new DocumentParseError("需求文本为空，请粘贴文本或上传文档。");
  return truncateText(pasted);
}

/** 统一供应商配置：JSON 请求的 provider / ai_config 字段，或文件上传的 x-ai-config 头。 */
function resolveAiConfigSource(req: Request): JsonObject {
  const contentType = text(req.headers["content-type"]).toLowerCase();
  // 文件上传时 body 是 Buffer（不是配置对象），配置只从 x-ai-config 头取
  if (contentType.includes("application/octet-stream")) return headerAiConfig(req);
  if (isObject(req.body)) {
    const data = req.body;
    if (isObject(data.provider)) return data.provider;
    if (isObject(data.ai_config)) return data.ai_config;
    if (isObject(data.aiConfig)) return data.aiConfig;
    if (Object.keys(data).some((key) => key !== "text")) return data;
  }
  return headerAiConfig(req);
}

async function handleAnalyze(req: Request, res: Response): Promise<void> {
  beginSse(res);
  try {
    emitStage(res, "parsing");
    const { text: sourceText, warnings, truncated } = await resolveSourceText(req);
    if (warnings.length) emit(res, "warning", { warnings });

    const config = parseAiRequestConfig(resolveAiConfigSource(req));

    emitStage(res, "analyzing");
    const analysis = await analyzeRequirementText(config, sourceText);

    emitStage(res, "finalizing");
    const result: RequirementAnalysisResult = {
      title: analysis.title,
      tree: analysis.tree,
      findings: analysis.findings,
      sourceText,
      truncated,
      warnings,
    };
    emit(res, "result", result);
    endSse(res, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(res, "error", { message });
    endSse(res, false);
  }
}

function headerAiConfig(req: Request): JsonObject {
  const raw = decodeHeaderValue(text(req.headers["x-ai-config"]));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function registerRequirementRoutes(app: Express): void {
  app.post(
    "/api/requirement-analysis/analyze",
    express.raw({ type: "application/octet-stream", limit: ANALYZE_BODY_LIMIT }),
    (req, res) => { void handleAnalyze(req, res); },
  );

  app.post("/api/requirement-analysis/export/xmind", (req, res) => {
    try {
      const data: JsonObject = isObject(req.body) ? req.body : {};
      const tree = normalizeNode(data.tree);
      if (!tree) {
        res.status(400).json({ success: false, error: "缺少有效的需求分解树（tree）。" });
        return;
      }
      const title = text(data.title).trim() || tree.title;
      const findings = Array.isArray(data.findings)
        ? data.findings.map(normalizeFinding).filter((item): item is Finding => item !== null)
        : [];
      const workbook = buildRequirementXmind({
        title,
        tree,
        findings,
        chartType: normalizeChartType(data.chartType),
      });
      res.setHeader("Content-Type", "application/vnd.xmind.workbook");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeDownloadName(title)}.xmind`);
      res.send(workbook);
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
