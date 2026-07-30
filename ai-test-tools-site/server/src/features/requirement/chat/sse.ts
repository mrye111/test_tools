import type { Response } from "express";
import { sendSseEvent } from "../../../ai-generator.js";

export function flushSse(res: Response): void {
  (res as Response & { flush?: () => void }).flush?.();
}

export function emit(res: Response, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  sendSseEvent(res, event, JSON.stringify(data));
  flushSse(res);
}

export function beginSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

export function endSse(res: Response, ok: boolean): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: end\ndata: ${JSON.stringify({ ok })}\n\n`);
  res.end();
}
