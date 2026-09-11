/** RF 自定义节点：5 种图元 + AI 占位/错误节点；视觉沿用画板暗色玻璃质感（rf-board.css） */

import { useContext, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { layoutMindmap } from '../elements/layout'
import { BoardCanvasContext } from './context'
import {
  dtAddAction,
  dtAddCondition,
  dtAddRule,
  dtRemoveAction,
  dtRemoveCondition,
  dtRemoveRule,
  dtRenameRow,
  dtToggleAction,
  dtToggleCell,
  ogRegenerateRows,
  ogSetFactorLevels,
} from './table-ops'
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

/** 双击进入文本编辑的通用行为（#19）：Enter/失焦提交，Esc 取消 */
function useInlineEdit(nodeId: string, currentText: string) {
  const { onUpdateNodeText } = useContext(BoardCanvasContext)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(currentText)

  const start = () => {
    setDraft(currentText)
    setEditing(true)
  }
  const commit = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== currentText) onUpdateNodeText?.(nodeId, draft)
  }
  const cancel = () => setEditing(false)

  return { editing, draft, setDraft, start, commit, cancel }
}

/** 因果图节点：左侧入、右侧出；双击编辑文案 */
export function CeNodeView({ id, data, selected }: NodeProps<Node<CeNodeData>>) {
  const edit = useInlineEdit(id, data.text)
  return (
    <div className={`rf-ce-node rf-ce-${data.role}${selected ? ' is-selected' : ''}`} onDoubleClick={edit.start}>
      <Handle type="target" position={Position.Left} />
      <span className="rf-ce-role">{ROLE_LABEL[data.role]}</span>
      {edit.editing ? (
        <input
          className="rf-node-edit nodrag"
          value={edit.draft}
          autoFocus
          onChange={(e) => edit.setDraft(e.target.value)}
          onBlur={edit.commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') edit.commit()
            if (e.key === 'Escape') edit.cancel()
          }}
        />
      ) : (
        <span className="rf-ce-text" title={data.text}>{data.text}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

/** 流程图节点：上入下出；start/end 胶囊、process 矩形、decision 菱形；双击编辑文案 */
export function FlowchartNodeView({ id, data, selected }: NodeProps<Node<FlowchartNodeData>>) {
  const edit = useInlineEdit(id, data.text)
  const cls = `rf-flow-node rf-flow-${data.nodeKind}${selected ? ' is-selected' : ''}`

  const textEl = edit.editing ? (
    <input
      className="rf-node-edit nodrag"
      value={edit.draft}
      autoFocus
      onChange={(e) => edit.setDraft(e.target.value)}
      onBlur={edit.commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') edit.commit()
        if (e.key === 'Escape') edit.cancel()
      }}
    />
  ) : (
    <span className="rf-flow-text" title={data.text}>{data.text}</span>
  )

  if (data.nodeKind === 'decision') {
    return (
      <div className={cls} onDoubleClick={edit.start}>
        <Handle type="target" position={Position.Top} />
        <div className="rf-flow-diamond">
          <span className="rf-flow-diamond-text" title={data.text}>
            {edit.editing ? textEl : data.text}
          </span>
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    )
  }
  return (
    <div className={cls} onDoubleClick={edit.start}>
      <Handle type="target" position={Position.Top} />
      {textEl}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

/** 行头重命名（双击进入内联编辑） */
function RowHeaderCell({ text, onRename }: { text: string; onRename: (text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  if (!editing) {
    return (
      <th className="rf-table-rowhead" title={`${text}（双击改名）`} onDoubleClick={() => { setDraft(text); setEditing(true) }}>
        {text}
      </th>
    )
  }
  return (
    <th className="rf-table-rowhead">
      <input
        className="rf-node-edit nodrag"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); onRename(draft) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { setEditing(false); onRename(draft) }
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    </th>
  )
}

/** 判定表节点：格内编辑（#20）——单元格点击循环 Y/N/-、动作 ✓ 开关、行列增删、行头双击改名 */
export function DecisionTableNodeView({ id, data, selected }: NodeProps<Node<DecisionTableNodeData>>) {
  const { onUpdateDecisionTable } = useContext(BoardCanvasContext)
  const patch = (next: DecisionTableNodeData) => onUpdateDecisionTable?.(id, next)

  return (
    <div className={`rf-table-node${selected ? ' is-selected' : ''}`}>
      <div className="rf-table-title">判定表</div>
      <table className="rf-table">
        <thead>
          <tr>
            <th className="rf-table-rowhead" />
            {data.rules.map((_, i) => (
              <th key={i}>
                规则{i + 1}
                {data.rules.length > 1 && (
                  <button type="button" className="rf-table-mini-btn nodrag" aria-label={`删除规则${i + 1}`} onClick={() => patch(dtRemoveRule(data, i))}>×</button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.conditions.map((condition, row) => (
            <tr key={`c-${row}`}>
              <RowHeaderCell text={condition} onRename={(t) => patch(dtRenameRow(data, 'conditions', row, t))} />
              {data.rules.map((rule, col) => (
                <td
                  key={col}
                  className={`rf-table-cell rf-dt-${rule.conditionValues[row] === 'Y' ? 'y' : rule.conditionValues[row] === 'N' ? 'n' : 'dash'} rf-dt-editable`}
                  title="点击切换 Y/N/-"
                  onClick={() => patch(dtToggleCell(data, row, col))}
                >
                  {rule.conditionValues[row] ?? ''}
                </td>
              ))}
              {data.conditions.length > 1 && (
                <td className="rf-table-side">
                  <button type="button" className="rf-table-mini-btn nodrag" aria-label={`删除条件「${condition}」`} onClick={() => patch(dtRemoveCondition(data, row))}>×</button>
                </td>
              )}
            </tr>
          ))}
          {data.actions.map((action, row) => (
            <tr key={`a-${row}`} className="rf-table-action-row">
              <RowHeaderCell text={action} onRename={(t) => patch(dtRenameRow(data, 'actions', row, t))} />
              {data.rules.map((rule, col) => (
                <td
                  key={col}
                  className="rf-table-cell rf-dt-editable"
                  title="点击切换动作是否执行"
                  onClick={() => patch(dtToggleAction(data, row, col))}
                >
                  {rule.actionValues[row] ? '✓' : ''}
                </td>
              ))}
              {data.actions.length > 1 && (
                <td className="rf-table-side">
                  <button type="button" className="rf-table-mini-btn nodrag" aria-label={`删除动作「${action}」`} onClick={() => patch(dtRemoveAction(data, row))}>×</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rf-table-actions nodrag">
        <button type="button" onClick={() => patch(dtAddCondition(data))}>+ 条件</button>
        <button type="button" onClick={() => patch(dtAddAction(data))}>+ 动作</button>
        <button type="button" onClick={() => patch(dtAddRule(data))}>+ 规则</button>
      </div>
    </div>
  )
}

/** 正交表节点：因子/水平编辑（#20），水平变更后自动重算阵列 */
export function OrthogonalNodeView({ id, data, selected }: NodeProps<Node<OrthogonalNodeData>>) {
  const { onUpdateOrthogonal } = useContext(BoardCanvasContext)
  const [regenError, setRegenError] = useState<string | null>(null)
  const [editingFactor, setEditingFactor] = useState<number | null>(null)
  const [levelsDraft, setLevelsDraft] = useState('')

  const regenerate = (next: OrthogonalNodeData) => {
    const result = ogRegenerateRows(next)
    // OrthogonalNodeData 带 Record 索引签名，'error' in 收窄需 typeof 兜底
    if ('error' in result && typeof result.error === 'string') {
      setRegenError(result.error)
      return
    }
    setRegenError(null)
    onUpdateOrthogonal?.(id, result as OrthogonalNodeData)
  }

  return (
    <div className={`rf-table-node${selected ? ' is-selected' : ''}`}>
      <div className="rf-table-title">
        正交表 {data.arrayName}
        <button
          type="button"
          className="rf-table-mini-btn nodrag"
          style={{ marginLeft: 8 }}
          onClick={() => regenerate(data)}
        >
          重算阵列
        </button>
      </div>
      {regenError && <p className="rf-table-error" role="alert">{regenError}</p>}
      <table className="rf-table">
        <thead>
          <tr>
            {data.factors.map((factor, i) => (
              <th key={i} title={`${factor.name}（水平：${factor.levels.join(' / ')}，点击编辑水平）`} className="rf-og-factor">
                <span onDoubleClick={(e) => { e.stopPropagation() }}>{factor.name}</span>
                {editingFactor === i ? (
                  <input
                    className="rf-node-edit nodrag"
                    value={levelsDraft}
                    autoFocus
                    placeholder="水平，逗号分隔"
                    onChange={(e) => setLevelsDraft(e.target.value)}
                    onBlur={() => {
                      setEditingFactor(null)
                      const next = ogSetFactorLevels(data, i, levelsDraft)
                      if (next !== data) regenerate(next)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setEditingFactor(null)
                        const next = ogSetFactorLevels(data, i, levelsDraft)
                        if (next !== data) regenerate(next)
                      }
                      if (e.key === 'Escape') setEditingFactor(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="rf-og-levels nodrag"
                    onClick={() => { setLevelsDraft(factor.levels.join('，')); setEditingFactor(i) }}
                  >
                    {factor.levels.join(' / ')}
                  </button>
                )}
              </th>
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
