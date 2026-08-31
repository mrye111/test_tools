/**
 * 服务端错误文案归一化（面向用户的错误语言唯一权威来源）。
 *
 * 约定：凡是要写入数据库或经 SSE/HTTP 送达前端的错误消息，必须先过 normalizeErrorMessage。
 * 原始错误（含供应商 JSON、堆栈、账号与 request id 等排障信息）只进服务端日志 / trace，
 * 不落库、不进 UI。
 */

export type NormalizeErrorOptions = {
  /** 无法识别时的兜底文案 */
  fallbackMessage?: string;
};

const DEFAULT_FALLBACK = "操作失败，请稍后重试。";

function readErrorMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (error && typeof error === "object") {
    const withMessage = error as { message?: unknown; error?: unknown };
    if (typeof withMessage.message === "string") return withMessage.message.trim();
    if (typeof withMessage.error === "string") return withMessage.error.trim();
  }
  return "";
}

function normalizeWhitespace(message: string): string {
  return message.replace(/^Error:\s*/i, "").replace(/\s+/g, " ").trim();
}

/** 含中文即视为"已是友好文案"，直通。 */
function hasCjk(message: string): boolean {
  return /[\u4e00-\u9fff]/.test(message);
}

function extractHttpStatus(message: string): number | null {
  const match = message.match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

function resolveHttpStatusMessage(status: number): string {
  if (status === 400) return "请求参数有误，请检查填写内容后重试。";
  if (status === 401) return "接口认证失败，请检查 API Key、登录状态或访问凭证。";
  if (status === 403) return "当前请求被服务端拒绝，请确认权限和配置是否正确。";
  if (status === 404) return "请求的接口不存在，请检查接口地址或服务是否已启动。";
  if (status === 405) return "当前接口不支持这种调用方式，请检查请求配置后重试。";
  if (status === 408 || status === 504) return "请求超时，请稍后重试。";
  if (status === 409) return "当前数据状态已发生变化，请刷新后重试。";
  if (status === 429) return "请求过于频繁，请稍等片刻后再试。";
  if (status >= 500) return "服务暂时不可用，请稍后再试。";
  return "";
}

/** AI 供应商错误码 / 关键字 → 面向用户的指引。 */
function matchAiVendorMessage(normalized: string): string {
  // 订阅无效 / 过期（火山 CodingPlan InvalidSubscription 等）
  if (normalized.includes("invalidsubscription") || normalized.includes("subscription has expired")) {
    return "模型服务订阅无效或已过期，请到供应商控制台检查订阅或续费状态后重试。";
  }
  // 额度 / 配额不足
  if (
    normalized.includes("insufficient") && normalized.includes("quota")
    || normalized.includes("quota exceeded")
    || normalized.includes("balance") && normalized.includes("insufficient")
  ) {
    return "模型服务额度不足，请充值或调整配额后重试。";
  }
  // 模型不存在 / 未开通
  if (
    normalized.includes("model_not_found")
    || normalized.includes("model not found")
    || normalized.includes("does not exist") && normalized.includes("model")
    || normalized.includes("notfound") && normalized.includes("model")
  ) {
    return "所选模型不存在或未开通，请到模型设置中切换可用模型后重试。";
  }
  // 上下文超长
  if (
    normalized.includes("context length")
    || normalized.includes("maximum context")
    || normalized.includes("too many tokens")
    || normalized.includes("context window")
  ) {
    return "输入内容超出模型上下文上限，请精简内容或分段后重试。";
  }
  // 内容安全拦截
  if (normalized.includes("content_filter") || normalized.includes("content filter")) {
    return "输入内容被模型安全策略拦截，请调整表述后重试。";
  }
  return "";
}

function matchFriendlyMessage(message: string): string {
  const normalized = message.toLowerCase();

  const vendorMessage = matchAiVendorMessage(normalized);
  if (vendorMessage) return vendorMessage;

  const httpStatus = extractHttpStatus(message);
  const statusMessage = httpStatus ? resolveHttpStatusMessage(httpStatus) : "";
  if (statusMessage) {
    if (normalized.includes("ai request failed")) {
      return httpStatus === 401 || httpStatus === 403
        ? "模型服务认证失败，请检查 API Key 或权限配置后重试。"
        : httpStatus === 404
          ? "模型接口地址不存在，请检查 API 地址配置后重试。"
          : statusMessage;
    }
    return statusMessage;
  }

  if (normalized.includes("api_key is required") || normalized.includes("api key is required")) {
    return "缺少 API Key，请先在模型设置中补全后再重试。";
  }
  if (
    normalized.includes("base_url must start with http:// or https://")
    || normalized.includes("base url is empty")
  ) {
    return "API 地址格式不正确，请填写以 http:// 或 https:// 开头的完整地址。";
  }
  if (
    normalized.includes("failed to fetch")
    || normalized.includes("networkerror")
    || normalized.includes("network request failed")
    || normalized.includes("load failed")
    || normalized.includes("econnrefused")
    || normalized.includes("enotfound")
    || normalized.includes("request failed:")
    || normalized.includes("timeout")
    || normalized.includes("timed out")
  ) {
    return "无法连接到服务，请检查网络、接口地址或服务状态后重试。";
  }
  if (normalized.includes("failed to parse models response")) {
    return "模型列表响应无法解析，请确认接口地址是否正确。";
  }
  if (normalized.includes("all candidates failed")) {
    return "无法读取模型列表，请检查 API 地址、模型列表地址或供应商兼容性。";
  }
  if (normalized.includes("ai response has no message content")) {
    return "模型返回内容为空，请稍后重试或切换其他模型。";
  }
  if (normalized.includes("invalid session")) {
    return "当前会话已失效，请刷新页面后重试。";
  }
  return "";
}

/**
 * 把任意错误归一化为面向用户的友好文案。
 * 识别成功返回映射文案；含中文的未知消息直通（视为已友好）；其余返回兜底文案。
 */
export function normalizeErrorMessage(error: unknown, options: NormalizeErrorOptions = {}): string {
  const fallbackMessage = options.fallbackMessage ?? DEFAULT_FALLBACK;
  const rawMessage = normalizeWhitespace(readErrorMessage(error));
  if (!rawMessage) return fallbackMessage;

  const friendlyMessage = matchFriendlyMessage(rawMessage);
  if (friendlyMessage) return friendlyMessage;

  if (hasCjk(rawMessage)) return rawMessage;

  return fallbackMessage;
}
