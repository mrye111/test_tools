/** RF 自定义节点：5 种图元 + AI 占位/错误节点；视觉沿用画板暗色玻璃质感（rf-board.css） */

import { useContext, useMemo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { layoutMindmap } from '../elements/layout'
import { BoardCanvasContext } from './context'
import type {
  CeNodeData,
  ChartPendingNodeData,
  DecisionTableNodeData,
  FlowchartNodeData,
  MindmapRefNodeData,
  OrthogonalNodeData,
} from './rf-types'

const ROLE_LABEL: Record<CeNodeData['role'], string> = {
  cause: '因',
  intermediate: '中间',
  effect: '果',
}

/** 因果图节点：左侧入、右侧出 */
export function CeNodeView({ data, selected }: NodeProps<Node<CeNodeData>>) {
  return (
    <div className={`rf-ce-node rf-ce-${data.role}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <span className="rf-ce-role">{ROLE_LABEL[data.role]}</span>
      <span className="rf-ce-text" title={data.text}>{data.text}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

/** 流程图节点：上入下出；start/end 胶囊、process 矩形、decision 菱形 */
export function FlowchartNodeView({ data, selected }: NodeProps<Node<FlowchartNodeData>>) {
  const cls = `rf-flow-node rf-flow-${data.nodeKind}${selected ? ' is-selected' : ''}`
  if (data.nodeKind === 'decision') {
    return (
      <div className={cls}>
        <Handle type="target" position={Position.Top} />
        <div className="rf-flow-diamond">
          <span className="rf-flow-diamond-text" title={data.text}>{data.text}</span>
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    )
  }
  return (
    <div className={cls}>
      <Handle type="target" position={Position.Top} />
      <span className="rf-flow-text" title={data.text}>{data.text}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

/** 判定表节点：整体只读表格（格内编辑在跟随票 #20） */
export function DecisionTableNodeView({ data, selected }: NodeProps<Node<DecisionTableNodeData>>) {
  return (
    <div className={`rf-table-node${selected ? ' is-selected' : ''}`}>
      <div className="rf-table-title">判定表</div>
      <table className="rf-table">
        <thead>
          <tr>
            <th className="rf-table-rowhead" />
            {data.rules.map((_, i) => (
              <th key={i}>规则{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.conditions.map((condition, row) => (
            <tr key={`c-${row}`}>
              <th className="rf-table-rowhead" title={condition}>{condition}</th>
              {data.rules.map((rule, col) => (
                <td key={col} className={`rf-table-cell rf-dt-${rule.conditionValues[row] === 'Y' ? 'y' : rule.conditionValues[row] === 'N' ? 'n' : 'dash'}`}>
                  {rule.conditionValues[row] ?? ''}
                </td>
              ))}
            </tr>
          ))}
          {data.actions.map((action, row) => (
            <tr key={`a-${row}`} className="rf-table-action-row">
              <th className="rf-table-rowhead" title={action}>{action}</th>
              {data.rules.map((rule, col) => (
                <td key={col} className="rf-table-cell">{rule.actionValues[row] ? '✓' : ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 正交表节点：整体只读表格 */
export function OrthogonalNodeView({ data, selected }: NodeProps<Node<OrthogonalNodeData>>) {
  return (
    <div className={`rf-table-node${selected ? ' is-selected' : ''}`}>
      <div className="rf-table-title">正交表 {data.arrayName}</div>
      <table className="rf-table">
        <thead>
          <tr>
            {data.factors.map((factor, i) => (
              <th key={i} title={factor.name}>{factor.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="rf-table-cell">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const MINDMAP_NODE_W = 120
const MINDMAP_NODE_H = 32

/** 需求树参考节点：SVG 渲染布局树，节点可点选为 AI 生成上下文 */
export function MindmapRefNodeView({ id, data, selected }: NodeProps<Node<MindmapRefNodeData>>) {
  const { tree, onSelectMindmapNode } = useContext(BoardCanvasContext)
  const layout = useMemo(() => (tree ? layoutMindmap(tree) : []), [tree])

  const bounds = useMemo(() => {
    if (layout.length === 0) return { minX: 0, minY: 0, w: 160, h: 120 }
    const minX = Math.min(...layout.map((n) => n.x - MINDMAP_NODE_W / 2))
    const minY = Math.min(...layout.map((n) => n.y - MINDMAP_NODE_H / 2))
    const maxX = Math.max(...layout.map((n) => n.x + MINDMAP_NODE_W / 2))
    const maxY = Math.max(...layout.map((n) => n.y + MINDMAP_NODE_H / 2))
    return { minX, minY, w: maxX - minX + 20, h: maxY - minY + 20 }
  }, [layout])

  if (!tree) return null

  return (
    <div className={`rf-mindmap-node${selected ? ' is-selected' : ''}`}>
      <div className="rf-table-title">需求树（点击节点选择生成目标）</div>
      <svg width={bounds.w} height={bounds.h} className="rf-mindmap-svg">
        {layout
          .filter((n) => n.parentId !== null)
          .map((n) => {
            const parent = layout.find((p) => p.id === n.parentId)
            if (!parent) return null
            const x1 = parent.x - bounds.minX + 10 + MINDMAP_NODE_W / 2
            const y1 = parent.y - bounds.minY + 10
            const x2 = n.x - bounds.minX + 10 - MINDMAP_NODE_W / 2
            const y2 = n.y - bounds.minY + 10
            const midX = (x1 + x2) / 2
            return (
              <path
                key={`e-${n.id}`}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                className="rf-mindmap-edge"
              />
            )
          })}
        {layout.map((n) => {
          const cx = n.x - bounds.minX + 10
          const cy = n.y - bounds.minY + 10
          const isSelected = data.selectedNodeId === n.id
          return (
            <g
              key={n.id}
              className={`rf-mindmap-item${isSelected ? ' is-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onSelectMindmapNode?.(id, isSelected ? null : n.id)
              }}
            >
              <rect
                x={cx - MINDMAP_NODE_W / 2}
                y={cy - MINDMAP_NODE_H / 2}
                width={MINDMAP_NODE_W}
                height={MINDMAP_NODE_H}
                rx={8}
                className="rf-mindmap-rect"
              />
              <text x={cx} y={cy} className="rf-mindmap-text" dominantBaseline="central" textAnchor="middle">
                {n.title.length > 8 ? `${n.title.slice(0, 8)}…` : n.title}
              </text>
              <title>{n.title}</title>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** AI 生成占位/错误节点（会话态，不入持久化） */
export function ChartPendingNodeView({ id, data }: NodeProps<Node<ChartPendingNodeData>>) {
  const { onRetryPending, onDeletePending } = useContext(BoardCanvasContext)
  if (data.error) {
    return (
      <div className="rf-pending-node is-error nodrag">
        <p role="alert" className="rf-pending-error-text">{data.error}</p>
        <div className="rf-pending-actions">
          <button type="button" onClick={() => onRetryPending?.(id)}>重试</button>
          <button type="button" onClick={() => onDeletePending?.(id)}>删除</button>
        </div>
      </div>
    )
  }
  return (
    <div className="rf-pending-node is-loading" aria-label="AI 生成中">
      <span className="rf-pending-spinner" />
      <p>AI 生成中…</p>
    </div>
  )
}
