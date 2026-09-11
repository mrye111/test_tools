import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Finding, RequirementNode } from '../../lib/requirement-analysis-api'
import { AnalysisBoard, type AnalysisBoardProps } from './AnalysisBoard'
import type { BoardGraph } from './board/rf/rf-types'

const stub = vi.hoisted(() => ({
  flowProps: { current: null as Record<string, unknown> | null },
  flowHandle: {
    zoomBy: vi.fn<(factor: number) => void>(),
    fit: vi.fn<() => void>(),
  },
}))

vi.mock('./board/rf/BoardFlow', async () => {
  const { forwardRef, useImperativeHandle, createElement } = await import('react')
  return {
    BoardFlow: forwardRef(function BoardFlowStub(props: Record<string, unknown>, ref: React.Ref<unknown>) {
      stub.flowProps.current = props
      useImperativeHandle(ref, () => stub.flowHandle)
      const graph = props.graph as BoardGraph
      // 渲染占位/错误节点，模拟 RF 画布内的 ChartPendingNode 行为
      return createElement(
        'div',
        { 'data-testid': 'board-flow-stub' },
        graph.nodes
          .filter((n) => n.data.kind === 'chart-pending')
          .map((n) =>
            createElement(
              'div',
              { key: n.id },
              n.data.error
                ? createElement(
                    'div',
                    null,
                    createElement('p', { role: 'alert' }, n.data.error),
                    createElement('button', { type: 'button', onClick: () => (props.onRetryPending as (id: string) => void)?.(n.id) }, '重试'),
                    createElement('button', { type: 'button', onClick: () => (props.onDeletePending as (id: string) => void)?.(n.id) }, '删除'),
                  )
                : createElement('p', null, 'AI 生成中…'),
            ),
          ),
      )
    }),
  }
})

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

function makeGraph(selectedNodeId: string | null = 'n1'): BoardGraph {
  return {
    nodes: [
      {
        id: 'mindmap-1',
        type: 'mindmap-ref',
        position: { x: 40, y: 40 },
        data: { kind: 'mindmap-ref', selectedNodeId },
      },
    ],
    edges: [],
  }
}

function renderBoard(overrides: Partial<AnalysisBoardProps> = {}) {
  const props: AnalysisBoardProps = {
    recordName: '登录需求分析',
    recordId: 'rec-1',
    result,
    graph: makeGraph(),
    onGraphChange: vi.fn(),
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
})

describe('AnalysisBoard 分析画板（React Flow）', () => {
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
    renderBoard({ graph: makeGraph(null) })
    expect(screen.getByRole('button', { name: '因果图' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '判定表' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '正交表' })).toBeDisabled()
  })

  it('选中需求节点后点击因果图插入，生成成功时占位被真实图元替换', async () => {
    const onGraphChange = vi.fn()
    const onGenerateChart = vi.fn().mockResolvedValue({
      nodes: [
        { id: 'c1', role: 'cause', text: '短信≤210字', x: 0, y: 0 },
        { id: 'e1', role: 'effect', text: '按单条计费', x: 100, y: 0 },
      ],
      edges: [{ id: 'edge1', from: 'c1', to: 'e1', constraint: 'identity' }],
    })
    renderBoard({ onGraphChange, onGenerateChart })

    fireEvent.click(screen.getByRole('button', { name: '因果图' }))
    await waitFor(() => {
      const lastCall = onGraphChange.mock.calls[onGraphChange.mock.calls.length - 1][0] as BoardGraph
      const ceNodes = lastCall.nodes.filter((n) => n.data.kind === 'ce-node')
      expect(ceNodes).toHaveLength(2)
      expect(lastCall.edges).toHaveLength(1)
      expect(lastCall.nodes.some((n) => n.data.kind === 'chart-pending')).toBe(false)
    })
  })

  it('选中需求节点后点击因果图插入，生成失败时占位节点进入错误态并可删除', async () => {
    const onExportError = vi.fn()
    const onGenerateChart = vi.fn().mockRejectedValue(new Error('AI 生成服务不可用'))
    // 模拟受控父级：onGraphChange 回写 graph 状态
    function Controlled() {
      const [graph, setGraph] = useState<BoardGraph>(makeGraph())
      return (
        <AnalysisBoard
          recordName="登录需求分析"
          recordId="rec-1"
          result={result}
          graph={graph}
          onGraphChange={setGraph}
          onHandoff={vi.fn()}
          onExportFile={vi.fn()}
          onExportError={onExportError}
          error={null}
          onBack={vi.fn()}
          onGenerateChart={onGenerateChart}
        />
      )
    }
    render(<Controlled />)

    fireEvent.click(screen.getByRole('button', { name: '因果图' }))
    await waitFor(() => {
      expect(screen.getByText('AI 生成服务不可用')).toBeInTheDocument()
    })
    expect(onExportError).not.toHaveBeenCalled()

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
    expect(stub.flowHandle.zoomBy).toHaveBeenCalledTimes(1)
    expect(stub.flowHandle.zoomBy.mock.calls[0][0]).toBeCloseTo(1.2)

    act(() => stub.flowProps.current?.onZoomChange?.(1.44))
    expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('144%')

    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    expect(stub.flowHandle.zoomBy).toHaveBeenCalledTimes(2)
    expect(stub.flowHandle.zoomBy.mock.calls[1][0]).toBeCloseTo(1 / 1.2)
  })

  it('适应屏幕调用 fit', () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: '适应屏幕' }))
    expect(stub.flowHandle.fit).toHaveBeenCalledTimes(1)
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
