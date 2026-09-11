import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { NodeProps, Node } from '@xyflow/react'
import {
  CeNodeView,
  ChartPendingNodeView,
  DecisionTableNodeView,
  FlowchartNodeView,
  MindmapRefNodeView,
  OrthogonalNodeView,
} from './nodes'
import { CeEdgeLabelButton } from './edges'
import { BoardCanvasContext } from './context'
import type {
  CeNodeData,
  ChartPendingNodeData,
  DecisionTableNodeData,
  FlowchartNodeData,
  MindmapRefNodeData,
  OrthogonalNodeData,
} from './rf-types'

function nodeProps<T extends Record<string, unknown>>(data: T): NodeProps<Node<T & { kind: string }>> {
  return {
    id: 'n1',
    data,
    selected: false,
    dragging: false,
  } as unknown as NodeProps<Node<T & { kind: string }>>
}

function renderNode(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('RF 自定义节点渲染', () => {
  it('因果图节点：角色徽标与文案', () => {
    renderNode(<CeNodeView {...nodeProps<CeNodeData>({ kind: 'ce-node', groupId: 'g1', role: 'cause', text: '密码错误≥5次', sourceNodeId: null })} />)
    expect(screen.getByText('因')).toBeInTheDocument()
    expect(screen.getByText('密码错误≥5次')).toBeInTheDocument()
  })

  it('流程图节点：decision 菱形 / process 矩形文案', () => {
    renderNode(<FlowchartNodeView {...nodeProps<FlowchartNodeData>({ kind: 'flowchart-node', groupId: 'g1', nodeKind: 'decision', text: '库存充足？', sourceNodeId: null })} />)
    expect(screen.getByText('库存充足？')).toBeInTheDocument()
  })

  it('判定表节点：条件/动作/规则表格', () => {
    renderNode(
      <DecisionTableNodeView
        {...nodeProps<DecisionTableNodeData>({
          kind: 'decision-table',
          conditions: ['密码正确'],
          actions: ['登录成功'],
          rules: [
            { conditionValues: ['Y'], actionValues: [true] },
            { conditionValues: ['N'], actionValues: [false] },
          ],
          sourceNodeId: null,
        })}
      />,
    )
    expect(screen.getByText('判定表')).toBeInTheDocument()
    expect(screen.getByText('密码正确')).toBeInTheDocument()
    expect(screen.getByText('登录成功')).toBeInTheDocument()
    expect(screen.getByText('Y')).toBeInTheDocument()
    expect(screen.getByText('✓')).toBeInTheDocument()
  })

  it('正交表节点：表名、因子与行', () => {
    renderNode(
      <OrthogonalNodeView
        {...nodeProps<OrthogonalNodeData>({
          kind: 'orthogonal',
          factors: [{ name: '浏览器', levels: ['Chrome', 'Firefox'] }],
          arrayName: 'L4(2^3)',
          rows: [['Chrome'], ['Firefox']],
          sourceNodeId: null,
        })}
      />,
    )
    expect(screen.getByText(/L4\(2\^3\)/)).toBeInTheDocument()
    expect(screen.getByText('浏览器')).toBeInTheDocument()
    expect(screen.getByText('Chrome')).toBeInTheDocument()
  })

  it('需求树参考节点：渲染树节点并回报点选', () => {
    const onSelect = vi.fn()
    const tree = { id: 'root', title: '登录需求', children: [{ id: 'n1', title: '账号登录', children: [] }] }
    render(
      <BoardCanvasContext.Provider value={{ tree, onSelectMindmapNode: onSelect }}>
        <ReactFlowProvider>
          <MindmapRefNodeView {...nodeProps<MindmapRefNodeData>({ kind: 'mindmap-ref', selectedNodeId: null })} />
        </ReactFlowProvider>
      </BoardCanvasContext.Provider>,
    )
    expect(screen.getAllByText('登录需求').length).toBeGreaterThan(0)
    screen.getAllByText('账号登录')[0].closest('g')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onSelect).toHaveBeenCalledWith('n1', 'n1')
  })

  it('占位节点：加载态与错误态（重试/删除回调）', () => {
    const onRetry = vi.fn()
    const onDelete = vi.fn()
    const { unmount } = render(
      <BoardCanvasContext.Provider value={{ tree: null }}>
        <ReactFlowProvider>
          <ChartPendingNodeView {...nodeProps<ChartPendingNodeData>({ kind: 'chart-pending', chartKind: 'cause-effect', sourceNodeId: 'n1' })} />
        </ReactFlowProvider>
      </BoardCanvasContext.Provider>,
    )
    expect(screen.getByText('AI 生成中…')).toBeInTheDocument()
    unmount()

    render(
      <BoardCanvasContext.Provider value={{ tree: null, onRetryPending: onRetry, onDeletePending: onDelete }}>
        <ReactFlowProvider>
          <ChartPendingNodeView {...nodeProps<ChartPendingNodeData>({ kind: 'chart-pending', chartKind: 'cause-effect', sourceNodeId: 'n1', error: '服务不可用' })} />
        </ReactFlowProvider>
      </BoardCanvasContext.Provider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('服务不可用')
    screen.getByRole('button', { name: '重试' }).click()
    expect(onRetry).toHaveBeenCalledWith('n1')
    screen.getByRole('button', { name: '删除' }).click()
    expect(onDelete).toHaveBeenCalledWith('n1')
  })
})

describe('文本编辑与约束切换（#19）', () => {
  it('因果图节点双击进入编辑，Enter 提交回调', () => {
    const onUpdateNodeText = vi.fn()
    render(
      <BoardCanvasContext.Provider value={{ tree: null, onUpdateNodeText }}>
        <ReactFlowProvider>
          <CeNodeView {...nodeProps<CeNodeData>({ kind: 'ce-node', groupId: 'g1', role: 'cause', text: '原文案', sourceNodeId: null })} />
        </ReactFlowProvider>
      </BoardCanvasContext.Provider>,
    )
    fireEvent.doubleClick(screen.getByText('原文案'))
    const input = screen.getByDisplayValue('原文案')
    fireEvent.change(input, { target: { value: '新文案' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onUpdateNodeText).toHaveBeenCalledWith('n1', '新文案')
  })

  it('Esc 取消编辑不提交', () => {
    const onUpdateNodeText = vi.fn()
    render(
      <BoardCanvasContext.Provider value={{ tree: null, onUpdateNodeText }}>
        <ReactFlowProvider>
          <CeNodeView {...nodeProps<CeNodeData>({ kind: 'ce-node', groupId: 'g1', role: 'cause', text: '原文案', sourceNodeId: null })} />
        </ReactFlowProvider>
      </BoardCanvasContext.Provider>,
    )
    fireEvent.doubleClick(screen.getByText('原文案'))
    const input = screen.getByDisplayValue('原文案')
    fireEvent.change(input, { target: { value: '改了一半' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onUpdateNodeText).not.toHaveBeenCalled()
    expect(screen.getByText('原文案')).toBeInTheDocument()
  })

  it('因果图边约束标签按钮：点击触发切换回调', () => {
    const onClick = vi.fn()
    render(<CeEdgeLabelButton constraint="and" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: '∧' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
