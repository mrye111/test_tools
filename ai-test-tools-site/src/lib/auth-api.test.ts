/** auth-api 单测：CSRF 附加、401 拦截、错误信封归一化。 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adminListUsers,
  changePassword,
  clearCsrfToken,
  createCloudModelConfig,
  deleteCloudModelConfig,
  getCsrfToken,
  isCloudModelConfigConflict,
  listCloudModelConfigs,
  login,
  logout,
  setUnauthorizedHandler,
  testCloudModelConfig,
  testCloudModelConfigById,
  updateCloudModelConfig,
  type AuthUser,
} from './auth-api'
import type { UniversalProvider } from '../shared/api-types'

const testUser: AuthUser = {
  id: 'u-1',
  username: 'amy',
  isAdmin: false,
  disabled: false,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('auth-api', () => {
  beforeEach(() => {
    clearCsrfToken()
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('登录成功保存 csrfToken，并给后续修改型请求自动附加 x-csrf-token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, user: testUser, csrfToken: 'tok-1' }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    const session = await login('amy', 'a'.repeat(16))
    expect(session.user.username).toBe('amy')
    expect(getCsrfToken()).toBe('tok-1')

    await changePassword('a'.repeat(16), 'b'.repeat(16))
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('tok-1')
  })

  it('受保护接口 401 时清空令牌并触发未登录处理器', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, user: testUser, csrfToken: 'tok-2' }))
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: { code: 'UNAUTHORIZED', message: '未登录或会话已过期' } }, 401),
      )
    vi.stubGlobal('fetch', fetchMock)
    const handler = vi.fn()
    setUnauthorizedHandler(handler)

    await login('amy', 'a'.repeat(16))
    await expect(adminListUsers()).rejects.toMatchObject({
      name: 'AuthApiError',
      code: 'UNAUTHORIZED',
      status: 401,
    })
    expect(handler).toHaveBeenCalledWith(expect.any(String))
    expect(getCsrfToken()).toBe('')
  })

  it('登录失败（401）属于业务结果，不触发全局跳转', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ success: false, error: { code: 'UNAUTHORIZED', message: '用户名或密码错误' } }, 401),
        ),
    )
    const handler = vi.fn()
    setUnauthorizedHandler(handler)

    await expect(login('amy', 'wrong-password')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('错误信封的 code 与 message 原样透传（如 429 限速退避）', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { success: false, error: { code: 'RATE_LIMITED', message: '尝试过于频繁，请 30 秒后再试' } },
            429,
          ),
        ),
    )

    await expect(login('amy', 'a'.repeat(16))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: '尝试过于频繁，请 30 秒后再试',
      status: 429,
    })
  })

  it('登出后清空本地令牌', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, user: testUser, csrfToken: 'tok-3' }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    await login('amy', 'a'.repeat(16))
    await logout()
    expect(getCsrfToken()).toBe('')
  })
})

/** 云端模型配置 API：平铺 body、版本回传、409 判定、试连密钥语义。 */
describe('auth-api 云端模型配置', () => {
  const provider: UniversalProvider = {
    id: 'local-id-1',
    name: '我的供应商',
    providerType: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-live-key',
    model: 'openai/gpt-5.5',
    modelOptions: ['openai/gpt-5.5'],
    apiFormat: 'openai_responses',
    createdAt: 1727000000000,
    updatedAt: 1727000000000,
  }

  const cloudView = {
    id: 'cloud-1',
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    model: provider.model,
    modelOptions: provider.modelOptions,
    apiFormat: provider.apiFormat,
    apiKeyMask: 'sk***ey',
    version: 2,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  }

  beforeEach(() => {
    clearCsrfToken()
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('列表返回 configs 数组', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, configs: [cloudView] })))
    const configs = await listCloudModelConfigs()
    expect(configs).toEqual([cloudView])
    const [url] = vi.mocked(fetch).mock.calls[0] as [string]
    expect(url).toContain('/api/model-configs')
  })

  it('新建：平铺 UniversalProvider + apiKey，剥离本地 id/时间戳', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, config: cloudView }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const created = await createCloudModelConfig(provider, provider.apiKey)
    expect(created.id).toBe('cloud-1')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.apiKey).toBe('sk-live-key')
    expect(body.baseUrl).toBe(provider.baseUrl)
    expect(body.id).toBeUndefined()
    expect(body.createdAt).toBeUndefined()
    expect(body.updatedAt).toBeUndefined()
  })

  it('新建：apiKey 留空则不携带该字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, config: cloudView }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await createCloudModelConfig(provider, '   ')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect('apiKey' in body).toBe(false)
  })

  it('更新：必带 version；apiKey 留空 = 保持不变（不上送）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, config: cloudView }))
    vi.stubGlobal('fetch', fetchMock)

    await updateCloudModelConfig('cloud-1', provider, 7)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/model-configs/cloud-1')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.version).toBe(7)
    expect('apiKey' in body).toBe(false)

    await updateCloudModelConfig('cloud-1', provider, 7, 'sk-new')
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect((JSON.parse(String(init2.body)) as Record<string, unknown>).apiKey).toBe('sk-new')
  })

  it('409 冲突被 isCloudModelConfigConflict 识别，其他错误不误判', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ success: false, error: { code: 'CONFLICT', message: '已被其他设备修改，刷新后重试' } }, 409),
      ),
    )

    let caught: unknown
    await updateCloudModelConfig('cloud-1', provider, 1).catch((error: unknown) => {
      caught = error
    })
    expect(isCloudModelConfigConflict(caught)).toBe(true)
    expect(isCloudModelConfigConflict(new Error('x'))).toBe(false)
  })

  it('删除调用 DELETE 端点', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteCloudModelConfig('cloud-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/model-configs/cloud-1')
    expect(init.method).toBe('DELETE')
  })

  it('未保存配置试连：携带草稿与 editingId，apiKey 留空不覆盖', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    await testCloudModelConfig(provider, { editingId: 'cloud-1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/model-configs/test')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.id).toBe('cloud-1')
    expect(body.baseUrl).toBe(provider.baseUrl)
    expect('apiKey' in body).toBe(false)
  })

  it('按 id 试连：默认空 body 用服务端存密钥，传 apiKey 则覆盖', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    await testCloudModelConfigById('cloud-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/model-configs/cloud-1/test')
    expect(JSON.parse(String(init.body))).toEqual({})

    await testCloudModelConfigById('cloud-1', 'sk-override')
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(init2.body))).toEqual({ apiKey: 'sk-override' })
  })
})
