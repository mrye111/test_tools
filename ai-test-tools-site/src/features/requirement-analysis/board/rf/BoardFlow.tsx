/** BoardFlow：React Flow 画布置换件（地图 #13 / 票 #14）。RF 状态即真相，父级受控持有。 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { RequirementNode } from '../../../../lib/requirement-analysis-api'
import type { BoardEdge, BoardGraph, BoardNode, BoardViewport } from './rf-types'
import {
  CeNodeView,
  ChartPendingNodeView,
  DecisionTableNodeView,
  FlowchartNodeView,
  MindmapRefNodeView,
  OrthogonalNodeView,
} from './nodes'
import { BoardCanvasContext } from './context'
import { CeEdgeView, FlowEdgeView } from './edges'
import { RF_EDGE_TYPES, RF_NODE_TYPES } from './rf-types'
import './rf-board.css'

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
  tree: RequirementNode
  onSelectMindmapNode?: (mindmapNodeId: string, requirementNodeId: string | null) => void
  onRetryPending?: (nodeId: string) => void
  onDeletePending?: (nodeId: string) => void
  onSelectionChange?: (elementIds: ReadonlySet<string>) => void
  onZoomChange?: (ratio: number) => void
  onUndo?: () => void
  onRedo?: () => void
}

const nodeTypes = {
  [RF_NODE_TYPES.ceNode]: CeNodeView,
  [RF_NODE_TYPES.flowchartNode]: FlowchartNodeView,
  [RF_NODE_TYPES.decisionTable]: DecisionTableNodeView,
  [RF_NODE_TYPES.orthogonal]: OrthogonalNodeView,
  [RF_NODE_TYPES.mindmapRef]: MindmapRefNodeView,
  [RF_NODE_TYPES.chartPending]: ChartPendingNodeView,
}

const edgeTypes = {
  [RF_EDGE_TYPES.ceEdge]: CeEdgeView,
  [RF_EDGE_TYPES.flowEdge]: FlowEdgeView,
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 节点的"图元身份"：组节点归 groupId，单节点归自身 id */
function elementKeyOf(node: BoardNode): string {
  const d = node.data
  return d.kind === 'ce-node' || d.kind === 'flowchart-node' ? d.groupId : node.id
}

function BoardFlowInner(props: BoardFlowProps & { onInitViewport?: (vp: BoardViewport | undefined) => void }) {
  const {
    graph,
    onGraphChange,
    viewport,
    onViewportChange,
    tree,
    onSelectMindmapNode,
    onRetryPending,
    onDeletePending,
    onSelectionChange,
    onZoomChange,
  } = props

  const [spacePressed, setSpacePressed] = useState(false)
  const pasteCountRef = useRef(0)
  const { onUndo, onRedo } = props

  // 变更分类：选择/测量静默；拖拽中间态 transient（dragStop 时 dragging=false 落为 commit）
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

  // 选中变化：折算为图元 id 集合上报（工具栏 derive 动作用）
  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: BoardNode[] }) => {
      onSelectionChange?.(new Set(selectedNodes.map(elementKeyOf)))
    },
    [onSelectionChange],
  )

  // 空格按住平移
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' && !e.repeat) {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
        e.preventDefault()
        setSpacePressed(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpacePressed(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // 复制/粘贴（内部剪贴板；粘贴重新分配 id 与 groupId，偏移 24px 递增）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const isMod = e.ctrlKey || e.metaKey
      if (!isMod) return

      // 撤销/重做（地图 #13 快照栈）
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) onRedo?.()
        else onUndo?.()
        return
      }
      if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        onRedo?.()
        return
      }

      if (e.key.toLowerCase() === 'c') {
        const selected = graph.nodes.filter((n) => n.selected)
        if (selected.length === 0) return
        e.preventDefault()
        const selectedIds = new Set(selected.map((n) => n.id))
        const selectedGroups = new Set(selected.map(elementKeyOf))
        const internalEdges = graph.edges.filter(
          (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
        )
        ;(window as unknown as Record<string, unknown>).__rfBoardClipboard = {
          nodes: selected,
          edges: internalEdges,
          groupCount: selectedGroups.size,
        }
        pasteCountRef.current = 0
        return
      }

      if (e.key.toLowerCase() === 'v') {
        const clipboard = (window as unknown as Record<string, unknown>).__rfBoardClipboard as
          | { nodes: BoardNode[]; edges: BoardEdge[] }
          | undefined
        if (!clipboard?.nodes?.length) return
        e.preventDefault()
        pasteCountRef.current += 1
        const offset = pasteCountRef.current * 24
        const idMap = new Map<string, string>()
        const groupMap = new Map<string, string>()
        const pastedNodes: BoardNode[] = clipboard.nodes.map((n) => {
          const newId = generateId()
          idMap.set(n.id, newId)
          const d = n.data
          let data = d
          if (d.kind === 'ce-node' || d.kind === 'flowchart-node') {
            const newGroup = groupMap.get(d.groupId) ?? generateId()
            groupMap.set(d.groupId, newGroup)
            data = { ...d, groupId: newGroup }
          }
          return {
            ...n,
            id: newId,
            position: { x: n.position.x + offset, y: n.position.y + offset },
            data,
            selected: false,
          }
        })
        const pastedEdges: BoardEdge[] = clipboard.edges.map((edge) => ({
          ...edge,
          id: generateId(),
          source: idMap.get(edge.source) ?? edge.source,
          target: idMap.get(edge.target) ?? edge.target,
          selected: false,
        }))
        onGraphChange({
          nodes: [...graph.nodes, ...pastedNodes],
          edges: [...graph.edges, ...pastedEdges],
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [graph, onGraphChange, onUndo, onRedo])

  const contextValue = useMemo(
    () => ({ tree, onSelectMindmapNode, onRetryPending, onDeletePending }),
    [tree, onSelectMindmapNode, onRetryPending, onDeletePending],
  )

  const defaultViewport = useMemo<Viewport | undefined>(() => viewport, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BoardCanvasContext.Provider value={contextValue}>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={handleSelectionChange}
        onMove={(_, vp) => onZoomChange?.(vp.zoom)}
        onMoveEnd={(_, vp) => onViewportChange?.({ x: vp.x, y: vp.y, zoom: vp.zoom })}
        defaultViewport={defaultViewport}
        fitView={!defaultViewport}
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2.5}
        deleteKeyCode={['Delete', 'Backspace']}
        selectionOnDrag={!spacePressed}
        panOnDrag={spacePressed ? true : [1, 2]}
        zoomOnScroll
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        className="rf-board"
      >
        <Background gap={24} size={1} className="rf-board-bg" />
      </ReactFlow>
    </BoardCanvasContext.Provider>
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
