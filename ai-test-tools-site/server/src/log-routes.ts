import type { Express, Request, Response } from "express";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { LOG_DIR } from "./logger.js";

interface LogEntry {
  time?: string;
  level?: number;
  msg?: string;
  span?: {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    type: string;
    duration?: number;
    status?: string;
    attributes?: Record<string, unknown>;
    error?: { message: string; stack?: string };
  };
  [key: string]: unknown;
}

function parseLogLevel(level: number | string | undefined): string {
  if (typeof level === "number") {
    if (level >= 60) return "fatal";
    if (level >= 50) return "error";
    if (level >= 40) return "warn";
    if (level >= 30) return "info";
    if (level >= 20) return "debug";
    return "trace";
  }
  return String(level ?? "unknown");
}

function getLogFiles(): string[] {
  if (!existsSync(LOG_DIR)) return [];
  return readdirSync(LOG_DIR)
    .filter((f) => f.endsWith(".log"))
    .sort()
    .reverse()
    .slice(0, 10);
}

function readLogEntries(filePath: string): LogEntry[] {
  try {
    const content = readFileSync(filePath, "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is LogEntry => entry !== null);
  } catch {
    return [];
  }
}

export function registerLogRoutes(app: Express): void {
  // GET /api/logs - 查询日志
  app.get("/api/logs", (req: Request, res: Response) => {
    try {
      const { traceId, level, limit: limitStr, date } = req.query;

      const limit = Math.min(Math.max(Number(limitStr) || 100, 1), 1000);
      const targetDate = typeof date === "string" ? date : new Date().toISOString().slice(0, 10);

      // 获取日志文件
      const logFiles = getLogFiles();
      const targetFile = logFiles.find((f) => f.includes(targetDate));

      if (!targetFile) {
        res.json({
          success: true,
          data: [],
          meta: { date: targetDate, total: 0, files: logFiles },
        });
        return;
      }

      // 读取并过滤日志
      let entries = readLogEntries(resolve(LOG_DIR, targetFile));

      // 按 traceId 过滤
      if (typeof traceId === "string" && traceId) {
        entries = entries.filter((entry) => entry.span?.traceId === traceId);
      }

      // 按级别过滤
      if (typeof level === "string" && level) {
        const levelNum = level.toLowerCase();
        entries = entries.filter((entry) => {
          const entryLevel = parseLogLevel(entry.level);
          return entryLevel === levelNum;
        });
      }

      // 按时间倒序，限制数量
      const result = entries.slice(-limit).reverse();

      res.json({
        success: true,
        data: result.map((entry) => ({
          time: entry.time,
          level: parseLogLevel(entry.level),
          message: entry.msg,
          traceId: entry.span?.traceId,
          spanId: entry.span?.spanId,
          parentSpanId: entry.span?.parentSpanId,
          spanType: entry.span?.type,
          duration: entry.span?.duration,
          status: entry.span?.status,
          attributes: entry.span?.attributes,
          error: entry.span?.error,
        })),
        meta: {
          date: targetDate,
          total: entries.length,
          returned: result.length,
          files: logFiles,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /api/logs/trace/:traceId - 查询完整 trace 链路
  app.get("/api/logs/trace/:traceId", (req: Request, res: Response) => {
    try {
      const { traceId } = req.params;
      const { date } = req.query;
      const targetDate = typeof date === "string" ? date : new Date().toISOString().slice(0, 10);

      const logFiles = getLogFiles();
      const targetFile = logFiles.find((f) => f.includes(targetDate));

      if (!targetFile) {
        res.json({
          success: true,
          data: { traceId, spans: [], summary: null },
        });
        return;
      }

      // 读取所有日志并按 traceId 过滤
      const entries = readLogEntries(resolve(LOG_DIR, targetFile));
      const traceEntries = entries.filter((entry) => entry.span?.traceId === traceId);

      // 构建 span 树
      const spans = traceEntries
        .filter((entry) => entry.span)
        .map((entry) => ({
          spanId: entry.span!.spanId,
          parentSpanId: entry.span!.parentSpanId,
          name: entry.msg,
          type: entry.span!.type,
          duration: entry.span!.duration,
          status: entry.span!.status,
          attributes: entry.span!.attributes,
          error: entry.span!.error,
          time: entry.time,
        }))
        .sort((a, b) => {
          // 根 span 在前，然后按时间排序
          if (!a.parentSpanId) return -1;
          if (!b.parentSpanId) return 1;
          return (a.time ?? "").localeCompare(b.time ?? "");
        });

      // 计算摘要
      const totalDuration = spans.reduce((sum, s) => sum + (s.duration ?? 0), 0);
      const errorCount = spans.filter((s) => s.status === "error").length;

      res.json({
        success: true,
        data: {
          traceId,
          spans,
          summary: {
            totalSpans: spans.length,
            totalDuration,
            errorCount,
            types: [...new Set(spans.map((s) => s.type))],
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
