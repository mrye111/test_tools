import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TestCasePage } from './TestCasePage'
import * as testcaseApi from '../lib/testcase-api'
import type { TestCaseProject, TestCaseSet } from '../lib/testcase-api'
import { REQUIREMENT_CONDITIONS_HANDOFF_KEY } from '../features/requirement-analysis-v2/handoff'

const analysisStub = vi.hoisted(() => ({ linkConditionsToTestset: vi.fn() }))

vi.mock('../features/requirement-analysis-v2/analysis-api', () => ({
  linkConditionsToTestset: analysisStub.linkConditionsToTestset,
}))

vi.mock('../lib/testcase-api', async () => {
  const actual = await vi.importActual<typeof testcaseApi>('../lib/testcase-api')
  return {
    ...actual,
    listTestCaseProjects: vi.fn(),
    listTestCaseSets: vi.fn(),
    createGenerateJob: vi.fn(),
    waitForGenerateJob: vi.fn(),
    loadStoredModelConfig: vi.fn(() => ({ baseUrl: 'http://x', model: 'm', apiKey: 'k' })),
  }
})

const mockApi = vi.mocked(testcaseApi)

const project: TestCaseProject = { id: 'proj-1', name: '电商平台', createdAt: '2026-09-10T00:00:00.000Z' }

const existingSet: TestCaseSet = {
  id: 'set-1',
  projectId: 'proj-1',
  name: '既有用例集',
  featureName: '既有用例集',
  testType: 'functional',
  language: 'zh',
  promptPreset: 'google_qa',
  context: '',
  status: 'completed',
  header: [],
  rows: [],
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
}

const payload = {
  requirement: '【需求分析接力】登录需求分析\n\n测试条件（需逐条覆盖）：\n- [正常] 5 次错误触发锁定',
  name: '登录需求分析',
  recordId: 'ra2_1',
  conditions: [{ id: 'cond1', text: '5 次错误触发锁定', kind: 'normal', reqId: 'r1' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockApi.listTestCaseProjects.mockResolvedValue([project])
  mockApi.listTestCaseSets.mockResolvedValue([existingSet])
  mockApi.createGenerateJob.mockResolvedValue({ jobId: 'job-1' } as never)
  mockApi.waitForGenerateJob.mockResolvedValue({ jobId: 'job-1', status: 'completed', testSetId: 'set-new' } as never)
})

describe('TestCasePage - 需求分析条件接力（wayfinder #30）', () => {
  it('载荷预填新建用例集弹窗，生成完成后回写条件关联', async () => {
    localStorage.setItem(REQUIREMENT_CONDITIONS_HANDOFF_KEY, JSON.stringify(payload))
    render(
      <MemoryRouter initialEntries={['/testcase']}>
        <Routes>
          <Route path="/testcase" element={<TestCasePage />} />
        </Routes>
      </MemoryRouter>,
    )

    // 弹窗自动打开且预填
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    const nameInput = screen.getByPlaceholderText(/例如：/)
    expect(nameInput).toHaveValue('登录需求分析')

    // 载荷被取走（一次性）
    expect(localStorage.getItem(REQUIREMENT_CONDITIONS_HANDOFF_KEY)).toBeNull()
  })

  it('无载荷时不打开弹窗、不回写', async () => {
    render(
      <MemoryRouter initialEntries={['/testcase']}>
        <Routes>
          <Route path="/testcase" element={<TestCasePage />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(mockApi.listTestCaseProjects).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(analysisStub.linkConditionsToTestset).not.toHaveBeenCalled()
  })
})
