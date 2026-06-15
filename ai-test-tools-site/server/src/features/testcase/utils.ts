import { randomUUID } from "node:crypto";
import type { JsonObject } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown, fallback = ""): string {
  return value === undefined || value === null ? fallback : String(value);
}

export function firstText(args: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function boolValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function numberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0);
}

export function safeDownloadName(value: unknown, fallback = "download"): string {
  return encodeURIComponent(text(value, fallback).trim() || fallback);
}

export function extractJsonObjectText(content: string): string {
  const textValue = content.trim();
  const fenced = textValue.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : textValue;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型未返回可解析的 JSON 对象");
  return candidate.slice(start, end + 1);
}

export function parseMaybeJsonObject(content: string): JsonObject | null {
  try {
    const parsed = JSON.parse(extractJsonObjectText(content));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
