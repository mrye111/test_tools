import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirementAnalysisPage } from './RequirementAnalysisPage'

const stub = vi.hoisted(() => ({
  listAnalysisRecords: vi.fn(),
  getAnalysisStorageStatus: vi.fn(),
  deleteAnalysisRecord: vi.fn(),
  renameAnalysisRecord: vi.fn(),
  parseRequirementDocument: vi.fn(),
  analyzeRequirementStream: vi.fn(),
}))

vi.mock('../features/requirement-analysis-v2/analysis-api', () => ({
  listAnalysisRecords: stub.listAnalysisRecords,
  getAnalysisStorageStatus: stub.getAnalysisStorageStatus,
  deleteAnalysisRecord: stub.deleteAnalysisRecord,
  renameAnalysisRecord: stub.renameAnalysisRecord,
  parseRequirementDocument: stub.parseRequirementDocument,
  analyzeRequirementStream: stub.analyzeRequirementStream,
}))

vi.mock('../lib/model-config-store', () => ({
  loadStoredModelConfig: vi.fn(() => ({ id: 'p1' })),
}))

vi.mock('../shared/api-types', async () => {
  const actual = await vi.importActual<typeof import('../shared/api-types')>('../shared/api-types')
  return { ...actual, toAiConfig: vi.fn(() => ({ baseUrl: 'http://x', model: 'm' })) }
})

const record = {
  id: 'ra2_1',
  title: '登录需求分析',
  sourceFileName: 'login.md',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  issueCount: 2,
  openIssueCount: 1,
  conditionCount: 5,
  coveredConditionCount: 3,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/requirement-analysis']}>
      <Routes>
        <Route path="/requirement-analysis" element={<RequirementAnalysisPage />} />
        <Route path="/requirement-analysis/records/:id" element={<div>详情页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  stub.listAnalysisRecords.mockResolvedValue({ records: [record], total: 1 })
  stub.getAnalysisStorageStatus.mockResolvedValue('mysql')
})

describe('需求分析列表页', () => {
  it('渲染记录列表与计数摘要', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('登录需求分析')).toBeInTheDocument())
    expect(screen.getByText(/问题 2（待澄清 1）/)).toBeInTheDocument()
    expect(screen.getByText(/条件 5 · 覆盖 3/)).toBeInTheDocument()
  })

  it('空输入点分析给出字段错误', async () => {
    renderPage()
    await waitFor(() => screen.getByText('登录需求分析'))
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('请上传需求文档或粘贴需求文本')
    expect(stub.analyzeRequirementStream).not.toHaveBeenCalled()
  })

  it('粘贴文本 → 分析 → 跳转详情页', async () => {
    stub.analyzeRequirementStream.mockResolvedValue({ id: 'ra2_new' })
    renderPage()
    await waitFor(() => screen.getByText('登录需求分析'))

    fireEvent.change(screen.getByPlaceholderText(/粘贴需求文本/), { target: { value: '登录需求：连续输错密码锁定' } })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    await waitFor(() => expect(screen.getByText('详情页')).toBeInTheDocument())
    expect(stub.analyzeRequirementStream).toHaveBeenCalledWith(
      { sourceText: '登录需求：连续输错密码锁定', sourceFileName: undefined },
      expect.anything(),
      expect.any(Function),
    )
  })

  it('删除记录走确认弹窗', async () => {
    stub.deleteAnalysisRecord.mockResolvedValue(undefined)
    renderPage()
    await waitFor(() => screen.getByText('登录需求分析'))

    fireEvent.click(screen.getByRole('button', { name: '删除 登录需求分析' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(stub.deleteAnalysisRecord).toHaveBeenCalledWith('ra2_1'))
  })
})
