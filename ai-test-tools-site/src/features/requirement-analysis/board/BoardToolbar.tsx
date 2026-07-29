import { useLayoutEffect, useRef, useState } from 'react'
import type { Board, BoardElement, CauseEffectElement, DecisionTableElement, OrthogonalElement } from './types'
import { BoardStore } from './board-store'
import { bringToFront, removeElements, sendToBack } from './commands'
import type { Viewport } from './viewport'
import { worldToScreen } from './viewport'
import { Tooltip } from '../../../components/ui/Tooltip'

type ToolbarAction = 'derive-decision-table' | 'regenerate-array' | 'edit-factor'

interface BoardToolbarProps {
  store: BoardStore
  board: Board
  viewport: Viewport
  selection: ReadonlySet<string>
  onAction?: (action: ToolbarAction, selection: ReadonlySet<string>) => void
  onCopy: () => void
}

function selectionBounds(
  elements: BoardElement[],
  selection: ReadonlySet<string>,
): { x: number; y: number; w: number; h: number } | null {
  const selected = elements.filter((el) => selection.has(el.id))
  if (selected.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of selected) {
    minX = Math.min(minX, el.x)
    minY = Math.min(minY, el.y)
    maxX = Math.max(maxX, el.x + el.w)
    maxY = Math.max(maxY, el.y + el.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function BoardToolbar({ store, board, viewport, selection, onAction, onCopy }: BoardToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const bounds = selectionBounds(board.elements, selection)

  useLayoutEffect(() => {
    const el = toolbarRef.current
    if (!el || !bounds) return
    const width = el.offsetWidth
    const height = el.offsetHeight
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }, [selection, bounds])

  if (!bounds) return null

  const topCenter = worldToScreen(viewport, bounds.x + bounds.w / 2, bounds.y)
  // 工具条上沿位于选中集包围盒上方，留 8px 间隙； clamp 到容器可视区域
  const rawTop = topCenter.y - 40
  const containerWidth = 800 // 容器宽度在测量前保守取值，measure 后更新
  const clampedTop = Math.max(8, rawTop)
  const clampedLeft = Math.max(8, Math.min(topCenter.x, containerWidth - size.width - 8))

  const handleBringToFront = () => {
    if (selection.size === 0) return
    store.execute(bringToFront([...selection]))
  }

  const handleSendToBack = () => {
    if (selection.size === 0) return
    store.execute(sendToBack([...selection]))
  }

  const handleDelete = () => {
    if (selection.size === 0) return
    store.execute(removeElements([...selection]))
  }

  const selectedElements = board.elements.filter((el) => selection.has(el.id))
  const selectedKinds = new Set(selectedElements.map((el) => el.kind))
  const singleKind = selectedKinds.size === 1 ? [...selectedKinds][0] : null

  const showDeriveDecisionTable = singleKind === 'cause-effect'
  const showRegenerateArray = singleKind === 'decision-table'
  const showEditFactor = singleKind === 'decision-table' || singleKind === 'orthogonal'
  const showActionSeparator = showDeriveDecisionTable || showRegenerateArray || showEditFactor

  const ce = showDeriveDecisionTable
    ? (selectedElements.find((el) => el.kind === 'cause-effect') as CauseEffectElement)
    : undefined
  const dt = showRegenerateArray || showEditFactor
    ? (selectedElements.find((el) => el.kind === 'decision-table') as DecisionTableElement)
    : undefined
  const ortho = showEditFactor
    ? (selectedElements.find((el) => el.kind === 'orthogonal') as OrthogonalElement)
    : undefined

  return (
    <div
      ref={toolbarRef}
      className="board-toolbar"
      style={{
        position: 'absolute',
        top: clampedTop,
        left: clampedLeft,
        transform: 'translate(-50%, 0)',
        zIndex: 20,
        display: 'flex',
        gap: 4,
        padding: '4px 8px',
        borderRadius: 6,
        background: 'rgba(24, 24, 27, 0.85)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      }}
      role="toolbar"
      aria-label="图元操作"
    >
      <Tooltip content="置顶" placement="top">
        <button type="button" aria-label="置顶" onClick={handleBringToFront}>↑</button>
      </Tooltip>
      <Tooltip content="置底" placement="top">
        <button type="button" aria-label="置底" onClick={handleSendToBack}>↓</button>
      </Tooltip>
      <Tooltip content="复制" placement="top">
        <button type="button" aria-label="复制" onClick={onCopy}>⧺</button>
      </Tooltip>
      <Tooltip content="删除" placement="top">
        <button type="button" aria-label="删除" onClick={handleDelete}>×</button>
      </Tooltip>
      {showActionSeparator && <div style={{ width: 1, background: 'rgba(255,255,255,0.2)', margin: '0 4px' }} role="separator" />}
      {showDeriveDecisionTable && ce && (
        <Tooltip content="推导判定表" placement="top">
          <button
            type="button"
            aria-label="推导判定表"
            onClick={() => onAction?.('derive-decision-table', new Set([ce.id]))}
          >
            表
          </button>
        </Tooltip>
      )}
      {showRegenerateArray && dt && (
        <Tooltip content="重新生成阵列" placement="top">
          <button
            type="button"
            aria-label="重新生成阵列"
            onClick={() => onAction?.('regenerate-array', new Set([dt.id]))}
          >
            阵
          </button>
        </Tooltip>
      )}
      {showEditFactor && (dt || ortho) && (
        <Tooltip content="编辑因子" placement="top">
          <button
            type="button"
            aria-label="编辑因子"
            onClick={() => {
              const target = ortho ?? dt
              if (target) onAction?.('edit-factor', new Set([target.id]))
            }}
          >
            因
          </button>
        </Tooltip>
      )}
    </div>
  )
}
