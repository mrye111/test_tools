/** preference-migration 单测：首登偏好上送的幂等与失败保留语义。 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCsrfToken, setUnauthorizedHandler } from './auth-api'
import { listMigratablePreferenceKeys, migrateLocalPreferences } from './preference-migration'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('preference-migration', () => {
  beforeEach(() => {
    localStorage.clear()
    clearCsrfToken()
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listMigratablePreferenceKeys 只命中约定前缀', () => {
    localStorage.setItem('ai-run-entry:set-1', 'https://a.example')
    localStorage.setItem('requirement-import-entry-r1', 'https://b.example')
    localStorage.setItem('unrelated-key', 'keep')
    expect(listMigratablePreferenceKeys().sort()).toEqual([
      'ai-run-entry:set-1',
      'requirement-import-entry-r1',
    ])
  })

  it('上送成功后删除本地键，无关键不动', async () => {
    localStorage.setItem('ai-run-entry:set-1', 'https://a.example')
    localStorage.setItem('requirement-import-entry-r1', 'https://b.example')
    localStorage.setItem('unrelated-key', 'keep')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await migrateLocalPreferences()
    expect(result).toEqual({ migrated: 2, skipped: 0, failed: 0 })
    expect(localStorage.getItem('ai-run-entry:set-1')).toBeNull()
    expect(localStorage.getItem('requirement-import-entry-r1')).toBeNull()
    expect(localStorage.getItem('unrelated-key')).toBe('keep')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('上送失败保留本地键，留待下次登录重试', async () => {
    localStorage.setItem('ai-run-entry:set-2', 'https://c.example')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ success: false, error: { code: 'CSRF_INVALID', message: 'CSRF 校验失败' } }, 403),
        ),
    )

    const result = await migrateLocalPreferences()
    expect(result).toEqual({ migrated: 0, skipped: 0, failed: 1 })
    expect(localStorage.getItem('ai-run-entry:set-2')).toBe('https://c.example')
  })

  it('超过服务端长度上限的值跳过且不上送', async () => {
    localStorage.setItem('ai-run-entry:set-3', 'x'.repeat(2049))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await migrateLocalPreferences()
    expect(result).toEqual({ migrated: 0, skipped: 1, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('ai-run-entry:set-3')).not.toBeNull()
  })
})
