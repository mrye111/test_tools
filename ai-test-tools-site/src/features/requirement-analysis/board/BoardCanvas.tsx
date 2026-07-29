import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import type { BoardElement, MindmapRefElement } from './types'
import type { RequirementNode } from '../../../lib/requirement-analysis-api'
import { BoardStore } from './board-store'
import { copyElements, moveElements, removeElements, updateElement } from './commands'
import type { Viewport } from './viewport'
import { fitBounds, screenToWorld, worldToScreen, zoomAt } from './viewport'
import { hitTestBoard } from './hit-test'
import { renderBoard } from './renderer'
import { TextEditOverlay } from './TextEditOverlay'
import { BoardToolbar } from './BoardToolbar'
import type { EditingTarget } from './editing-target'

export type { EditingTarget }

export interface BoardCanvasHandle {
  zoomBy(factor: number): void
  fit(): void
}

interface BoardCanvasProps {
  store: BoardStore
  tree: RequirementNode
  onZoomChange?: (ratio: number) => void
  onAction?: (action: 'derive-decision-table' | 'regenerate-array' | 'edit-factor', selection: ReadonlySet<string>) => void
}

/** 工具类型：选择/手型 */
type Tool = 'select' | 'pan'

/** 指针状态 */
interface PointerState {
  id: number
  startScreenX: number
  startScreenY: number
  lastScreenX: number
  lastScreenY: number
  mode: 'idle' | 'pan' | 'drag' | 'marquee'
  startSelection: Set<string>
  dragIds: string[]
  dragOffset: { x: number; y: number }
  marqueeStartWorld: { x: number; y: number }
}

function elementBounds(el: BoardElement): { x: number; y: number; w: number; h: number } {
  return { x: el.x, y: el.y, w: el.w, h: el.h }
}

function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const BoardCanvas = forwardRef<BoardCanvasHandle, BoardCanvasProps>(function BoardCanvas(
  { store, tree, onZoomChange, onAction },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const hasFittedRef = useRef(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [tool, setTool] = useState<Tool>('select')
  const [spacePressed, setSpacePressed] = useState(false)
  const [editing, setEditing] = useState<EditingTarget>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const pointerRef = useRef<PointerState | null>(null)
  const rafRef = useRef<number | null>(null)
  const pasteCountRef = useRef(0)

  const fitOnce = useCallback(() => {
    if (hasFittedRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    // jsdom 等环境 canvas 尚未获得尺寸时跳过，避免视口被错误平移
    if (rect.width === 0 || rect.height === 0) return
    const bounds = computeBoardBounds(store.getBoard().elements)
    if (bounds) {
      setViewport(fitBounds(bounds, rect.width, rect.height, 40))
    }
    hasFittedRef.current = true
  }, [store])

  // 首次挂载 + store/tree 就绪后自动 fit 一次（spec §6.1）
  useEffect(() => {
    fitOnce()
  }, [fitOnce, tree, store])

  const doPaste = useCallback(() => {
    const clipboard = (window as unknown as Record<string, unknown>)
      .__boardClipboard as BoardElement[] | undefined
    if (clipboard?.length) {
      pasteCountRef.current += 1
      const offset = pasteCountRef.current * 24
      const copies = clipboard.map((el) => copyElement(el, generateId, offset))
      store.execute(copyElements(copies))
    }
  }, [store])

  const board = store.getBoard()

  const notifySelection = useCallback(
    (next: Set<string>) => {
      setSelection(next)
    },
    [],
  )

  const doRender = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    renderBoard(canvas, store.getBoard(), viewport, selection, { tree })
  }, [store, viewport, selection, tree])

  const scheduleRender = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      doRender()
    })
  }, [doRender])

  // 订阅 store 变更，合帧重绘
  useEffect(() => {
    const unsubscribe = store.subscribe(() => scheduleRender())
    scheduleRender()
    return () => {
      unsubscribe()
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [store, scheduleRender])

  // 缩放变化回调
  useEffect(() => {
    onZoomChange?.(viewport.zoom)
  }, [onZoomChange, viewport.zoom])

  // 框选状态变化时触发重绘，以渲染选框 overlay
  useEffect(() => {
    scheduleRender()
  }, [marquee, scheduleRender])

  // 暴露缩放控制句柄
  useImperativeHandle(
    ref,
    () => ({
      zoomBy(factor: number) {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        setViewport((vp) => zoomAt(vp, rect.width / 2, rect.height / 2, factor))
      },
      fit() {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const bounds = computeBoardBounds(store.getBoard().elements)
        if (bounds) {
          setViewport(fitBounds(bounds, rect.width, rect.height, 40))
        } else {
          setViewport({ x: 0, y: 0, zoom: 1 })
        }
      },
    }),
    [store],
  )

  // 键盘交互
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 编辑态由 overlay 自己处理，不响应全局快捷键
      if (editing) return

      if (event.key === ' ' && !event.repeat && !spacePressed) {
        event.preventDefault()
        setSpacePressed(true)
        return
      }

      if (event.key.toLowerCase() === 'v') {
        setTool((t) => (t === 'select' ? 'pan' : 'select'))
        return
      }

      const isMod = event.ctrlKey || event.metaKey

      if (isMod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }

      if (isMod && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        const allIds = new Set(store.getBoard().elements.map((el) => el.id))
        notifySelection(allIds)
        return
      }

      if (isMod && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        // 内部剪贴板：复制选中图元
        const clipboard = store
          .getBoard()
          .elements.filter((el) => selection.has(el.id))
        ;(window as unknown as Record<string, unknown>).__boardClipboard = clipboard
        pasteCountRef.current = 0
        return
      }

      if (isMod && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        doPaste()
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (selection.size > 0) {
          store.execute(removeElements([...selection]))
          notifySelection(new Set())
        }
        return
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        setSpacePressed(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [doPaste, editing, notifySelection, selection, spacePressed, store])

  // 滚轮缩放：先换算为 canvas 相对坐标再传给 zoomAt
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const factor = Math.exp(-event.deltaY * 0.001)
      setViewport((vp) => zoomAt(vp, event.clientX - rect.left, event.clientY - rect.top, factor))
    },
    [],
  )

  const startPan = useCallback(
    (screenX: number, screenY: number) => {
      pointerRef.current = {
        id: -1,
        startScreenX: screenX,
        startScreenY: screenY,
        lastScreenX: screenX,
        lastScreenY: screenY,
        mode: 'pan',
        startSelection: new Set(selection),
        dragIds: [],
        dragOffset: { x: 0, y: 0 },
        marqueeStartWorld: { x: 0, y: 0 },
      }
    },
    [selection],
  )

  const startDrag = useCallback(
    (screenX: number, screenY: number, hitId: string, hitWorldX: number, hitWorldY: number) => {
      const ids = selection.has(hitId) ? [...selection] : [hitId]
      if (!selection.has(hitId)) {
        notifySelection(new Set(ids))
      }
      const el = store.getBoard().elements.find((e) => e.id === hitId)
      pointerRef.current = {
        id: -1,
        startScreenX: screenX,
        startScreenY: screenY,
        lastScreenX: screenX,
        lastScreenY: screenY,
        mode: 'drag',
        startSelection: new Set(selection),
        dragIds: ids,
        dragOffset: el ? { x: hitWorldX - el.x, y: hitWorldY - el.y } : { x: 0, y: 0 },
        marqueeStartWorld: { x: 0, y: 0 },
      }
    },
    [notifySelection, selection, store],
  )

  const startMarquee = useCallback(
    (screenX: number, screenY: number) => {
      const world = screenToWorld(viewport, screenX, screenY)
      pointerRef.current = {
        id: -1,
        startScreenX: screenX,
        startScreenY: screenY,
        lastScreenX: screenX,
        lastScreenY: screenY,
        mode: 'marquee',
        startSelection: new Set(selection),
        dragIds: [],
        dragOffset: { x: 0, y: 0 },
        marqueeStartWorld: world,
      }
      setMarquee({ x: world.x, y: world.y, w: 0, h: 0 })
    },
    [selection, viewport],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (editing) return

      canvas.focus()

      const rect = canvas.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      const world = screenToWorld(viewport, sx, sy)

      const isMiddle = event.button === 1
      const isPanTool = tool === 'pan' || spacePressed
      if (isMiddle || isPanTool) {
        try {
          canvas.setPointerCapture(event.pointerId)
        } catch {
          // 非主要指针等场景下 capture 可能失败，忽略
        }
        startPan(sx, sy)
        return
      }

      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        // 非主要指针等场景下 capture 可能失败，忽略
      }

      const hit = hitTestBoard(store.getBoard().elements, world.x, world.y, tree)

      if (hit) {
        let nextSelection: Set<string>
        if (event.shiftKey) {
          nextSelection = new Set(selection)
          if (nextSelection.has(hit.elementId)) nextSelection.delete(hit.elementId)
          else nextSelection.add(hit.elementId)
        } else {
          nextSelection = new Set([hit.elementId])
        }
        notifySelection(nextSelection)

        // mindmap-ref 节点命中时写入 selectedNodeId；选中其他图元或空白时清空
        const el = store.getBoard().elements.find((e) => e.id === hit.elementId)
        if (hit.part === 'node' && el?.kind === 'mindmap-ref') {
          store.execute(updateElement(el.id, (it) => ({ ...(it as MindmapRefElement), selectedNodeId: hit.nodeId })))
        } else {
          const prevMindmap = store.getBoard().elements.find(
            (e) => e.kind === 'mindmap-ref' && e.selectedNodeId !== null
          ) as MindmapRefElement | undefined
          if (prevMindmap) {
            store.execute(
              updateElement(prevMindmap.id, (it) => ({ ...(it as MindmapRefElement), selectedNodeId: null }))
            )
          }
        }

        startDrag(sx, sy, hit.elementId, world.x, world.y)
      } else {
        if (!event.shiftKey) {
          notifySelection(new Set())
        }
        // 点击空白：清空 mindmap-ref 的 selectedNodeId
        const prevMindmap = store
          .getBoard()
          .elements.find((e) => e.kind === 'mindmap-ref' && e.selectedNodeId !== null) as MindmapRefElement | undefined
        if (prevMindmap) {
          store.execute(updateElement(prevMindmap.id, (it) => ({ ...(it as MindmapRefElement), selectedNodeId: null })))
        }
        startMarquee(sx, sy)
      }
    },
    [editing, notifySelection, selection, spacePressed, startDrag, startMarquee, startPan, store, tool, tree, viewport],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const state = pointerRef.current
      if (!state) return
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top

      if (state.mode === 'pan') {
        const dx = sx - state.lastScreenX
        const dy = sy - state.lastScreenY
        setViewport((vp) => ({ ...vp, x: vp.x - dx, y: vp.y - dy }))
        state.lastScreenX = sx
        state.lastScreenY = sy
        return
      }

      if (state.mode === 'drag') {
        const world = screenToWorld(viewport, sx, sy)
        const lastWorld = screenToWorld(viewport, state.lastScreenX, state.lastScreenY)
        const dx = world.x - lastWorld.x
        const dy = world.y - lastWorld.y
        if (dx !== 0 || dy !== 0) {
          store.execute(moveElements(state.dragIds, dx, dy))
        }
        state.lastScreenX = sx
        state.lastScreenY = sy
        return
      }

      if (state.mode === 'marquee') {
        const world = screenToWorld(viewport, sx, sy)
        const x = Math.min(state.marqueeStartWorld.x, world.x)
        const y = Math.min(state.marqueeStartWorld.y, world.y)
        const w = Math.abs(world.x - state.marqueeStartWorld.x)
        const h = Math.abs(world.y - state.marqueeStartWorld.y)
        setMarquee({ x, y, w, h })
      }
    },
    [store, viewport],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const state = pointerRef.current
      if (!state) return
      const canvas = canvasRef.current
      if (canvas) {
        try {
          canvas.releasePointerCapture(event.pointerId)
        } catch {
          // 非主要指针等场景下 release capture 可能失败，忽略
        }
      }

      if (state.mode === 'marquee' && marquee) {
        const hits = store
          .getBoard()
          .elements.filter((el) => rectsIntersect(marquee, elementBounds(el)))
          .map((el) => el.id)
        const nextSelection = event.shiftKey
          ? new Set([...state.startSelection, ...hits])
          : new Set(hits)
        notifySelection(nextSelection)
      }

      pointerRef.current = null
      setMarquee(null)
    },
    [marquee, notifySelection, store],
  )

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (editing) return
      const rect = canvas.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      const world = screenToWorld(viewport, sx, sy)
      const hit = hitTestBoard(store.getBoard().elements, world.x, world.y)
      if (!hit) return

      if (hit.part === 'node') {
        setEditing({ elementId: hit.elementId, field: 'node-text', path: [hit.nodeId] })
      } else if (hit.part === 'body') {
        // 其他图元按 kind 选择可编辑字段
        const el = store.getBoard().elements.find((e) => e.id === hit.elementId)
        if (el?.kind === 'decision-table') {
          setEditing({ elementId: hit.elementId, field: 'cell', path: [] })
        } else if (el?.kind === 'orthogonal') {
          setEditing({ elementId: hit.elementId, field: 'factor', path: [] })
        } else {
          setEditing({ elementId: hit.elementId, field: 'node-text', path: [] })
        }
      }
    },
    [editing, store, viewport],
  )

  const cursor = useMemo(() => {
    if (spacePressed || tool === 'pan') return 'grab'
    return 'default'
  }, [spacePressed, tool])

  return (
    <div
      ref={containerRef}
      className="board-canvas-container"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        className="board-canvas"
        style={{ width: '100%', height: '100%', cursor, touchAction: 'none' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
      {marquee && (
        <div
          data-testid="board-marquee"
          style={{
            position: 'absolute',
            left: worldToScreen(viewport, marquee.x, marquee.y).x,
            top: worldToScreen(viewport, marquee.x, marquee.y).y,
            width: Math.max(1, marquee.w * viewport.zoom),
            height: Math.max(1, marquee.h * viewport.zoom),
            border: '1px dashed rgba(59, 130, 246, 0.8)',
            background: 'rgba(59, 130, 246, 0.12)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        />
      )}
      {selection.size > 0 && (
        <BoardToolbar
          store={store}
          board={board}
          viewport={viewport}
          selection={selection}
          onAction={(action) => onAction?.(action, selection)}
          onCopy={() => {
            const clipboard = board.elements.filter((el) => selection.has(el.id))
            ;(window as unknown as Record<string, unknown>).__boardClipboard = clipboard
            pasteCountRef.current = 0
            doPaste()
          }}
        />
      )}
      {editing && (
        <TextEditOverlay
          target={editing}
          board={board}
          viewport={viewport}
          store={store}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
})

function computeBoardBounds(elements: BoardElement[]): { x: number; y: number; w: number; h: number } | null {
  if (elements.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of elements) {
    minX = Math.min(minX, el.x)
    minY = Math.min(minY, el.y)
    maxX = Math.max(maxX, el.x + el.w)
    maxY = Math.max(maxY, el.y + el.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function copyElement(el: BoardElement, generateId: () => string, offset: number): BoardElement {
  const newId = generateId()
  const copy: BoardElement = { ...el, id: newId, x: el.x + offset, y: el.y + offset }
  if (copy.kind === 'cause-effect') {
    const idMap = new Map<string, string>()
    const nodes = copy.nodes.map((n) => {
      const nodeId = generateId()
      idMap.set(n.id, nodeId)
      return { ...n, id: nodeId }
    })
    const edges = copy.edges.map((e) => ({
      ...e,
      id: generateId(),
      from: idMap.get(e.from) ?? e.from,
      to: idMap.get(e.to) ?? e.to,
    }))
    return { ...copy, nodes, edges }
  }
  if (copy.kind === 'decision-table') {
    return { ...copy }
  }
  if (copy.kind === 'orthogonal') {
    return { ...copy }
  }
  return copy
}

export { BoardCanvas as default }
