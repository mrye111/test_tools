import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalysisBoardPage } from './AnalysisBoardPage'
import { serializeBoard } from '../features/requirement-analysis/board/persistence'

const stub = vi.hoisted(() => ({
  boardProps: { current: null as Record<string, unknown> | null },
  getSessionFile: vi.fn(),
  updateSessionFileBoard: vi.fn(),
  getLibraryFile: vi.fn(),
  updateLibraryFileBoard: vi.fn(),
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

vi.mock('../features/requirement-analysis/chat/chat-api', async () => {
  const actual = await vi.importActual<typeof import('../features/requirement-analysis/chat/chat-api')>(
    '../features/requirement-analysis/chat/chat-api',
  )
  return {
    ...actual,
    getSessionFile: stub.getSessionFile,
    updateSessionFileBoard: stub.updateSessionFileBoard,
    getLibraryFile: stub.getLibraryFile,
    updateLibraryFileBoard: stub.updateLibraryFileBoard,
  }
})

vi.mock('../lib/requirement-analysis-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/requirement-analysis-api')>('../lib/requirement-analysis-api')
  return {
    ...actual,
    generateBoardChart: vi.fn(),
    exportRequirementXmind: vi.fn(),
  }
})

const sessionFile = {
  id: 'sf-1',
  sessionId: 'sess-1',
  messageId: 'msg-1',
  kind: 'mindmap' as const,
  title: '登录需求分析',
  payload: {
    tree: { id: 'root', title: '登录需求', children: [{ id: 'n1', title: '账号密码登录', children: [] }] },
    findings: [{ id: 'f1', type: 'risk', title: '缺少锁定策略', detail: '暴力破解风险', nodeId: 'n1' }],
    sourceText: '原始需求文本',
    board: { version: 1, elements: [] },
  },
  savedToLibrary: false,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const libraryFile = {
  id: 'lf-1',
  kind: 'mindmap' as const,
  title: '文件库副本登录需求',
  payload: {
    tree: { id: 'root', title: '登录需求', children: [{ id: 'n1', title: '账号密码登录', children: [] }] },
    findings: [],
    sourceText: '库文件原始文本',
  },
  sourceSessionTitle: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function renderPage(id = 'sf-1', fromLibrary = false) {
  const path = `/requirement-analysis/board/${id}${fromLibrary ? '?from=library' : ''}`
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/requirement-analysis/board/:id" element={<AnalysisBoardPage />} />
        <Route path="/requirement-analysis" element={<div>记录列表页</div>} />
        <Route path="/requirement-analysis/library" element={<div>文件库页</div>} />
        <Route path="/testcase" element={<div>测试用例页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  stub.boardProps.current = null
  stub.getSessionFile.mockResolvedValue(sessionFile)
  stub.updateSessionFileBoard.mockResolvedValue(sessionFile)
  stub.getLibraryFile.mockResolvedValue(libraryFile)
  stub.updateLibraryFileBoard.mockResolvedValue(libraryFile)
})

describe('AnalysisBoardPage 分析画板页', () => {
  it('默认按会话文件来源加载并渲染画板', async () => {
    renderPage()

    expect(screen.getByText('正在加载分析画板…')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('analysis-board-stub')).toHaveTextContent('登录需求分析')
    })

    expect(stub.getSessionFile).toHaveBeenCalledWith('sf-1')
    expect(stub.getLibraryFile).not.toHaveBeenCalled()
  })

  it('from=library 时调用 getLibraryFile 并渲染文件库副本徽标', async () => {
    renderPage('lf-1', true)

    await waitFor(() => {
      expect(screen.getByTestId('analysis-board-stub')).toHaveTextContent('文件库副本登录需求')
    })

    expect(stub.getLibraryFile).toHaveBeenCalledWith('lf-1')
    expect(stub.getSessionFile).not.toHaveBeenCalled()
    expect(stub.boardProps.current?.libraryBadge).toBe(true)
  })

  it('board 为空时自动放入需求树参考图元', async () => {
    stub.getSessionFile.mockResolvedValue({
      ...sessionFile,
      payload: { ...sessionFile.payload, board: undefined },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('analysis-board-stub')).toBeInTheDocument()
    })

    const board = stub.boardProps.current?.board as { elements: Array<{ kind: string }> }
    expect(board.elements[0].kind).toBe('mindmap-ref')
  })

  it('draft 类 payload 经 draftToElement 生成单个图元', async () => {
    const draft = {
      conditions: ['cond-1'],
      actions: ['action-1'],
      rules: [{ conditionValues: ['Y'], actionValues: [true] }],
    }
    stub.getSessionFile.mockResolvedValue({
      ...sessionFile,
      kind: 'decision-table' as const,
      payload: { draft },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('analysis-board-stub')).toBeInTheDocument()
    })

    const board = stub.boardProps.current?.board as { elements: Array<{ kind: string }> }
    expect(board.elements.length).toBe(1)
    expect(board.elements[0].kind).toBe('decision-table')
  })

  it('from=library 时 onGenerateChart 未提供，禁用 AI 生成', async () => {
    renderPage('lf-1', true)

    await waitFor(() => {
      expect(screen.getByTestId('analysis-board-stub')).toBeInTheDocument()
    })

    expect(stub.boardProps.current?.onGenerateChart).toBeUndefined()
  })

  it('board 变化时调用 updateSessionFileBoard', async () => {
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
      expect(stub.updateSessionFileBoard).toHaveBeenCalledWith('sf-1', expect.objectContaining({ board: serializeBoard(nextBoard) }))
    }, { timeout: 3000 })
  })

  it('from=library 时 board 变化调用 updateLibraryFileBoard', async () => {
    renderPage('lf-1', true)

    await waitFor(() => {
      expect(screen.getByTestId('analysis-board-stub')).toBeInTheDocument()
    })

    const onBoardChange = stub.boardProps.current?.onBoardChange as (board: unknown) => void
    const nextBoard = { version: 1, elements: [] }
    await act(async () => {
      onBoardChange(nextBoard)
    })

    await waitFor(() => {
      expect(stub.updateLibraryFileBoard).toHaveBeenCalledWith('lf-1', expect.objectContaining({ board: serializeBoard(nextBoard) }))
    }, { timeout: 3000 })
  })

  it('from=library 时保存失败通过 error 属性回传 saveError', async () => {
    stub.updateLibraryFileBoard.mockRejectedValue(new Error('库文件保存失败'))
    renderPage('lf-1', true)

    await waitFor(() => {
      expect(screen.getByTestId('analysis-board-stub')).toBeInTheDocument()
    })

    const onBoardChange = stub.boardProps.current?.onBoardChange as (board: unknown) => void
    await act(async () => {
      onBoardChange({ version: 1, elements: [] })
    })

    await waitFor(() => {
      expect(stub.boardProps.current?.error).toBe('库文件保存失败')
    }, { timeout: 3000 })
  })

  it('拉取失败展示错误与返回入口', async () => {
    stub.getLibraryFile.mockRejectedValue(new Error('库文件不存在'))
    renderPage('missing-id', true)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('库文件不存在')
    })
    expect(screen.queryByTestId('analysis-board-stub')).not.toBeInTheDocument()
  })
})
