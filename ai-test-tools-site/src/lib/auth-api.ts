/** 登录体系 API 封装：统一 401 拦截、CSRF 头自动附加，暴露 auth / 个人偏好 / 云端模型配置 / 管理员端点调用。 */

import { apiFetch, buildUrl, clearCsrfToken, parseJson, setCsrfToken } from './httpClient'
import type { UniversalProvider } from '../shared/api-types'

// 会话安全原语已下沉 httpClient（业务模块共用）：这里转出保持既有调用方 import 路径不变。
export { clearCsrfToken, currentPath, getCsrfToken, setUnauthorizedHandler } from './httpClient'

/** 对外用户视图（与服务端 UserView 对齐，永不携带密码哈希）。 */
export interface AuthUser {
  id: string
  username: string
  isAdmin: boolean
  disabled: boolean
  createdAt: string
  updatedAt: string
}

/** 登录/探测成功后的会话载荷。 */
export interface AuthSession {
  user: AuthUser
  csrfToken: string
}

/** 服务端错误信封 `{ success:false, error:{ code, message } }` 归一化后的异常。 */
export class AuthApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'AuthApiError'
    this.code = code
    this.status = status
  }
}

type ApiEnvelope =
  | ({ success: true } & Record<string, unknown>)
  | { success: false; error?: { code?: string; message?: string } }

type SessionResponse = { user: AuthUser; csrfToken: string }

interface RequestOptions {
  method?: string
  body?: unknown
  /** 登录/注册/me 等请求：401 属于业务结果，不触发全局跳转 */
  skipAuthRedirect?: boolean
}

function toAuthError(data: ApiEnvelope, status: number): AuthApiError {
  const error = data.success === false ? data.error : undefined
  const code = typeof error?.code === 'string' && error.code ? error.code : `HTTP_${status}`
  const message = typeof error?.message === 'string' && error.message ? error.message : `请求失败：${status}`
  return new AuthApiError(message, code, status)
}

async function request<T extends Record<string, unknown>>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  // CSRF 头附加与 401 拦截由 apiFetch 统一处理（skipAuthRedirect 时只清令牌不跳转）
  const response = await apiFetch(
    buildUrl(path),
    {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    { skipAuthRedirect: options.skipAuthRedirect },
  )
  const data = await parseJson<ApiEnvelope>(response)

  if (!response.ok || data.success === false) {
    throw toAuthError(data, response.status)
  }
  return data as T
}

function establishSession(data: SessionResponse): AuthSession {
  setCsrfToken(data.csrfToken)
  return { user: data.user, csrfToken: data.csrfToken }
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const data = await request<SessionResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    skipAuthRedirect: true,
  })
  return establishSession(data)
}

export async function register(username: string, password: string): Promise<AuthSession> {
  const data = await request<SessionResponse>('/api/auth/register', {
    method: 'POST',
    body: { username, password },
    skipAuthRedirect: true,
  })
  return establishSession(data)
}

export async function logout(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST', skipAuthRedirect: true })
  } finally {
    clearCsrfToken()
  }
}

/** 启动探测当前会话；未登录抛 401（skipAuthRedirect），由调用方决定呈现。 */
export async function fetchMe(): Promise<AuthSession> {
  const data = await request<SessionResponse>('/api/auth/me', { skipAuthRedirect: true })
  return establishSession(data)
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request('/api/me/password', { method: 'POST', body: { currentPassword, newPassword } })
}

// ── 管理员：用户管理 ───────────────────────────────────────────────────────

export async function adminListUsers(): Promise<AuthUser[]> {
  const data = await request<{ users: AuthUser[] }>('/api/admin/users')
  return data.users
}

export async function adminCreateUser(username: string, password: string): Promise<AuthUser> {
  const data = await request<{ user: AuthUser }>('/api/admin/users', {
    method: 'POST',
    body: { username, password },
  })
  return data.user
}

export async function adminUpdateUser(
  id: string,
  patch: { disabled?: boolean; newPassword?: string },
): Promise<AuthUser> {
  const data = await request<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  })
  return data.user
}

export async function adminGetRegistrationOpen(): Promise<boolean> {
  const data = await request<{ open: boolean }>('/api/admin/registration')
  return data.open
}

export async function adminSetRegistrationOpen(open: boolean): Promise<boolean> {
  const data = await request<{ open: boolean }>('/api/admin/registration', {
    method: 'PUT',
    body: { open },
  })
  return data.open
}

// ── 个人偏好 ───────────────────────────────────────────────────────────────

export async function putPreference(key: string, value: string): Promise<void> {
  await request(`/api/preferences/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } })
}

export async function getPreference(key: string): Promise<string | null> {
  const data = await request<{ value: string | null }>(`/api/preferences/${encodeURIComponent(key)}`)
  return data.value
}

// ── 云端模型配置 ───────────────────────────────────────────────────────────
// 契约见 docs/wayfinder/auth-storage/spec.md 第 4 节：密钥永不回明文（掩码回显）、
// 编辑留空 apiKey = 保持不变、更新必带 version 乐观锁（409 = 已被其他设备修改）。

/** 云端配置对外视图：UniversalProvider 去掉 apiKey 明文，加掩码与版本号（时间戳为服务端 ISO 串）。 */
export type CloudModelConfigView = Omit<UniversalProvider, 'apiKey' | 'createdAt' | 'updatedAt'> & {
  apiKeyMask: string | null
  version: number
  createdAt: string
  updatedAt: string
}

/** 平铺 body：本地专用字段（id/时间戳）不上送、由服务端接管；apiKey 仅在非空时携带。 */
function toCloudConfigBody(config: UniversalProvider, apiKey?: string): Record<string, unknown> {
  const body: Record<string, unknown> = { ...config }
  delete body['apiKey']
  delete body['id']
  delete body['createdAt']
  delete body['updatedAt']
  const trimmed = apiKey?.trim()
  if (trimmed) body.apiKey = trimmed
  return body
}

export async function listCloudModelConfigs(): Promise<CloudModelConfigView[]> {
  const data = await request<{ configs: CloudModelConfigView[] }>('/api/model-configs')
  return data.configs
}

export async function createCloudModelConfig(config: UniversalProvider, apiKey?: string): Promise<CloudModelConfigView> {
  const data = await request<{ config: CloudModelConfigView }>('/api/model-configs', {
    method: 'POST',
    body: toCloudConfigBody(config, apiKey),
  })
  return data.config
}

/** 更新必带 version（乐观锁）；冲突时服务端 409，由 isCloudModelConfigConflict 判定。 */
export async function updateCloudModelConfig(
  id: string,
  config: UniversalProvider,
  version: number,
  apiKey?: string,
): Promise<CloudModelConfigView> {
  const data = await request<{ config: CloudModelConfigView }>(`/api/model-configs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: { ...toCloudConfigBody(config, apiKey), version },
  })
  return data.config
}

export async function deleteCloudModelConfig(id: string): Promise<void> {
  await request(`/api/model-configs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 未保存配置试连：测的是当前草稿；editingId 存在且 apiKey 留空时复用云端已存密钥。 */
export async function testCloudModelConfig(
  config: UniversalProvider,
  options?: { apiKey?: string; editingId?: string },
): Promise<void> {
  const body = toCloudConfigBody(config, options?.apiKey)
  if (options?.editingId) body.id = options.editingId
  await request('/api/model-configs/test', { method: 'POST', body })
}

/** 已保存云端配置试连：默认用服务端存密钥，apiKey 非空时覆盖。 */
export async function testCloudModelConfigById(id: string, apiKey?: string): Promise<void> {
  const trimmed = apiKey?.trim()
  await request(`/api/model-configs/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    body: trimmed ? { apiKey: trimmed } : {},
  })
}

/** 409 乐观锁冲突：提示「已被其他设备修改，刷新后重试」。 */
export function isCloudModelConfigConflict(error: unknown): boolean {
  return error instanceof AuthApiError && error.status === 409
}
