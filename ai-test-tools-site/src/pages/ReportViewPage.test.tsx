import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportViewPage } from './ReportViewPage'
import { ErrorDialogProvider } from '../components/ui/ErrorDialogProvider'
import * as reportApi from '../features/test-report/report-api'

vi.mock('../features/test-report/report-api', () => ({
  getReport: vi.fn(),
  reviseReportStream: vi.fn(),
  getReportPdfUrl: vi.fn((id: string) => `/api/test-report/reports/${id}/pdf`),
  downloadReportHtml: vi.fn(),
}))

vi.mock('../lib/model-config-store', () => ({
  loadStoredModelConfig: vi.fn(() => ({ baseUrl: 'http://ai.test/v1', apiKey: 'test-key', model: 'test-model', apiFormat: 'openai_chat' })),
}))

const mockGetReport = vi.mocked(reportApi.getReport)
const mockRevise = vi.mocked(reportApi.reviseReportStream)

function makeReport(html: string) {
  return {
    id: 'rpt_1',
    title: '登录模块测试总结',
    reportType: 'summary' as const,
    sourceType: 'csv' as const,
    sourceDigest: '{}',
    chartKinds: null,
    html,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function renderPage(id = 'rpt_1') {
  return render(
    <ErrorDialogProvider>
      <MemoryRouter initialEntries={[`/testreport/reports/${id}`]}>
        <Routes>
          <Route path="/testreport/reports/:id" element={<ReportViewPage />} />
        </Routes>
      </MemoryRouter>
    </ErrorDialogProvider>,
  )
}

describe('ReportViewPage（报告视图）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('加载报告并以沙箱 iframe 渲染', async () => {
    mockGetReport.mockResolvedValue(makeReport('<!doctype html><html><body>报告正文</body></html>'))
    renderPage()

    expect(await screen.findByText('登录模块测试总结')).toBeInTheDocument()
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('srcdoc')).toContain('报告正文')
    expect(screen.getByRole('link', { name: /导出 PDF/ })).toHaveAttribute('href', '/api/test-report/reports/rpt_1/pdf')
  })

  it('报告不存在时显示错误态', async () => {
    mockGetReport.mockRejectedValue(new Error('not found'))
    renderPage('rpt_missing')
    expect(await screen.findByText(/报告不存在/)).toBeInTheDocument()
  })

  it('对话追改：提交指令后调用 revise 并更新预览', async () => {
    mockGetReport.mockResolvedValue(makeReport('<html>v1</html>'))
    mockRevise.mockImplementation(async (_id, _instruction, _config, onEvent) => {
      onEvent({ type: 'progress', stage: 'assemble', message: '组装中' })
      return makeReport('<html>v2</html>')
    })
    renderPage()
    expect(await screen.findByText('登录模块测试总结')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/对话追改/), { target: { value: '结论写激进一点' } })
    fireEvent.click(screen.getByRole('button', { name: /追改/ }))

    await waitFor(() => expect(mockRevise).toHaveBeenCalledWith('rpt_1', '结论写激进一点', expect.anything(), expect.anything()))
    await waitFor(() => {
      const iframe = document.querySelector('iframe') as HTMLIFrameElement
      expect(iframe.getAttribute('srcdoc')).toBe('<html>v2</html>')
    })
  })

  it('占位卡 postMessage 触发补数弹窗，提交后走追改通路', async () => {
    mockGetReport.mockResolvedValue(makeReport('<html>v1</html>'))
    mockRevise.mockResolvedValue(makeReport('<html>v2</html>'))
    renderPage()
    expect(await screen.findByText('登录模块测试总结')).toBeInTheDocument()

    fireEvent(window, new MessageEvent('message', { data: { type: 'nexus-report-supplement', missing: 'pass-rate' } }))
    expect(await screen.findByText('补录执行数据')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/计划执行用例数/), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText(/通过用例数/), { target: { value: '92' } })
    fireEvent.click(screen.getByRole('button', { name: '重新生成报告' }))

    await waitFor(() => expect(mockRevise).toHaveBeenCalled())
    const instruction = mockRevise.mock.calls[0][1]
    expect(instruction).toContain('100')
    expect(instruction).toContain('92')
    expect(instruction).toContain('pass-rate')
  })
})
