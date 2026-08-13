import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TestReportPage } from './TestReportPage'
import { ErrorDialogProvider } from '../components/ui/ErrorDialogProvider'
import * as reportApi from '../features/test-report/report-api'

vi.mock('../features/test-report/report-api', () => ({
  getReportStorageStatus: vi.fn(),
  listReports: vi.fn(),
  getReport: vi.fn(),
  renameReport: vi.fn(),
  deleteReport: vi.fn(),
  generateReportStream: vi.fn(),
  reviseReportStream: vi.fn(),
  getReportPdfUrl: vi.fn((id: string) => `/api/test-report/reports/${id}/pdf`),
  downloadReportHtml: vi.fn(),
}))

vi.mock('../lib/model-config-store', () => ({
  loadStoredModelConfig: vi.fn(() => ({ baseUrl: 'http://ai.test/v1', apiKey: 'test-key', model: 'test-model', apiFormat: 'openai_chat' })),
}))

vi.mock('../lib/zentao-csv-parser', () => ({
  parseZentaoReport: vi.fn(async () => ({ title: '解析结果', testCases: [], bugs: [] })),
}))

const mockListReports = vi.mocked(reportApi.listReports)
const mockDeleteReport = vi.mocked(reportApi.deleteReport)
const mockGenerate = vi.mocked(reportApi.generateReportStream)
const mockStorageStatus = vi.mocked(reportApi.getReportStorageStatus)

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe">{location.pathname}</div>
}

function renderPage() {
  return render(
    <ErrorDialogProvider>
      <MemoryRouter initialEntries={['/testreport']}>
        <Routes>
          <Route
            path="/testreport*"
            element={
              <>
                <TestReportPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </ErrorDialogProvider>,
  )
}

function makeSummary(id: string, title: string) {
  return {
    id,
    title,
    reportType: 'summary' as const,
    sourceType: 'csv' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('TestReportPage（AI 报告工作台）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStorageStatus.mockResolvedValue('mysql')
    mockListReports.mockResolvedValue({ reports: [], total: 0, page: 1, pageSize: 10 })
  })

  it('渲染报告类型 chips 与空列表', async () => {
    renderPage()
    expect(await screen.findByText('测试总结报告')).toBeInTheDocument()
    expect(screen.getByText('快速简报')).toBeInTheDocument()
    expect(screen.getByText('缺陷分析报告')).toBeInTheDocument()
    expect(screen.getByText('自由生成')).toBeInTheDocument()
    expect(await screen.findByText('还没有报告，生成第一份吧')).toBeInTheDocument()
  })

  it('快速简报未输入文本时点生成给出错误提示且不调用接口', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('快速简报'))
    fireEvent.click(screen.getByRole('button', { name: /AI 生成报告/ }))
    expect(await screen.findByText('请输入测试描述（几句话即可）')).toBeInTheDocument()
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('快速简报生成成功后跳转到报告视图', async () => {
    mockGenerate.mockImplementation(async (_body, _config, onEvent) => {
      onEvent({ type: 'progress', stage: 'select', message: '正在选图' })
      return {
        ...makeSummary('rpt_1', '登录简报'),
        sourceDigest: null,
        chartKinds: null,
        html: '<html/>',
      }
    })
    renderPage()
    fireEvent.click(await screen.findByText('快速简报'))
    fireEvent.change(screen.getByPlaceholderText(/用几句话描述本轮测试/), { target: { value: '测试了登录功能' } })
    fireEvent.click(screen.getByRole('button', { name: /AI 生成报告/ }))

    await waitFor(() => expect(mockGenerate).toHaveBeenCalled())
    const body = mockGenerate.mock.calls[0][0]
    expect(body).toMatchObject({ reportType: 'brief', sourceType: 'text', sourceText: '测试了登录功能' })
    await waitFor(() => expect(screen.getByTestId('location-probe').textContent).toBe('/testreport/reports/rpt_1'))
  })

  it('记录列表：渲染、删除轻量确认后移除', async () => {
    mockListReports.mockResolvedValue({ reports: [makeSummary('rpt_1', '登录模块总结')], total: 1, page: 1, pageSize: 10 })
    renderPage()
    expect(await screen.findByText('登录模块总结')).toBeInTheDocument()
    expect(screen.getByText(/共 1 份/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除报告 登录模块总结' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('将删除报告「登录模块总结」')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(mockDeleteReport).toHaveBeenCalledWith('rpt_1'))
  })

  it('memory 模式显示不持久保存提示', async () => {
    mockStorageStatus.mockResolvedValue('memory')
    renderPage()
    expect(await screen.findByText(/不会持久保存/)).toBeInTheDocument()
  })
})
