/** httpClient.apiFetch 单测：CSRF 头自动附加规则、401 统一拦截与豁免语义。 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiFetch,
  clearCsrfToken,
  getCsrfToken,
  setCsrfToken,
  setUnauthorizedHandler,
} from './httpClient'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('apiFetch CSRF 头', () => {
  beforeEach(() => {
    clearCsrfToken()
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('修改型方法（POST/PUT/PATCH/DELETE）自动附加 x-csrf-token，保留既有头', async () => {
    setCsrfToken('tok-a')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    await apiFetch('/api/x', { method: 'PUT' })
    await apiFetch('/api/x', { method: 'PATCH' })
    await apiFetch('/api/x', { method: 'DELETE' })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      const headers = init.headers as Record<string, string>
      expect(headers['x-csrf-token']).toBe('tok-a')
    }
    const firstHeaders = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>
    expect(firstHeaders['Content-Type']).toBe('application/json')
  })

  it('GET 不附加、无令牌不附加、调用方已带同名头不覆盖', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    setCsrfToken('tok-b')
    await apiFetch('/api/x')
    await apiFetch('/api/x', { method: 'POST', headers: { 'X-CSRF-Token': 'caller-token' } })

    clearCsrfToken()
    await apiFetch('/api/x', { method: 'POST' })

    const [getInit, postInit, noTokenInit] = (fetchMock.mock.calls as [string, RequestInit][]).map(([, init]) => init)
    expect((getInit.headers as Record<string, string>)['x-csrf-token']).toBeUndefined()
    // 调用方已带同名头（大小写不敏感）则原样保留，不重复附加
    expect((postInit.headers as Record<string, string>)['X-CSRF-Token']).toBe('caller-token')
    expect('x-csrf-token' in (postInit.headers as Record<string, string>)).toBe(false)
    expect((noTokenInit.headers as Record<string, string>)['x-csrf-token']).toBeUndefined()
    expect(getCsrfToken()).toBe('')
  })
})

describe('apiFetch 401 拦截', () => {
  beforeEach(() => {
    clearCsrfToken()
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('401 清空令牌并触发未登录处理器，响应原样交还调用方', async () => {
    setCsrfToken('tok-c')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)))
    const handler = vi.fn()
    setUnauthorizedHandler(handler)

    const response = await apiFetch('/api/protected', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(handler).toHaveBeenCalledWith(expect.stringContaining(window.location.pathname))
    expect(getCsrfToken()).toBe('')
  })

  it('skipAuthRedirect（登录/注册/me）：401 只清令牌，不触发跳转', async () => {
    setCsrfToken('tok-d')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad credentials' }, 401)))
    const handler = vi.fn()
    setUnauthorizedHandler(handler)

    const response = await apiFetch('/api/auth/login', { method: 'POST' }, { skipAuthRedirect: true })

    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(getCsrfToken()).toBe('')
  })

  it('非 401 响应不触发处理器、不清令牌', async () => {
    setCsrfToken('tok-e')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 500)))
    const handler = vi.fn()
    setUnauthorizedHandler(handler)

    await apiFetch('/api/protected')

    expect(handler).not.toHaveBeenCalled()
    expect(getCsrfToken()).toBe('tok-e')
  })
})
