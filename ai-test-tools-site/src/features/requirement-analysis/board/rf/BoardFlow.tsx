/** BoardFlow：纯白板 React Flow 画布（ADR 0010）。全量 RF 原生 UI：Controls / MiniMap / Background / 默认节点与边。 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  MarkerType,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { BoardEdge, BoardGraph, BoardNode, BoardViewport } from './rf-types'

export interface BoardFlowHandle {
  zoomBy(factor: number): void
  fit(): void
}

export interface GraphChangeMeta {
  /** 历史级别：commit 入栈（默认）；transient 拖拽中间态；silent 选择/测量 */
  history?: 'commit' | 'transient' | 'silent'
}

export interface BoardFlowProps {
  graph: BoardGraph
  onGraphChange: (graph: BoardGraph, meta?: GraphChangeMeta) => void
  viewport?: BoardViewport
  onViewportChange?: (viewport: BoardViewport) => void
  onZoomChange?: (ratio: number) => void
  onUndo?: () => void
  onRedo?: () => void
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function BoardFlowInner({ graph, onGraphChange, viewport, onViewportChange, onZoomChange, onUndo, onRedo }: BoardFlowProps) {
  const rf = useReactFlow()
  /** 双击编辑中的节点 id（简单内联输入覆盖在节点上） */
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)

  const onNodesChange = useCallback(
    (changes: NodeChange<BoardNode>[]) => {
      let history: 'commit' | 'transient' | 'silent' = 'commit'
      const onlyMeta = changes.every((c) => c.type === 'select' || c.type === 'dimensions')
      if (onlyMeta) {
        history = 'silent'
      } else if (changes.every((c) => c.type === 'position' && c.dragging)) {
        history = 'transient'
      }
      onGraphChange({ nodes: applyNodeChanges(changes, graph.nodes), edges: graph.edges }, { history })
    },
    [graph, onGraphChange],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<BoardEdge>[]) => {
      const history = changes.every((c) => c.type === 'select') ? 'silent' : 'commit'
      onGraphChange({ nodes: graph.nodes, edges: applyEdgeChanges(changes, graph.edges) }, { history })
    },
    [graph, onGraphChange],
  )

  /** 手动连线：默认边 + 箭头 */
  const onConnect = useCallback(
    (connection: Connection) => {
      const edge: BoardEdge = {
        ...connection,
        id: generateId(),
        source: connection.source,
        target: connection.target,
        markerEnd: { type: MarkerType.ArrowClosed },
      }
      onGraphChange({ nodes: graph.nodes, edges: addEdge(edge, graph.edges) }, { history: 'commit' })
    },
    [graph, onGraphChange],
  )

  /** 双击空白：新增默认节点 */
  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const position = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const node: BoardNode = {
        id: generateId(),
        position,
        data: { label: '新节点' },
      }
      onGraphChange({ nodes: [...graph.nodes, node], edges: graph.edges }, { history: 'commit' })
    },
    [graph, onGraphChange, rf],
  )

  /** 双击节点：进入文本编辑 */
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: BoardNode) => {
    setEditingNodeId(node.id)
  }, [])

  const commitNodeText = useCallback(
    (nodeId: string, text: string) => {
      const trimmed = text.trim()
      setEditingNodeId(null)
      if (!trimmed) return
      onGraphChange(
        {
          nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, data: { label: trimmed } } : n)),
          edges: graph.edges,
        },
        { history: 'commit' },
      )
    },
    [graph, onGraphChange],
  )

  // 撤销/重做快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const isMod = e.ctrlKey || e.metaKey
      if (!isMod) return
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) onRedo?.()
        else onUndo?.()
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        onRedo?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onUndo, onRedo])

  const editingNode = editingNodeId ? graph.nodes.find((n) => n.id === editingNodeId) : null
  const editingPos = editingNode ? rf.flowToScreenPosition(editingNode.position) : null

  return (
    <>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDoubleClick={onDoubleClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onMove={(_, vp) => onZoomChange?.(vp.zoom)}
        onMoveEnd={(_, vp) => onViewportChange?.({ x: vp.x, y: vp.y, zoom: vp.zoom })}
        defaultViewport={viewport}
        fitView={!viewport}
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={8}
        deleteKeyCode={['Delete', 'Backspace']}
        zoomOnDoubleClick={false}
        className="rf-board-plain"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
      {editingNode && editingPos && (
        <input
          className="rf-plain-editor"
          style={{ left: editingPos.x, top: editingPos.y }}
          defaultValue={editingNode.data.label}
          autoFocus
          aria-label="编辑节点文本"
          onBlur={(e) => commitNodeText(editingNode.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitNodeText(editingNode.id, (e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setEditingNodeId(null)
          }}
        />
      )}
    </>
  )
}

function ZoomBridge({ handleRef }: { handleRef: React.RefObject<BoardFlowHandle | null> }) {
  const rf = useReactFlow()
  useImperativeHandle(handleRef, () => ({
    zoomBy(factor: number) {
      void rf.zoomTo(rf.getZoom() * factor, { duration: 120 })
    },
    fit() {
      void rf.fitView({ padding: 0.2, maxZoom: 1, duration: 160 })
    },
  }), [rf])
  return null
}

export const BoardFlow = forwardRef<BoardFlowHandle, BoardFlowProps>(function BoardFlow(props, ref) {
  const innerRef = useRef<BoardFlowHandle | null>(null)
  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => innerRef.current?.zoomBy(factor),
    fit: () => innerRef.current?.fit(),
  }), [])
  return (
    <ReactFlowProvider>
      <BoardFlowInner {...props} />
      <ZoomBridge handleRef={innerRef} />
    </ReactFlowProvider>
  )
})

export default BoardFlow
