const DEFAULT_API_BASE = 'http://localhost:3000'

export function getApiBase() {
  // 显式环境变量优先；dev 默认走同源 vite 代理（登录态 Cookie + CSRF Origin 校验要求同源）
  const base = import.meta.env.VITE_JMETER_API_BASE ?? (import.meta.env.DEV ? '' : DEFAULT_API_BASE)
  return base.replace(/\/$/, '')
}

export function buildUrl(path: string) {
  return `${getApiBase()}${path}`
}

export async function parseJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    throw new Error(`响应解析失败：${response.status}`)
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

// ── 会话安全：CSRF 令牌（仅内存）+ 401 统一拦截 ──────────────────────────────

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** CSRF 令牌只存内存：刷新后由 GET /me 重新建立，避免落本地存储扩大 XSS 窃取面。 */
let csrfToken = ''

export function getCsrfToken(): string {
  return csrfToken
}

export function setCsrfToken(token: string): void {
  csrfToken = token
}

export function clearCsrfToken(): void {
  csrfToken = ''
}

/** 401 拦截处理器（AuthProvider 注册路由跳转）；未注册时退化为整页跳转登录页。 */
export type UnauthorizedHandler = (redirectPath: string) => void
let unauthorizedHandler: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

/** 当前站内路径（含查询串），供登录后回跳。 */
export function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`
}

function defaultUnauthorized(redirectPath: string): void {
  // 已在登录/注册页则不跳，避免把用户从表单上弹走
  if (window.location.pathname === '/login' || window.location.pathname === '/register') return
  window.location.assign(`/login?redirect=${encodeURIComponent(redirectPath)}`)
}

function toHeaderRecord(init: HeadersInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!init) return headers
  if (Array.isArray(init)) {
    for (const [key, value] of init) headers[key] = value
    return headers
  }
  if (typeof Headers !== 'undefined' && init instanceof Headers) {
    init.forEach((value, key) => {
      headers[key] = value
    })
    return headers
  }
  return { ...(init as Record<string, string>) }
}

export interface ApiFetchOptions {
  /** 登录/注册/me 等请求：401 属于业务结果，不触发全局跳转 */
  skipAuthRedirect?: boolean
}

/**
 * 统一业务请求入口：修改型方法自动附 `x-csrf-token`（内存态，不落本地存储）；
 * 响应 401 时清令牌并触发未登录处理器（默认整页跳 `/login?redirect=当前路径`）。
 */
export async function apiFetch(
  input: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = toHeaderRecord(init.headers)
  const hasCsrfHeader = Object.keys(headers).some((key) => key.toLowerCase() === 'x-csrf-token')
  if (MUTATING_METHODS.has(method) && csrfToken && !hasCsrfHeader) {
    headers['x-csrf-token'] = csrfToken
  }

  const response = await fetch(input, { ...init, headers })

  if (response.status === 401) {
    clearCsrfToken()
    if (!options.skipAuthRedirect) {
      const handler = unauthorizedHandler ?? defaultUnauthorized
      handler(currentPath())
    }
  }
  return response
}
