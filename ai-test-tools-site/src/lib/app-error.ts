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

function hasEnglishFragments(message: string) {
  return /[A-Za-z]{3,}/.test(message)
}

function extractHttpStatus(message: string) {
  const match = message.match(/\bHTTP\s+(\d{3})\b/i)
  return match ? Number(match[1]) : null
}

function normalizeWhitespace(message: string) {
  return message
    .replace(/^Error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveHttpStatusMessage(status: number) {
  if (status === 400) return '请求参数有误，请检查填写内容后重试。'
  if (status === 401) return '接口认证失败，请检查 API Key、登录状态或访问凭证。'
  if (status === 403) return '当前请求被服务端拒绝，请确认权限和配置是否正确。'
  if (status === 404) return '请求的接口不存在，请检查接口地址或服务是否已启动。'
  if (status === 405) return '当前接口不支持这种调用方式，请检查请求配置后重试。'
  if (status === 408 || status === 504) return '请求超时，请稍后重试。'
  if (status === 409) return '当前数据状态已发生变化，请刷新后重试。'
  if (status === 429) return '请求过于频繁，请稍等片刻后再试。'
  if (status >= 500) return '服务暂时不可用，请稍后再试。'
  return ''
}

function matchFriendlyMessage(message: string) {
  const normalized = message.toLowerCase()
  const httpStatus = extractHttpStatus(message)
  const statusMessage = httpStatus ? resolveHttpStatusMessage(httpStatus) : ''
  if (statusMessage) {
    if (normalized.includes('ai request failed')) {
      return httpStatus === 401 || httpStatus === 403
        ? '模型服务认证失败，请检查 API Key 或权限配置后重试。'
        : httpStatus === 404
          ? '模型接口地址不存在，请检查 API 地址配置后重试。'
          : statusMessage
    }
    return statusMessage
  }

  if (
    normalized.includes('api_key is required')
    || normalized.includes('api key is required')
  ) {
    return '缺少 API Key，请先在模型设置中补全后再重试。'
  }

  if (
    normalized.includes('base_url must start with http:// or https://')
    || normalized.includes('base url is empty')
  ) {
    return 'API 地址格式不正确，请填写以 http:// 或 https:// 开头的完整地址。'
  }

  if (
    normalized.includes('failed to fetch')
    || normalized.includes('networkerror')
    || normalized.includes('network request failed')
    || normalized.includes('load failed')
    || normalized.includes('econnrefused')
    || normalized.includes('enotfound')
    || normalized.includes('request failed:')
    || normalized.includes('timeout')
  ) {
    return '无法连接到服务，请检查网络、接口地址或服务状态后重试。'
  }

  if (normalized.includes('failed to parse models response')) {
    return '模型列表响应无法解析，请确认接口地址是否正确。'
  }

  if (normalized.includes('all candidates failed')) {
    return '无法读取模型列表，请检查 API 地址、模型列表地址或供应商兼容性。'
  }

  if (normalized.includes('ai response has no message content')) {
    return '模型返回内容为空，请稍后重试或切换其他模型。'
  }

  if (normalized.includes('missing path query parameter')) {
    return '缺少下载路径，请重新生成文件后再试。'
  }

  if (normalized.includes('only files under server/generated are allowed')) {
    return '下载路径无效，请重新生成文件后再试。'
  }

  if (normalized.includes('only .jmx files can be downloaded')) {
    return '当前只支持下载 JMX 文件，请重新生成后再试。'
  }

  if (normalized.includes('file not found')) {
    return '文件不存在或已被清理，请重新生成后再下载。'
  }

  if (normalized.includes('invalid session')) {
    return '当前会话已失效，请刷新页面后重试。'
  }

  if (normalized.includes('project_id is required') || normalized.includes('projectid is required')) {
    return '缺少项目标识，请刷新页面后重试。'
  }

  if (normalized.includes('id and testsetid are required')) {
    return '缺少必要标识，请刷新页面后重试。'
  }

  if (normalized.includes('no image data provided')) {
    return '请先上传需要识别的图片。'
  }

  if (normalized.includes('parse or dispatch error')) {
    return '服务请求解析失败，请稍后重试。'
  }

  if (normalized.includes('unknown tool')) {
    return '系统调用了未注册的工具，请稍后重试。'
  }

  return ''
}

export function normalizeErrorMessage(error: unknown, options: NormalizeErrorOptions = {}) {
  const fallbackMessage = options.fallbackMessage ?? '操作失败，请稍后重试。'
  const rawMessage = normalizeWhitespace(readErrorMessage(error))
  if (!rawMessage) return fallbackMessage

  const friendlyMessage = matchFriendlyMessage(rawMessage)
  if (friendlyMessage) return friendlyMessage

  if (hasEnglishFragments(rawMessage)) {
    return fallbackMessage
  }

  return rawMessage
}
