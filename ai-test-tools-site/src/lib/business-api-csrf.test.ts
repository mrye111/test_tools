/** 业务 API 客户端共性契约：修改型请求自动带 x-csrf-token、401 统一触发未登录处理器。 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCsrfToken, setCsrfToken, setUnauthorizedHandler } from './httpClient'
import { createTestCaseProject, listTestCaseProjects } from './testcase-api'
import { executeTool } from './data-factory-api'
import { buildJmeterPlan } from './jmeter-api'
import { createAutomationSet } from './automation-api'
import { renameReport } from '../features/test-report/report-api'
import { deleteAnalysisRecord } from '../features/requirement-analysis-v2/analysis-api'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function expectCsrfHeader(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): void {
  const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit]
  expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('tok-biz')
}

describe('业务客户端修改型请求自动附 CSRF 头', () => {
  beforeEach(() => {
    clearCsrfToken()
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('testcase-api 创建项目（POST）带 x-csrf-token', async () => {
    setCsrfToken('tok-biz')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { id: 'p1', name: 'P' } }))
    vi.stubGlobal('fetch', fetchMock)

    await createTestCaseProject({ name: 'P' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expectCsrfHeader(fetchMock, 0)
  })

  it('data-factory-api 执行工具（POST）带 x-csrf-token', async () => {
    setCsrfToken('tok-biz')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { rows: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    await executeTool('gen-users', { count: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expectCsrfHeader(fetchMock, 0)
  })

  it('jmeter-api 构建计划（POST）带 x-csrf-token', async () => {
    setCsrfToken('tok-biz')
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        planName: 'plan',
        path: '/tmp/plan.jmx',
        filename: 'plan.jmx',
        saveMessage: '',
        validation: '',
        tree: '',
        steps: [],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await buildJmeterPlan({ planName: 'plan', seed: 'seed', steps: [] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expectCsrfHeader(fetchMock, 0)
  })

  it('automation-api 创建集合（POST）带 x-csrf-token', async () => {
    setCsrfToken('tok-biz')
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: { id: 'set-1', projectId: 'p1', name: 'S' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createAutomationSet({ projectId: 'p1', name: 'S' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expectCsrfHeader(fetchMock, 0)
  })

  it('report-api 重命名报告（PATCH）带 x-csrf-token', async () => {
    setCsrfToken('tok-biz')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ report: { id: 'r1', title: 'T', createdAt: '2026-01-01', updatedAt: '2026-01-02' } }))
    vi.stubGlobal('fetch', fetchMock)

    await renameReport('r1', 'T')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expectCsrfHeader(fetchMock, 0)
  })

  it('analysis-api 删除记录（DELETE）带 x-csrf-token', async () => {
    setCsrfToken('tok-biz')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteAnalysisRecord('rec-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expectCsrfHeader(fetchMock, 0)
  })
})

describe('业务客户端 401 统一拦截', () => {
  beforeEach(() => {
    clearCsrfToken()
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('会话过期时业务请求 401 触发未登录处理器并清令牌', async () => {
    setCsrfToken('tok-biz')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'unauthorized' }, 401)),
    )
    const handler = vi.fn()
    setUnauthorizedHandler(handler)

    await expect(listTestCaseProjects()).rejects.toThrow()

    expect(handler).toHaveBeenCalledWith(expect.any(String))
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
