import type { Board, BoardElement } from './types'
import { BoardStore } from './board-store'
import { bringToFront, removeElements, sendToBack } from './commands'
import type { Viewport } from './viewport'
import { worldToScreen } from './viewport'
import { Tooltip } from '../../../components/ui/Tooltip'

interface BoardToolbarProps {
  store: BoardStore
  board: Board
  viewport: Viewport
  selection: ReadonlySet<string>
  onAction?: (action: 'derive-decision-table' | 'regenerate-array' | 'edit-factor') => void
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
  const bounds = selectionBounds(board.elements, selection)
  if (!bounds) return null

  const topCenter = worldToScreen(viewport, bounds.x + bounds.w / 2, bounds.y)
  // 工具条上沿位于选中集包围盒上方，留 8px 间隙
  const top = topCenter.y - 40
  const left = topCenter.x

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

  return (
    <div
      className="board-toolbar"
      style={{
        position: 'absolute',
        top,
        left,
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
      <div style={{ width: 1, background: 'rgba(255,255,255,0.2)', margin: '0 4px' }} role="separator" />
      <Tooltip content="推导判定表" placement="top">
        <button type="button" aria-label="推导判定表" onClick={() => onAction?.('derive-decision-table')}>表</button>
      </Tooltip>
      <Tooltip content="重新生成阵列" placement="top">
        <button type="button" aria-label="重新生成阵列" onClick={() => onAction?.('regenerate-array')}>阵</button>
      </Tooltip>
      <Tooltip content="编辑因子" placement="top">
        <button type="button" aria-label="编辑因子" onClick={() => onAction?.('edit-factor')}>因</button>
      </Tooltip>
    </div>
  )
}
