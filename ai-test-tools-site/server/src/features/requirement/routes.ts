import express, { type Express, type Request, type Response } from "express";
import { parseAiRequestConfig } from "../testcase/ai.js";
import type { JsonObject } from "../testcase/types.js";
import { isObject, safeDownloadName, text } from "../testcase/utils.js";
import { sendSseEvent } from "../../ai-generator.js";
import { analyzeRequirementText } from "./ai.js";
import { generateBoardChartDraft } from "./board-ai.js";
import { buildRequirementXmind } from "./exporters.js";
import { DocumentParseError, parseRequirementDocument, truncateText } from "./parsers.js";
import { RequirementAnalysisStore } from "./store.js";
import type { AnalysisRecord, Finding, RequirementAnalysisResult, RequirementChartType, RequirementNode } from "./types.js";

type AnalysisStage = "parsing" | "analyzing" | "finalizing";

type StreamChunkKind = "reasoning" | "content" | "notice";

const ANALYZE_BODY_LIMIT = "10mb";
/** 流式片段的合帧窗口：同 kind 相邻 delta 在此窗口内合并为一个 stream 事件，避免几百个 SSE 小帧。 */
const STREAM_COALESCE_MS = 90;
const STREAM_UNSUPPORTED_NOTICE = "当前模型格式不支持过程输出，请耐心等待";

function flushSse(res: Response): void {
  (res as Response & { flush?: () => void }).flush?.();
}

function emit(res: Response, event: string, data: unknown): void {
  // 客户端断开后跳过写入，避免 write-after-end；未发出的事件随断流一起放弃（ADR 0004）。
  if (res.writableEnded || res.destroyed) return;
  sendSseEvent(res, event, JSON.stringify(data));
  flushSse(res);
}

function emitStage(res: Response, stage: AnalysisStage): void {
  emit(res, "stage", { stage });
}

/**
 * stream 事件的合帧发送器：reasoning/content 先进缓冲按窗口合并；
 * flush() 立即发出缓冲内容（attempt/stage/result/error 等事件发出前必须调用，保证顺序）。
 */
function createStreamEmitter(res: Response): {
  push: (kind: StreamChunkKind, text: string) => void;
  flush: () => void;
} {
  const pending: Record<"reasoning" | "content", string> = { reasoning: "", content: "" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 客户端断开（中途断流视为放弃）：清理合帧定时器与缓冲，之后的 push/flush 均为无操作。
  let closed = false;
  res.on("close", () => {
    closed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending.reasoning = "";
    pending.content = "";
  });

  const flush = (): void => {
    if (closed) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const kind of ["reasoning", "content"] as const) {
      const buffered = pending[kind];
      if (!buffered) continue;
      pending[kind] = "";
      emit(res, "stream", { kind, text: buffered });
    }
  };

  const push = (kind: StreamChunkKind, text: string): void => {
    if (closed || !text) return;
    // notice 不参与合帧，立即发出（发出前 flush 缓冲，保持事件顺序）。
    if (kind === "notice") {
      flush();
      emit(res, "stream", { kind: "notice", text });
      return;
    }
    pending[kind] += text;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, STREAM_COALESCE_MS);
      // 合帧定时器不应阻止进程退出（如测试收尾）。
      (timer as { unref?: () => void }).unref?.();
    }
  };

  return { push, flush };
}

function beginSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function endSse(res: Response, ok: boolean): void {
  if (res.writableEnded || res.destroyed) return;
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

/** 按节点 id 在需求分解树中查找节点，并拼接该节点及其全部子树的标题文本。 */
function findNodeSubtreeText(tree: RequirementNode, nodeId: string): { title: string; text: string } | null {
  const visit = (node: RequirementNode): { title: string; text: string } | null => {
    if (node.id !== nodeId) {
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }
    const lines: string[] = [];
    const collect = (n: RequirementNode, depth: number) => {
      lines.push(`${"  ".repeat(depth)}- ${n.title}`);
      for (const child of n.children) collect(child, depth + 1);
    };
    collect(node, 0);
    return { title: node.title, text: lines.join("\n") };
  };
  return visit(tree);
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
    // 客户端断开即中止上游 AI 流（中途断流视为放弃），释放上游连接，避免无界队列堆积。
    const abort = new AbortController();
    res.on("close", () => abort.abort());

    emitStage(res, "analyzing");
    const stream = createStreamEmitter(res);
    // anthropic / gemini_native 的流式管道是静默降级为一次性返回，没有增量过程可展示。
    if (config.endpointType === "anthropic" || config.endpointType === "gemini_native") {
      stream.push("notice", STREAM_UNSUPPORTED_NOTICE);
    }
    try {
      const analysis = await analyzeRequirementText(config, sourceText, (event) => {
        if (event.type === "attempt") {
          // 重试分隔：先把缓冲的流式片段发出，再立即发 attempt，保证顺序。
          stream.flush();
          emit(res, "attempt", { reason: event.reason });
          return;
        }
        stream.push(event.type, event.text);
      }, abort.signal);
      stream.flush();

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
      stream.flush();
      throw error;
    }
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

const RECORD_NOT_FOUND_ERROR = "分析记录不存在。";

/** 默认 store 与测试用例侧同为模块级单例；集成测试可通过 registerRequirementRoutes 第二参数注入临时目录 store。 */
const defaultAnalysisRecordStore = new RequirementAnalysisStore();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function registerAnalysisRecordRoutes(app: Express, store: RequirementAnalysisStore): void {
  app.get("/api/requirement-analysis/records/:id", (req, res) => {
    try {
      const record = store.getRecord(req.params.id);
      if (!record) {
        res.status(404).json({ success: false, error: RECORD_NOT_FOUND_ERROR });
        return;
      }
      res.json({ success: true, record });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  app.patch("/api/requirement-analysis/records/:id", (req, res) => {
    try {
      const data: JsonObject = isObject(req.body) ? req.body : {};
      const patch: Partial<Pick<AnalysisRecord, "name" | "chartType" | "board">> = {};
      const name = text(data.name).trim();
      // name 去空白后非空才更新（空串视为不改名）；chartType 未传则保持原值，避免 normalize 回退覆盖。
      if (name) patch.name = name;
      if (data.chartType !== undefined) {
        // 非法 chartType 返回 400 而非静默回退 mindmap 覆盖用户已有配置。
        const chartType = text(data.chartType).trim();
        if (chartType !== "tree" && chartType !== "logic" && chartType !== "mindmap") {
          res.status(400).json({ success: false, error: "无效的图表类型（chartType），可选：tree / logic / mindmap。" });
          return;
        }
        patch.chartType = chartType;
      }
      if (data.board !== undefined) patch.board = data.board;
      const record = store.updateRecord(req.params.id, patch);
      if (!record) {
        res.status(404).json({ success: false, error: RECORD_NOT_FOUND_ERROR });
        return;
      }
      res.json({ success: true, record });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  app.delete("/api/requirement-analysis/records/:id", (req, res) => {
    try {
      if (!store.deleteRecord(req.params.id)) {
        res.status(404).json({ success: false, error: RECORD_NOT_FOUND_ERROR });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  app.post("/api/requirement-analysis/records/:id/board/generate", (req, res) => {
    void (async () => {
      try {
        const record = store.getRecord(req.params.id);
        if (!record) {
          res.status(404).json({ success: false, error: RECORD_NOT_FOUND_ERROR });
          return;
        }
        const data: JsonObject = isObject(req.body) ? req.body : {};
        const chartKind = text(data.chartKind).trim();
        if (chartKind !== "cause-effect" && chartKind !== "decision-table" && chartKind !== "orthogonal") {
          res.status(400).json({ success: false, error: "无效的图表类型（chartKind）。" });
          return;
        }
        const found = findNodeSubtreeText(record.tree, text(data.nodeId));
        if (!found) {
          res.status(400).json({ success: false, error: "需求分解树中不存在该节点（nodeId）。" });
          return;
        }
        const config = parseAiRequestConfig(resolveAiConfigSource(req));
        const draft = await generateBoardChartDraft(config, { nodeTitle: found.title, nodeSubtreeText: found.text, chartKind });
        res.json({ success: true, draft });
      } catch (error) {
        res.status(500).json({ success: false, error: errorMessage(error) });
      }
    })();
  });
}

export function registerRequirementRoutes(app: Express, store: RequirementAnalysisStore = defaultAnalysisRecordStore): void {
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

  registerAnalysisRecordRoutes(app, store);
}
