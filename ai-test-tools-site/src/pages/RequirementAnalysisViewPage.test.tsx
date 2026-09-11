import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirementAnalysisViewPage } from './RequirementAnalysisViewPage'

const stub = vi.hoisted(() => ({
  getAnalysisRecord: vi.fn(),
  getAnalysisRtm: vi.fn(),
  patchAnalysisIssue: vi.fn(),
  patchCriterion: vi.fn(),
  relayConditions: vi.fn(),
}))

vi.mock('../features/requirement-analysis-v2/analysis-api', () => ({
  getAnalysisRecord: stub.getAnalysisRecord,
  getAnalysisRtm: stub.getAnalysisRtm,
  patchAnalysisIssue: stub.patchAnalysisIssue,
  patchCriterion: stub.patchCriterion,
  relayConditions: stub.relayConditions,
}))

const detail = {
  id: 'ra2_1',
  title: '登录需求分析',
  sourceFileName: 'login.md',
  sourceText: '原始需求文本',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  requirements: [
    { id: 'r1', recordId: 'ra2_1', parentId: null, level: 0, text: '账号锁定', sort: 0 },
  ],
  issues: [
    {
      id: 'i1',
      recordId: 'ra2_1',
      reqId: 'r1',
      type: 'missing' as const,
      severity: 'high' as const,
      quote: '「连续输错密码后账号锁定」',
      description: '未说明锁定阈值与时长',
      suggestedQuestion: '错误几次触发锁定？',
      status: 'open' as const,
    },
  ],
  criteria: [
    {
      id: 'c1',
      recordId: 'ra2_1',
      reqId: 'r1',
      originalText: '连续输错密码后账号锁定',
      rewrittenText: '10 分钟内连续 5 次错误 → 锁定 30 分钟',
      status: 'pending' as const,
    },
  ],
  conditions: [
    { id: 'cond1', recordId: 'ra2_1', reqId: 'r1', criterionId: 'c1', text: '5 次错误触发锁定', kind: 'normal' as const, relay: 'none' as const, testsetId: null },
    { id: 'cond2', recordId: 'ra2_1', reqId: 'r1', criterionId: 'c1', text: '第 4 次仍可登录', kind: 'boundary' as const, relay: 'none' as const, testsetId: null },
    { id: 'cond3', recordId: 'ra2_1', reqId: 'r1', criterionId: 'c1', text: '到期自动解除', kind: 'exception' as const, relay: 'generated' as const, testsetId: 'ts_1' },
  ],
}

const rtm = {
  totalConditions: 3,
  coveredConditions: 1,
  coverage: 33,
  rows: [
    { reqId: 'r1', reqText: '账号锁定', conditionId: 'cond1', conditionText: '5 次错误触发锁定', conditionKind: 'normal' as const, relay: 'none' as const, testsetId: null },
    { reqId: 'r1', reqText: '账号锁定', conditionId: 'cond3', conditionText: '到期自动解除', conditionKind: 'exception' as const, relay: 'generated' as const, testsetId: 'ts_1' },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/requirement-analysis/records/ra2_1']}>
      <Routes>
        <Route path="/requirement-analysis/records/:id" element={<RequirementAnalysisViewPage />} />
        <Route path="/testcase" element={<div>用例生成页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  stub.getAnalysisRecord.mockResolvedValue(detail)
  stub.getAnalysisRtm.mockResolvedValue(rtm)
  stub.patchAnalysisIssue.mockImplementation(async (id, patch) => ({ ...detail.issues[0], ...patch }))
  stub.patchCriterion.mockResolvedValue({ criterion: { ...detail.criteria[0], status: 'confirmed' }, issue: null })
  stub.relayConditions.mockResolvedValue(1)
})

describe('需求分析详情页（四分区）', () => {
  it('渲染四个分区与数据', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('登录需求分析')).toBeInTheDocument())

    expect(screen.getByText('⚠️ 问题日志')).toBeInTheDocument()
    expect(screen.getByText('未说明锁定阈值与时长')).toBeInTheDocument()
    expect(screen.getByText('💬 建议澄清：错误几次触发锁定？')).toBeInTheDocument()

    expect(screen.getByText('✅ 可测试化验收准则')).toBeInTheDocument()
    expect(screen.getByText(/10 分钟内连续 5 次错误/)).toBeInTheDocument()

    expect(screen.getByText('🧪 测试条件清单')).toBeInTheDocument()
    expect(screen.getAllByText('5 次错误触发锁定').length).toBeGreaterThan(0)
    // 已生成用例的条件禁用勾选（条件区与 RTM 表都有该文本，取第一个）
    const generated = screen.getAllByText('到期自动解除')[0].closest('label')!.querySelector('input')!
    expect(generated).toBeDisabled()

    expect(screen.getByText('33%')).toBeInTheDocument()
    expect(screen.getByText('ts_1')).toBeInTheDocument()
  })

  it('问题状态点选流转并调用 patch', async () => {
    renderPage()
    await waitFor(() => screen.getByText('待澄清'))
    fireEvent.click(screen.getByRole('button', { name: '待澄清' }))
    await waitFor(() => expect(stub.patchAnalysisIssue).toHaveBeenCalledWith('i1', { status: 'resolved' }))
    expect(screen.getByRole('button', { name: '已澄清' })).toBeInTheDocument()
  })

  it('准则确认调用 patch 并更新卡片态', async () => {
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: '确认' }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(stub.patchCriterion).toHaveBeenCalledWith('c1', { status: 'confirmed' }))
    expect(screen.getByRole('button', { name: '✓ 已确认' })).toBeInTheDocument()
  })

  it('接力：勾选 → 标记 relayed → 载荷写 localStorage → 跳转用例页', async () => {
    renderPage()
    await waitFor(() => screen.getAllByText('5 次错误触发锁定'))

    fireEvent.click(screen.getAllByText('5 次错误触发锁定')[0].closest('label')!.querySelector('input')!)
    fireEvent.click(screen.getByRole('button', { name: /接力到用例生成/ }))

    await waitFor(() => expect(stub.relayConditions).toHaveBeenCalledWith('ra2_1', ['cond1']))
    const payload = JSON.parse(localStorage.getItem('requirement-analysis-v2-handoff')!)
    expect(payload.recordId).toBe('ra2_1')
    expect(payload.conditions).toHaveLength(1)
    expect(payload.conditions[0].id).toBe('cond1')
    expect(payload.requirement).toContain('5 次错误触发锁定')
    await waitFor(() => expect(screen.getByText('用例生成页')).toBeInTheDocument())
  })
})
