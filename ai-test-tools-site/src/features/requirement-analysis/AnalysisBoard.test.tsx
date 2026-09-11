import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequirementNode } from '../../lib/requirement-analysis-api'
import { AnalysisBoard, type AnalysisBoardProps } from './AnalysisBoard'
import type { BoardGraph } from './board/rf/rf-types'

const stub = vi.hoisted(() => ({
  flowProps: { current: null as Record<string, unknown> | null },
}))

vi.mock('./board/rf/BoardFlow', async () => {
  const { createElement } = await import('react')
  return {
    BoardFlow: (props: Record<string, unknown>) => {
      stub.flowProps.current = props
      const graph = props.graph as BoardGraph
      return createElement(
        'div',
        { 'data-testid': 'board-flow-stub' },
        graph.nodes.map((n) => createElement('span', { key: n.id }, n.data.label)),
      )
    },
  }
})

const tree: RequirementNode = {
  id: 'root',
  title: '登录需求',
  children: [{ id: 'n1', title: '账号密码登录', children: [] }],
}

const result = {
  title: '登录需求分析',
  tree,
  findings: [],
  sourceText: '原始需求文本',
  truncated: false,
  warnings: ['存在潜在风险'],
}

function renderBoard(overrides: Partial<AnalysisBoardProps> = {}) {
  const props: AnalysisBoardProps = {
    recordName: '登录需求分析',
    recordId: 'rec-1',
    result,
    graph: { nodes: [], edges: [] },
    onGraphChange: vi.fn(),
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
})

describe('AnalysisBoard 分析画板（纯白板）', () => {
  it('渲染画板外壳：左上胶囊（返回/标题/导出），无左栏工具、无生成用例按钮', () => {
    renderBoard()
    expect(screen.getByRole('region', { name: '分析画板' })).toBeInTheDocument()
    expect(screen.getByText('登录需求分析')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回列表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument()
    expect(screen.getByTestId('board-flow-stub')).toBeInTheDocument()

    // 纯白板化：语义工具全部下线
    expect(screen.queryByRole('button', { name: '基于此需求生成测试用例' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '因果图' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '判定表' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '正交表' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '插入模板' })).not.toBeInTheDocument()
  })

  it('导出菜单选择文件格式，触发 onExportFile', () => {
    const { props } = renderBoard()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'XMind' }))
    expect(props.onExportFile).toHaveBeenCalledWith('xmind')
  })

  it('撤销/重做回调透传给画布（快捷键在 BoardFlow 内）', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    renderBoard({ onUndo, onRedo })
    expect(stub.flowProps.current?.onUndo).toBe(onUndo)
    expect(stub.flowProps.current?.onRedo).toBe(onRedo)
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
