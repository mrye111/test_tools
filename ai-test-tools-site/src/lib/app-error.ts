/**
 * 前端错误文案兜底归一化（极简版）。
 *
 * 职责边界：业务错误文案由服务端在写入/响应边界统一归一化（server/src/error-message.ts），
 * 前端只处理"根本没能到达服务端"的错误——网络层失败、客户端本地校验，
 * 以及理论上不应出现的未归一化原文（纯英文 → 兜底文案）。
 * 含中文的消息视为服务端已归一化的友好文案，原样直通。
 */

type NormalizeErrorOptions = {
  fallbackMessage?: string
}

function readErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error.trim()
  if (error instanceof Error) return error.message.trim()
  if (error && typeof error === 'object') {
    const withMessage = error as { message?: unknown; error?: unknown }
    if (typeof withMessage.message === 'string') return withMessage.message.trim()
    if (typeof withMessage.error === 'string') return withMessage.error.trim()
  }
  return ''
}

function normalizeWhitespace(message: string) {
  return message
    .replace(/^Error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 含中文即视为服务端已归一化的友好文案。 */
function hasCjk(message: string) {
  return /[\u4e00-\u9fff]/.test(message)
}

/** 网络层失败：请求未能到达服务端或连接中断。 */
function isNetworkFailure(normalized: string) {
  return (
    normalized.includes('failed to fetch')
    || normalized.includes('networkerror')
    || normalized.includes('network request failed')
    || normalized.includes('load failed')
    || normalized.includes('econnrefused')
    || normalized.includes('enotfound')
    || normalized.includes('timeout')
    || normalized.includes('timed out')
  )
}

const NETWORK_FAILURE_MESSAGE = '无法连接到服务，请检查网络、接口地址或服务状态后重试。'

export function normalizeErrorMessage(error: unknown, options: NormalizeErrorOptions = {}) {
  const fallbackMessage = options.fallbackMessage ?? '操作失败，请稍后重试。'
  const rawMessage = normalizeWhitespace(readErrorMessage(error))
  if (!rawMessage) return fallbackMessage

  if (isNetworkFailure(rawMessage.toLowerCase())) {
    return NETWORK_FAILURE_MESSAGE
  }

  if (hasCjk(rawMessage)) return rawMessage

  return fallbackMessage
}
