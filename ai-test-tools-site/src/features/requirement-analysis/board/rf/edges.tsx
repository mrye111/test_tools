/** RF 自定义边：因果图约束边（中点符号，点击循环切换约束——#19）与流程图标签边 */

import { useContext } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react'
import { BoardCanvasContext } from './context'
import type { BoardEdgeData } from './rf-types'

const CONSTRAINT_SYMBOL: Record<string, string> = {
  and: '∧',
  or: '∨',
  not: '¬',
  identity: '＝',
}

/** 约束符号标签按钮（独立导出以便测试；EdgeLabelRenderer 的 portal 在独立渲染时不存在） */
export function CeEdgeLabelButton({ constraint, onClick }: { constraint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rf-edge-label rf-edge-label-btn nodrag"
      title="点击切换约束（恒等→与→或→非）"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {CONSTRAINT_SYMBOL[constraint]}
    </button>
  )
}

/** 因果图边：贝塞尔曲线 + 中点约束符号（点击循环 identity→and→or→not） */
export function CeEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<BoardEdgeData>>) {
  const { onCycleConstraint } = useContext(BoardCanvasContext)
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={path} className={`rf-ce-edge${selected ? ' is-selected' : ''}`} />
      {data?.constraint && (
        <EdgeLabelRenderer>
          <div style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, position: 'absolute' }}>
            <CeEdgeLabelButton constraint={data.constraint} onClick={() => onCycleConstraint?.(id)} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

/** 流程图边：贝塞尔曲线 + 可选文本标签（是/否等） */
export function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<BoardEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={path} className={`rf-flow-edge${selected ? ' is-selected' : ''}`} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div className="rf-edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
