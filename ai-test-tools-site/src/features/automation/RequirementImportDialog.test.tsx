/** RequirementImportDialog 入口地址记忆：读写走个人偏好 API（按分析记录键），失败静默降级。 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RequirementImportDialog } from './RequirementImportDialog'
import { getPreference, putPreference } from '../../lib/auth-api'
import { listTestCaseProjects } from '../../lib/testcase-api'
import { listAutomationSets, startRequirementImport } from '../../lib/automation-api'
import { loadActiveAiConfigSelection } from '../../lib/active-ai-config'

vi.mock('../../lib/auth-api', () => ({
  getPreference: vi.fn(),
  putPreference: vi.fn(),
}))

vi.mock('../../lib/testcase-api', () => ({
  listTestCaseProjects: vi.fn(),
}))

vi.mock('../../lib/automation-api', () => ({
  getImportJob: vi.fn(),
  listAutomationSets: vi.fn(),
  startRequirementImport: vi.fn(),
  subscribeImportEvents: vi.fn(() => () => {}),
}))

vi.mock('../../lib/active-ai-config', () => ({
  loadActiveAiConfigSelection: vi.fn(),
}))

/** 本地条目选择（统一封装返回形状）：payload 直接作为 aiConfig 提交。 */
const mockAiSelection = {
  storage: 'local' as const,
  payload: {
    provider: 'codex' as const,
    endpointType: 'openai_responses' as const,
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
  },
  provider: {
    id: 'model-1',
    name: '测试模型',
    providerType: 'openrouter',
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    apiFormat: 'openai_responses' as const,
  },
  name: '测试模型',
  model: 'test-model',
  apiFormat: 'openai_responses',
}

function renderDialog() {
  return render(
    <RequirementImportDialog
      recordId="r1"
      recordTitle="登录需求分析"
      conditionIds={['cond1']}
      onClose={() => {}}
      onFinished={() => {}}
    />,
  )
}

describe('RequirementImportDialog - 入口地址记忆（个人偏好）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(listTestCaseProjects).mockResolvedValue([
      { id: 'proj-1', name: '电商平台', createdAt: '2026-09-10T00:00:00.000Z' },
    ])
    vi.mocked(listAutomationSets).mockResolvedValue([])
    vi.mocked(loadActiveAiConfigSelection).mockResolvedValue(mockAiSelection)
    vi.mocked(putPreference).mockResolvedValue(undefined)
    vi.mocked(startRequirementImport).mockResolvedValue('imp-1')
  })

  it('打开时按分析记录读偏好并回填入口地址', async () => {
    vi.mocked(getPreference).mockResolvedValue('https://remembered.example')
    renderDialog()

    await waitFor(() => {
      expect(screen.getByLabelText(/目标系统入口地址/)).toHaveValue('https://remembered.example')
    })
    expect(getPreference).toHaveBeenCalledWith('requirement-import-entry-r1')
  })

  it('读偏好失败时降级为空串', async () => {
    vi.mocked(getPreference).mockRejectedValue(new Error('网络错误'))
    renderDialog()

    expect(await screen.findByLabelText(/目标系统入口地址/)).toHaveValue('')
  })

  it('开始生成后把入口地址写入个人偏好，且不写 localStorage', async () => {
    vi.mocked(getPreference).mockResolvedValue('https://remembered.example')
    renderDialog()

    await waitFor(() => {
      expect(screen.getByLabelText(/目标系统入口地址/)).toHaveValue('https://remembered.example')
    })
    // 等项目选项加载后再改 select（jsdom 对不存在的 option 置空 value）
    await screen.findByRole('option', { name: '电商平台' })
    fireEvent.change(screen.getByLabelText(/目标项目/), { target: { value: 'proj-1' } })
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))

    await waitFor(() => {
      expect(putPreference).toHaveBeenCalledWith('requirement-import-entry-r1', 'https://remembered.example')
    })
    expect(startRequirementImport).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'r1',
      entryUrl: 'https://remembered.example',
    }))
    expect(localStorage.getItem('requirement-import-entry-r1')).toBeNull()
  })

  it('写偏好失败静默不阻塞主流程', async () => {
    vi.mocked(getPreference).mockResolvedValue(null)
    vi.mocked(putPreference).mockRejectedValue(new Error('写失败'))
    renderDialog()

    await screen.findByRole('option', { name: '电商平台' })
    fireEvent.change(screen.getByLabelText(/目标项目/), { target: { value: 'proj-1' } })
    fireEvent.change(screen.getByLabelText(/目标系统入口地址/), { target: { value: 'https://target.example' } })
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))

    await waitFor(() => {
      expect(startRequirementImport).toHaveBeenCalled()
    })
  })
})
