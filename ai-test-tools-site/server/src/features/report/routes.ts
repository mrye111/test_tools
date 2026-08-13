import type { Express, Request, Response } from "express";
import { isObject, text } from "../testcase/utils.js";
import { reportDbMode } from "./migrate.js";
import type { CreateReportInput, ReportRepository, ReportSourceType, ReportType } from "./types.js";

const REPORT_TYPES: ReportType[] = ["summary", "brief", "defect", "free"];
const SOURCE_TYPES: ReportSourceType[] = ["text", "csv"];

const MAX_TITLE_LENGTH = 200;
const MAX_HTML_LENGTH = 4 * 1024 * 1024;
const MAX_SOURCE_DIGEST_LENGTH = 1024 * 1024;

function body(req: Request): Record<string, unknown> {
  return isObject(req.body) ? req.body : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ok(res: Response, data: Record<string, unknown> = {}): void {
  res.json({ success: true, ...data });
}

function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ success: false, error: message });
}

function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPES as string[]).includes(value);
}

function isSourceType(value: unknown): value is ReportSourceType {
  return typeof value === "string" && (SOURCE_TYPES as string[]).includes(value);
}

function isLimitError(message: string): boolean {
  return message.includes("已达上限");
}

function isNotFoundError(message: string): boolean {
  return message.includes("不存在");
}

/**
 * 解析创建入参：白名单取字段——modelConfig / apiKey 等凭据字段在此被天然剥离，
 * 永远不会进入仓储层（对齐"凭据不落盘"语义）。
 */
function parseCreateInput(req: Request): { input?: CreateReportInput; error?: string } {
  const raw = body(req);
  const title = text(raw.title).trim();
  if (!title) {
    return { error: "title 不能为空" };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { error: `title 超过 ${MAX_TITLE_LENGTH} 字上限` };
  }
  if (!isReportType(raw.reportType)) {
    return { error: `reportType 必须是 ${REPORT_TYPES.join("/")} 之一` };
  }
  if (!isSourceType(raw.sourceType)) {
    return { error: `sourceType 必须是 ${SOURCE_TYPES.join("/")} 之一` };
  }
  const html = text(raw.html);
  if (!html.trim()) {
    return { error: "html 不能为空" };
  }
  if (html.length > MAX_HTML_LENGTH) {
    return { error: "html 超过大小上限" };
  }
  const sourceDigest = raw.sourceDigest === undefined || raw.sourceDigest === null ? null : text(raw.sourceDigest);
  if (sourceDigest !== null && sourceDigest.length > MAX_SOURCE_DIGEST_LENGTH) {
    return { error: "sourceDigest 超过大小上限" };
  }
  return {
    input: {
      title,
      reportType: raw.reportType,
      sourceType: raw.sourceType,
      sourceDigest,
      chartKinds: raw.chartKinds ?? null,
      html,
    },
  };
}

function parsePageParams(req: Request): { limit: number; offset: number; page: number; pageSize: number } {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
  return { limit: pageSize, offset: (page - 1) * pageSize, page, pageSize };
}

export function registerReportRoutes(app: Express, repo: ReportRepository): void {
  // 存储模式状态（报告页据此提示"数据库不可用不持久保存"）
  app.get("/api/test-report/storage-status", (_req, res) => {
    try {
      ok(res, { mode: reportDbMode() });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 报告记录列表（分页，摘要不含 html / sourceDigest）
  app.get("/api/test-report/reports", async (req, res) => {
    try {
      const { limit, offset, page, pageSize } = parsePageParams(req);
      const [reports, total] = await Promise.all([repo.listReports(limit, offset), repo.countReports()]);
      ok(res, { reports, total, page, pageSize });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 报告记录详情（含 HTML 全文与源数据快照）
  app.get("/api/test-report/reports/:id", async (req, res) => {
    try {
      const report = await repo.getReport(req.params.id);
      if (!report) {
        fail(res, "报告记录不存在", 404);
        return;
      }
      ok(res, { report });
    } catch (error) {
      fail(res, errorMessage(error), 500);
    }
  });

  // 创建报告记录（生成管线产出合格后调用；只保存完成态）
  app.post("/api/test-report/reports", async (req, res) => {
    try {
      const { input, error } = parseCreateInput(req);
      if (!input) {
        fail(res, error ?? "参数错误");
        return;
      }
      const report = await repo.createReport(input);
      ok(res, { report });
    } catch (error) {
      const message = errorMessage(error);
      if (isLimitError(message)) {
        fail(res, message, 409);
        return;
      }
      fail(res, message, 500);
    }
  });

  // 重命名 / 追改内容（body 含 html 时整体替换内容与选型；含 title 时重命名）
  app.patch("/api/test-report/reports/:id", async (req, res) => {
    try {
      const raw = body(req);
      let report = await repo.getReport(req.params.id);
      if (!report) {
        fail(res, "报告记录不存在", 404);
        return;
      }
      const title = text(raw.title).trim();
      if (title) {
        if (title.length > MAX_TITLE_LENGTH) {
          fail(res, `title 超过 ${MAX_TITLE_LENGTH} 字上限`);
          return;
        }
        report = await repo.renameReport(req.params.id, title);
      }
      if (typeof raw.html === "string" && raw.html.trim()) {
        if (raw.html.length > MAX_HTML_LENGTH) {
          fail(res, "html 超过大小上限");
          return;
        }
        report = await repo.updateReportContent(req.params.id, {
          html: raw.html,
          chartKinds: raw.chartKinds ?? null,
        });
      }
      ok(res, { report });
    } catch (error) {
      const message = errorMessage(error);
      if (isNotFoundError(message)) {
        fail(res, message, 404);
        return;
      }
      fail(res, message, 500);
    }
  });

  // 删除报告记录（轻量确认语义由前端承载）
  app.delete("/api/test-report/reports/:id", async (req, res) => {
    try {
      await repo.deleteReport(req.params.id);
      ok(res);
    } catch (error) {
      const message = errorMessage(error);
      if (isNotFoundError(message)) {
        fail(res, message, 404);
        return;
      }
      fail(res, message, 500);
    }
  });
}
