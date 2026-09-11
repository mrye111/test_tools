/** RF 自定义边：因果图约束边（中点符号）与流程图标签边 */

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react'
import type { BoardEdgeData } from './rf-types'

const CONSTRAINT_SYMBOL: Record<string, string> = {
  and: '∧',
  or: '∨',
  not: '¬',
  identity: '＝',
}

/** 因果图边：贝塞尔曲线 + 中点约束符号 */
export function CeEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<BoardEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const symbol = data?.constraint ? CONSTRAINT_SYMBOL[data.constraint] : undefined
  return (
    <>
      <BaseEdge id={id} path={path} className={`rf-ce-edge${selected ? ' is-selected' : ''}`} />
      {symbol && (
        <EdgeLabelRenderer>
          <div className="rf-edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {symbol}
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
