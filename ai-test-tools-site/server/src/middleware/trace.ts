import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
import { createSpan, finishSpan, type Span, type SpanOptions } from "../logger.js";

// ── Trace Context ────────────────────────────────────────────────────────────

export interface TraceContext {
  traceId: string;
  rootSpan: Span;
  currentSpanId: string;
}

const traceStore = new AsyncLocalStorage<TraceContext>();

export function getTraceContext(): TraceContext | undefined {
  return traceStore.getStore();
}

export function getTraceId(): string | undefined {
  return getTraceContext()?.traceId;
}

/**
 * 在当前 trace 上下文中创建子 span 并执行操作。
 * 自动记录耗时和错误。
 */
export async function withSpan<T>(opts: SpanOptions, fn: (span: Span) => Promise<T>): Promise<T> {
  const ctx = getTraceContext();
  if (!ctx) return fn(createSpan("no-trace", undefined, opts));

  const span = createSpan(ctx.traceId, ctx.currentSpanId, opts);
  const prevSpanId = ctx.currentSpanId;
  ctx.currentSpanId = span.spanId;

  try {
    const result = await fn(span);
    finishSpan(span, "ok");
    return result;
  } catch (error) {
    finishSpan(span, "error", error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    ctx.currentSpanId = prevSpanId;
  }
}

/**
 * 同步版本的 withSpan，用于 JMeter 内存操作等同步函数。
 */
export function withSpanSync<T>(opts: SpanOptions, fn: (span: Span) => T): T {
  const ctx = getTraceContext();
  if (!ctx) return fn(createSpan("no-trace", undefined, opts));

  const span = createSpan(ctx.traceId, ctx.currentSpanId, opts);
  const prevSpanId = ctx.currentSpanId;
  ctx.currentSpanId = span.spanId;

  try {
    const result = fn(span);
    finishSpan(span, "ok");
    return result;
  } catch (error) {
    finishSpan(span, "error", error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    ctx.currentSpanId = prevSpanId;
  }
}

// ── Express Middleware ────────────────────────────────────────────────────────

export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = (req.headers["x-trace-id"] as string) ?? crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  const rootSpan = createSpan(traceId, undefined, {
    name: `${req.method} ${req.path}`,
    type: "http",
    attributes: {
      method: req.method,
      path: req.path,
      query: req.query,
      userAgent: req.headers["user-agent"],
      contentLength: req.headers["content-length"],
    },
  });

  const ctx: TraceContext = {
    traceId,
    rootSpan,
    currentSpanId: rootSpan.spanId,
  };

  // 将 traceId 挂到 req 上供后续使用
  (req as Request & { traceId?: string }).traceId = traceId;

  traceStore.run(ctx, () => {
    // 响应结束时关闭根 span
    res.on("finish", () => {
      rootSpan.attributes.statusCode = res.statusCode;
      if (res.statusCode >= 400) {
        finishSpan(rootSpan, "error");
      } else {
        finishSpan(rootSpan, "ok");
      }
    });
    next();
  });
}
