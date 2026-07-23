export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly cause?: Error;

  constructor(params: {
    code: string;
    message: string;
    httpStatus?: number;
    cause?: Error;
  }) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.httpStatus = params.httpStatus ?? 500;
    this.cause = params.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...(this.cause ? { cause: this.cause.message } : {}),
    };
  }
}

// ── 常用错误工厂 ─────────────────────────────────────────────────────────────

export function badRequest(message: string, cause?: Error): AppError {
  return new AppError({ code: "BAD_REQUEST", message, httpStatus: 400, cause });
}

export function notFound(message: string, cause?: Error): AppError {
  return new AppError({ code: "NOT_FOUND", message, httpStatus: 404, cause });
}

export function internal(message: string, cause?: Error): AppError {
  return new AppError({ code: "INTERNAL", message, httpStatus: 500, cause });
}

export function aiError(message: string, cause?: Error): AppError {
  return new AppError({ code: "AI_ERROR", message, httpStatus: 502, cause });
}

export function storeError(message: string, cause?: Error): AppError {
  return new AppError({ code: "STORE_ERROR", message, httpStatus: 500, cause });
}
