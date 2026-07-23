import type { JsonObject } from "./jmx-serializer.js";

/**
 * Stable error codes for tool failures (ADR-0002).
 *
 * - `unknown-type`: a `*_type` argument did not match any supported element type.
 * - `not-found`: a file, tree path, or tool does not exist.
 * - `invalid-args`: the arguments themselves are malformed or target an illegal operation.
 * - `invalid-state`: the test plan is not in the required state (e.g. no plan/thread group yet).
 * - `io-error`: a filesystem read/write failed.
 * - `execution-error`: an external process (JMeter) failed.
 * - `internal`: anything unexpected.
 */
export type ToolErrorCode = "unknown-type" | "not-found" | "invalid-args" | "invalid-state" | "io-error" | "execution-error" | "internal";

export type ToolResult =
  | { ok: true; message: string; data?: JsonObject }
  | { ok: false; error: { code: ToolErrorCode; message: string } };

export function ok(message: string, data?: JsonObject): ToolResult {
  return data === undefined ? { ok: true, message } : { ok: true, message, data };
}

export function err(code: ToolErrorCode, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

/**
 * Thrown by internal guards/resolvers inside TestPlanService and converted to a
 * typed ToolResult by the service's `run` boundary. Not part of the public API.
 */
export class ToolError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

/** Human-readable text of a ToolResult, for channels that only carry text. */
export function resultText(result: ToolResult): string {
  return result.ok ? result.message : result.error.message;
}
