import { useMemo, useRef, useState } from 'react'
import type { Board, CauseEffectElement } from './types'
import { CE_NODE_H, CE_NODE_W } from './types'
import type { Viewport } from './viewport'
import { worldToScreen } from './viewport'
import { updateElement } from './commands'
import { BoardStore } from './board-store'
import type { EditingTarget } from './editing-target'

function getTextFromTarget(board: Board, target: NonNullable<EditingTarget>): string {
  const el = board.elements.find((e) => e.id === target.elementId)
  if (!el) return ''
  if (target.field === 'node-text' && el.kind === 'cause-effect') {
    const nodeId = target.path[0]
    const node = el.nodes.find((n) => n.id === nodeId)
    return node?.text ?? ''
  }
  return ''
}

interface TextEditOverlayProps {
  target: NonNullable<EditingTarget>
  board: Board
  viewport: Viewport
  store: BoardStore
  onClose: () => void
}

export function TextEditOverlay({ target, board, viewport, store, onClose }: TextEditOverlayProps) {
  const [value, setValue] = useState(() => getTextFromTarget(board, target))
  const submittingRef = useRef(false)
  const element = board.elements.find((e) => e.id === target.elementId)
  if (!element) return null

  const { left, top, width, height } = useMemo(() => {
    if (target.field === 'node-text' && element.kind === 'cause-effect') {
      const nodeId = target.path[0]
      const node = element.nodes.find((n) => n.id === nodeId)
      const pos = worldToScreen(viewport, element.x + (node?.x ?? 0), element.y + (node?.y ?? 0))
      return {
        left: pos.x - CE_NODE_W / 2,
        top: pos.y - CE_NODE_H / 2,
        width: CE_NODE_W,
        height: CE_NODE_H,
      }
    }
    const pos = worldToScreen(viewport, element.x, element.y)
    return { left: pos.x, top: pos.y, width: element.w, height: element.h }
  }, [element, target, viewport])

  const submit = () => {
    if (submittingRef.current) return
    submittingRef.current = true
    if (target.field === 'node-text' && element.kind === 'cause-effect') {
      const nodeId = target.path[0]
      store.execute(
        updateElement(element.id, (el) => {
          const ce = el as CauseEffectElement
          return {
            ...ce,
            nodes: ce.nodes.map((n) => (n.id === nodeId ? { ...n, text: value } : n)),
          }
        }),
      )
    }
    onClose()
  }

  const cancel = () => {
    submittingRef.current = true
    onClose()
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          submit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      onBlur={submit}
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        zIndex: 10,
      }}
      aria-label="编辑文本"
    />
  )
}
