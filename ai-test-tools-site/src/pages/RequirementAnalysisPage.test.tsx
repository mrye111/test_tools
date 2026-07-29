import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequirementAnalysisPage } from './RequirementAnalysisPage'

const recordSummary = {
  id: 'rec-1',
  name: '登录需求分析',
  chartType: 'mindmap',
  createdAt: '2026-07-10T01:00:00.000Z',
  updatedAt: '2026-07-10T02:00:00.000Z',
  findingsCount: { risk: 2, ambiguity: 1, clarification: 3 },
  truncated: false,
}

function jsonResponse(data: unknown, ok = true): Response {
  return { ok, json: async () => data } as unknown as Response
}

/** mock 分析记录接口：GET 列表 / GET 单条 / DELETE。 */
function mockRecordsFetch(records = [recordSummary], total = records.length) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'DELETE' && url.includes('/api/requirement-analysis/records/')) {
      return jsonResponse({ success: true })
    }
    if (method === 'GET' && url.includes('/api/requirement-analysis/records')) {
      return jsonResponse({ success: true, records, total, page: 1, pageSize: 10 })
    }
    throw new Error(`未 mock 的请求：${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RequirementAnalysisPage 分析记录', () => {
  it('默认渲染分析记录列表：名称行与结论计数徽章', async () => {
    mockRecordsFetch()
    render(<RequirementAnalysisPage />, { wrapper: BrowserRouter })

    expect(await screen.findByText('登录需求分析')).toBeInTheDocument()
    expect(screen.getByText('风险点 2')).toBeInTheDocument()
    expect(screen.getByText('歧义点 1')).toBeInTheDocument()
    expect(screen.getByText('待澄清问题 3')).toBeInTheDocument()
    expect(screen.getByText(/2026-07-10/)).toBeInTheDocument()
  })

  it('删除流程：ConfirmDialog 确认后调用 DELETE 并移除行', { timeout: 10000 }, async () => {
    const fetchMock = mockRecordsFetch()
    render(<RequirementAnalysisPage />, { wrapper: BrowserRouter })

    fireEvent.click(await screen.findByRole('button', { name: '删除记录 登录需求分析' }))
    expect(await screen.findByText('删除这条分析记录？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/requirement-analysis/records/rec-1'),
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
    await waitFor(() => expect(screen.queryByText('登录需求分析')).not.toBeInTheDocument())
  }, { timeout: 10000 })

  it('空态渲染「新建分析」入口', async () => {
    mockRecordsFetch([], 0)
    render(<RequirementAnalysisPage />, { wrapper: BrowserRouter })

    expect(await screen.findByText('还没有分析记录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建分析' })).toBeInTheDocument()
  })
})
