import pino from "pino";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

// ── 日志目录 ──────────────────────────────────────────────────────────────────

const LOG_DIR = resolve(process.cwd(), "server", "logs");
const isDev = process.env.NODE_ENV !== "production";

// ── Logger 实例 ───────────────────────────────────────────────────────────────

function createLogger(): pino.Logger {
  mkdirSync(LOG_DIR, { recursive: true });

  if (isDev) {
    return pino({
      level: process.env.LOG_LEVEL ?? "debug",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    });
  }

  // 生产：按天轮转的文件输出
  const day = new Date().toISOString().slice(0, 10);
  const filePath = resolve(LOG_DIR, `app-${day}.log`);

  return pino(
    { level: process.env.LOG_LEVEL ?? "info" },
    pino.destination(filePath),
  );
}

export const logger = createLogger();

// ── Span 工具函数 ─────────────────────────────────────────────────────────────

export type SpanType = "http" | "ai" | "store" | "tool" | "export";

export interface SpanOptions {
  name: string;
  type: SpanType;
  attributes?: Record<string, unknown>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  type: SpanType;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "ok" | "error";
  error?: { message: string; stack?: string };
  attributes: Record<string, unknown>;
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function createSpan(traceId: string, parentSpanId: string | undefined, opts: SpanOptions): Span {
  return {
    traceId,
    spanId: randomId(),
    parentSpanId,
    name: opts.name,
    type: opts.type,
    startTime: performance.now(),
    status: "ok",
    attributes: opts.attributes ?? {},
  };
}

export function finishSpan(span: Span, status: "ok" | "error" = "ok", error?: Error): void {
  span.endTime = performance.now();
  span.duration = Math.round(span.endTime - span.startTime);
  span.status = status;
  if (error) {
    span.error = { message: error.message, stack: error.stack };
  }
  // 写入日志
  const level = status === "error" ? "error" : "info";
  logger[level](
    { span: { traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId, type: span.type, duration: span.duration, status: span.status, attributes: span.attributes, ...(span.error ? { error: span.error } : {}) } },
    span.name,
  );
}

export { LOG_DIR };
