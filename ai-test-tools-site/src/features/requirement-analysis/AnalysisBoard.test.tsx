import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Finding, RequirementNode } from '../../lib/requirement-analysis-api'
import { AnalysisBoard, type AnalysisBoardProps } from './AnalysisBoard'
import { emptyBoard } from './board/persistence'
import type { Board } from './board/types'

const stub = vi.hoisted(() => ({
  canvasProps: { current: null as Record<string, unknown> | null },
  canvasHandle: {
    zoomBy: vi.fn<(factor: number) => void>(),
    fit: vi.fn<() => Promise<void>>(),
  },
  renderBoard: vi.fn(),
  downloadDataUrl: vi.fn(),
}))

vi.mock('./board/BoardCanvas', async () => {
  const { forwardRef, useImperativeHandle, createElement } = await import('react')
  return {
    BoardCanvas: forwardRef(function BoardCanvasStub(props: Record<string, unknown>, ref: React.Ref<unknown>) {
      stub.canvasProps.current = props
      useImperativeHandle(ref, () => stub.canvasHandle)
      return createElement('div', { 'data-testid': 'board-canvas-stub' })
    }),
  }
})

vi.mock('./board/renderer', () => ({
  renderBoard: stub.renderBoard,
}))

vi.mock('../../lib/requirement-export', () => ({
  downloadDataUrl: stub.downloadDataUrl,
}))

const tree: RequirementNode = {
  id: 'root',
  title: '登录需求',
  children: [{ id: 'n1', title: '账号密码登录', children: [] }],
}

const findings: Finding[] = [
  { id: 'f1', type: 'risk', title: '缺少密码错误锁定策略', detail: '存在暴力破解风险', nodeId: 'n1' },
]

const result = {
  title: '登录需求分析',
  tree,
  findings,
  sourceText: '原始需求文本',
  truncated: false,
  warnings: ['存在潜在风险'],
}

function renderBoard(overrides: Partial<AnalysisBoardProps> = {}) {
  const board: Board = overrides.board ?? {
    ...emptyBoard(),
    elements: [{ id: 'mindmap-1', kind: 'mindmap-ref', x: 40, y: 40, w: 320, h: 200, sourceNodeId: null, selectedNodeId: 'n1' }],
  }
  const props: AnalysisBoardProps = {
    recordName: '登录需求分析',
    recordId: 'rec-1',
    result,
    board,
    onBoardChange: vi.fn(),
    onHandoff: vi.fn(),
    onExportFile: vi.fn(),
    onExportError: vi.fn(),
    error: null,
    onBack: vi.fn(),
    ...overrides,
  }
  return { ...render(<AnalysisBoard {...props} />), props }
}

beforeEach(() => {
  vi.clearAllMocks()
  stub.canvasHandle.fit.mockResolvedValue(undefined)
})

describe('AnalysisBoard 分析画板', () => {
  it('渲染画板外壳：左上胶囊、左栏工具、右下缩放、右上生成用例', () => {
    renderBoard()
    expect(screen.getByRole('region', { name: '分析画板' })).toBeInTheDocument()
    expect(screen.getByText('登录需求分析')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回列表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '基于此需求生成测试用例' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '因果图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '判定表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '正交表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '缩小' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放大' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '适应屏幕' })).toBeInTheDocument()
    expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('100%')
  })

  it('未选中需求节点时插入按钮禁用', () => {
    renderBoard({
      board: {
        ...emptyBoard(),
        elements: [{ id: 'mindmap-1', kind: 'mindmap-ref', x: 40, y: 40, w: 320, h: 200, sourceNodeId: null, selectedNodeId: null }],
      },
    })
    expect(screen.getByRole('button', { name: '因果图' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '判定表' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '正交表' })).toBeDisabled()
  })

  it('选中需求节点后点击因果图插入，生成成功时占位被真实图元替换', async () => {
    const onBoardChange = vi.fn()
    const onGenerateChart = vi.fn().mockResolvedValue({
      nodes: [
        { id: 'c1', role: 'cause', text: '短信≤210字', x: 0, y: 0 },
        { id: 'e1', role: 'effect', text: '按单条计费', x: 100, y: 0 },
      ],
      edges: [{ id: 'edge1', from: 'c1', to: 'e1', constraint: 'identity' }],
    })
    renderBoard({ onBoardChange, onGenerateChart })

    fireEvent.click(screen.getByRole('button', { name: '因果图' }))
    await waitFor(() => {
      const lastCall = onBoardChange.mock.calls[onBoardChange.mock.calls.length - 1][0] as { elements: Array<{ kind: string; pending?: boolean; error?: string; nodes?: unknown[] }> }
      const ce = lastCall.elements.find((e) => e.kind === 'cause-effect')
      expect(ce).toBeDefined()
      expect(ce?.pending).toBeUndefined()
      expect(ce?.error).toBeUndefined()
      expect(ce?.nodes).toHaveLength(2)
    })
  })

  it('选中需求节点后点击因果图插入，生成失败时显示错误卡片并可删除', async () => {
    const onBoardChange = vi.fn()
    const onExportError = vi.fn()
    const onGenerateChart = vi.fn().mockRejectedValue(new Error('AI 生成服务不可用'))
    renderBoard({ onBoardChange, onExportError, onGenerateChart })

    fireEvent.click(screen.getByRole('button', { name: '因果图' }))
    await waitFor(() => {
      expect(screen.getByText('AI 生成服务不可用')).toBeInTheDocument()
    })
    expect(onExportError).not.toHaveBeenCalled()
    expect(onBoardChange).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(screen.queryByText('AI 生成服务不可用')).not.toBeInTheDocument()
    })
  })

  it('导出菜单选择文件格式，触发 onExportFile', () => {
    const { props } = renderBoard()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'XMind' }))
    expect(props.onExportFile).toHaveBeenCalledWith('xmind')
  })

  it('导出 PNG 调用离屏渲染并下载', () => {
    stub.renderBoard.mockImplementation((canvas: HTMLCanvasElement) => {
      canvas.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,AAA')
    })
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '图片 (PNG)' }))
    expect(stub.renderBoard).toHaveBeenCalled()
    expect(stub.downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,AAA', '登录需求分析.png')
  })

  it('生成测试用例按钮触发 onHandoff', () => {
    const { props } = renderBoard()
    fireEvent.click(screen.getByRole('button', { name: '基于此需求生成测试用例' }))
    expect(props.onHandoff).toHaveBeenCalledTimes(1)
  })

  it('插入模板打开模板中心，测试设计模板可用、静态模板禁用', () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: '插入模板' }))
    expect(screen.getByRole('dialog', { name: '模板中心' })).toBeInTheDocument()

    // 测试设计分类默认选中，思维导图模板可用
    const templateCards = screen.getAllByRole('article')
    expect(templateCards.length).toBeGreaterThan(0)
    const firstUseButton = within(templateCards[0]).getByRole('button', { name: '使用模板' })
    expect(firstUseButton).toBeEnabled()

    // 切换至绘图分类，静态模板（如组织结构图）不可用
    fireEvent.click(screen.getByRole('button', { name: '绘图&创作' }))
    const staticCard = screen.getByText('组织结构图').closest('article') as HTMLElement
    const staticButton = within(staticCard).getByRole('button', { name: '该模板即将上线' })
    expect(staticButton).toBeDisabled()
  })

  it('缩放条：放大/缩小按 ±20% 步进驱动画板，外部缩放回报更新百分比', () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(stub.canvasHandle.zoomBy).toHaveBeenCalledTimes(1)
    expect(stub.canvasHandle.zoomBy.mock.calls[0][0]).toBeCloseTo(1.2)

    act(() => stub.canvasProps.current?.onZoomChange?.(1.44))
    expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('144%')

    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    expect(stub.canvasHandle.zoomBy).toHaveBeenCalledTimes(2)
    expect(stub.canvasHandle.zoomBy.mock.calls[1][0]).toBeCloseTo(1 / 1.2)
  })

  it('适应屏幕调用 fit', () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: '适应屏幕' }))
    expect(stub.canvasHandle.fit).toHaveBeenCalledTimes(1)
  })

  it('警告横幅可关闭', () => {
    renderBoard()
    expect(screen.getByText('存在潜在风险')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭警告提示' }))
    expect(screen.queryByText('存在潜在风险')).not.toBeInTheDocument()
  })

  it('ESC 触发返回列表', () => {
    const { props } = renderBoard()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })
})
