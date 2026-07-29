import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisRecord } from '../lib/requirement-analysis-api'
import { AnalysisBoardPage } from './AnalysisBoardPage'

const stub = vi.hoisted(() => ({
  boardProps: { current: null as Record<string, unknown> | null },
  getAnalysisRecord: vi.fn<(id: string) => Promise<AnalysisRecord>>(),
  updateAnalysisRecord: vi.fn(),
}))

vi.mock('../features/requirement-analysis/AnalysisBoard', async () => {
  const { createElement } = await import('react')
  return {
    AnalysisBoard: (props: Record<string, unknown>) => {
      stub.boardProps.current = props
      return createElement('div', { 'data-testid': 'analysis-board-stub' }, String(props.recordName))
    },
  }
})

vi.mock('../lib/requirement-analysis-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/requirement-analysis-api')>(
    '../lib/requirement-analysis-api',
  )
  return {
    ...actual,
    getAnalysisRecord: stub.getAnalysisRecord,
    updateAnalysisRecord: stub.updateAnalysisRecord,
  }
})

const record: AnalysisRecord = {
  id: 'rec-1',
  name: '登录需求分析',
  chartType: 'tree',
  title: '登录需求',
  tree: { id: 'root', title: '登录需求', children: [{ id: 'n1', title: '账号密码登录', children: [] }] },
  findings: [{ id: 'f1', type: 'risk', title: '缺少锁定策略', detail: '暴力破解风险', nodeId: 'n1' }],
  sourceText: '原始需求文本',
  truncated: false,
  warnings: [],
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:00.000Z',
}

function renderPage(id = 'rec-1') {
  return render(
    <MemoryRouter initialEntries={[`/requirement-analysis/board/${id}`]}>
      <Routes>
        <Route path="/requirement-analysis/board/:id" element={<AnalysisBoardPage />} />
        <Route path="/requirement-analysis" element={<div>记录列表页</div>} />
        <Route path="/testcase" element={<div>测试用例页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  stub.boardProps.current = null
  stub.getAnalysisRecord.mockResolvedValue(record)
  stub.updateAnalysisRecord.mockResolvedValue(record)
})

describe('AnalysisBoardPage 分析画板页', () => {
  it('按路由 id 拉取记录并渲染画板，board 为空时自动放入需求树参考图元', async () => {
    renderPage()
    expect(screen.getByText('正在加载分析画板…')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('analysis-board-stub')).toHaveTextContent('登录需求分析')
    })
    expect(stub.getAnalysisRecord).toHaveBeenCalledWith('rec-1')
    const board = stub.boardProps.current?.board as { elements: Array<{ kind: string }> }
    expect(board.elements[0].kind).toBe('mindmap-ref')
    expect(stub.boardProps.current?.recordName).toBe('登录需求分析')
  })

  it('拉取失败展示错误与返回列表入口', async () => {
    stub.getAnalysisRecord.mockRejectedValue(new Error('记录不存在'))
    renderPage('missing-id')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('记录不存在')
    })
    expect(screen.queryByTestId('analysis-board-stub')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回分析记录列表' })).toBeInTheDocument()
  })

  it('board 变化时通过 onBoardChange 回传', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('analysis-board-stub')).toBeInTheDocument()
    })

    const onBoardChange = stub.boardProps.current?.onBoardChange as (board: unknown) => void
    const nextBoard = { version: 1, elements: [] }
    await act(async () => {
      onBoardChange(nextBoard)
    })
    await waitFor(() => {
      expect(stub.updateAnalysisRecord).toHaveBeenCalledWith('rec-1', expect.objectContaining({ board: JSON.stringify(nextBoard) }))
    }, { timeout: 3000 })
  })
})
