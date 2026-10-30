/** TestCasePage AI 执行入口地址记忆：读写走个人偏好 API（/api/preferences/:key），失败静默降级。 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { TestCasePage } from './TestCasePage'
import * as testcaseApi from '../lib/testcase-api'
import { getPreference, putPreference } from '../lib/auth-api'
import { runFunctionalCase } from '../lib/automation-api'
import type { TestCaseProject, TestCaseSet } from '../lib/testcase-api'

vi.mock('../lib/testcase-api', async () => {
  const actual = await vi.importActual<typeof testcaseApi>('../lib/testcase-api')
  return {
    ...actual,
    listTestCaseProjects: vi.fn(),
    listTestCaseSets: vi.fn(),
    getTestCaseSet: vi.fn(),
  }
})

vi.mock('../lib/auth-api', () => ({
  getPreference: vi.fn(),
  putPreference: vi.fn(),
}))

vi.mock('../lib/automation-api', () => ({
  runFunctionalCase: vi.fn(),
  subscribeRunEvents: vi.fn(() => () => {}),
  abortAutomationRun: vi.fn(),
  automationRunReportUrl: vi.fn(() => ''),
}))

vi.mock('../lib/active-ai-config', () => ({
  loadActiveAiConfigSelection: vi.fn(async () => ({
    storage: 'local',
    payload: { provider: 'codex', endpointType: 'openai_responses', baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model' },
    name: '测试模型',
    model: 'test-model',
    apiFormat: 'openai_responses',
  })),
}))

const project: TestCaseProject = {
  id: 'proj-1',
  name: '电商平台',
  createdAt: '2026-09-10T00:00:00.000Z',
}

const testSet: TestCaseSet = {
  id: 'set-1',
  projectId: 'proj-1',
  name: '结算与支付模块',
  featureName: '结算与支付模块',
  testType: 'functional',
  language: 'zh',
  promptPreset: 'google_qa',
  context: '订单结算',
  status: 'completed',
  header: ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果'],
  rows: [
    ['TC-PAY-001', '支付', '正常支付', '微信全额支付', '高', '用户已登录且有待支付订单', '1. 选择微信支付\n2. 确认付款', '1. 唤起微信支付成功\n2. 订单状态更新为已支付'],
  ],
  executionStatus: {},
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
}

async function openAiRunDialog() {
  render(<TestCasePage />, { wrapper: BrowserRouter })
  fireEvent.click(await screen.findByRole('button', { name: '电商平台' }))
  fireEvent.click(await screen.findByRole('button', { name: /^结算与支付模块/ }))
  // AI 执行按钮在执行看板模式的操作列
  fireEvent.click(await screen.findByRole('button', { name: /执行看板/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'AI 执行用例 TC-PAY-001' }))
  return screen.findByRole('dialog', { name: /AI 执行 · TC-PAY-001/ })
}

describe('TestCasePage - AI 执行入口地址记忆（个人偏好）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(testcaseApi.listTestCaseProjects).mockResolvedValue([project])
    vi.mocked(testcaseApi.listTestCaseSets).mockResolvedValue([testSet])
    vi.mocked(putPreference).mockResolvedValue(undefined)
    vi.mocked(runFunctionalCase).mockResolvedValue({
      run: { id: 'run-1' },
    } as never)
  })

  it('打开弹窗按用例集读偏好并回填入口地址', async () => {
    vi.mocked(getPreference).mockResolvedValue('https://remembered.example')
    await openAiRunDialog()

    await waitFor(() => {
      expect(screen.getByLabelText('目标系统入口地址')).toHaveValue('https://remembered.example')
    })
    expect(getPreference).toHaveBeenCalledWith('ai-run-entry:set-1')
  })

  it('读偏好失败时降级为空串，弹窗正常可用', async () => {
    vi.mocked(getPreference).mockRejectedValue(new Error('网络错误'))
    await openAiRunDialog()

    expect(screen.getByLabelText('目标系统入口地址')).toHaveValue('')
  })

  it('开始执行后把入口地址写入个人偏好，且不写 localStorage', async () => {
    vi.mocked(getPreference).mockResolvedValue(null)
    await openAiRunDialog()

    fireEvent.change(screen.getByLabelText('目标系统入口地址'), { target: { value: 'https://target.example' } })
    fireEvent.click(screen.getByRole('button', { name: '开始执行' }))

    await waitFor(() => {
      expect(putPreference).toHaveBeenCalledWith('ai-run-entry:set-1', 'https://target.example')
    })
    expect(runFunctionalCase).toHaveBeenCalledWith(expect.objectContaining({
      testSetId: 'set-1',
      caseId: 'TC-PAY-001',
      entryUrl: 'https://target.example',
    }))
    expect(localStorage.getItem('ai-run-entry:set-1')).toBeNull()
  })

  it('写偏好失败静默不阻塞主流程', async () => {
    vi.mocked(getPreference).mockResolvedValue(null)
    vi.mocked(putPreference).mockRejectedValue(new Error('写失败'))
    await openAiRunDialog()

    fireEvent.change(screen.getByLabelText('目标系统入口地址'), { target: { value: 'https://target.example' } })
    fireEvent.click(screen.getByRole('button', { name: '开始执行' }))

    await waitFor(() => {
      expect(runFunctionalCase).toHaveBeenCalled()
    })
  })
})
