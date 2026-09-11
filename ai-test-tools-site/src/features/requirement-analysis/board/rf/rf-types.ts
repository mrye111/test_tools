/** React Flow 画板图模型：语义载荷作为节点 data，几何状态由 RF 管理（地图 #13 决策 B） */

import type { Node, Edge } from '@xyflow/react'
import type { BoardChartKind } from '../../../../lib/requirement-analysis-api'
import type {
  CauseEffectConstraint,
  CauseEffectNodeRole,
  DecisionTableRule,
  FlowchartNodeKind,
  OrthogonalFactor,
} from '../types'

/** 因果图子节点：groupId 标记归属哪张因果图（旧 elementId） */
export interface CeNodeData extends Record<string, unknown> {
  kind: 'ce-node'
  groupId: string
  role: CauseEffectNodeRole
  text: string
  sourceNodeId: string | null
}

/** 流程图子节点 */
export interface FlowchartNodeData extends Record<string, unknown> {
  kind: 'flowchart-node'
  groupId: string
  nodeKind: FlowchartNodeKind
  text: string
  sourceNodeId: string | null
}

/** 判定表（整体单节点，表格内编辑在跟随票 #20） */
export interface DecisionTableNodeData extends Record<string, unknown> {
  kind: 'decision-table'
  conditions: string[]
  actions: string[]
  rules: DecisionTableRule[]
  sourceNodeId: string | null
}

/** 正交表（整体单节点） */
export interface OrthogonalNodeData extends Record<string, unknown> {
  kind: 'orthogonal'
  factors: OrthogonalFactor[]
  arrayName: string
  rows: string[][]
  sourceNodeId: string | null
}

/** 需求树参考（树本体由画布 context 提供，data 只持选中态） */
export interface MindmapRefNodeData extends Record<string, unknown> {
  kind: 'mindmap-ref'
  selectedNodeId: string | null
}

/** AI 生成占位/错误节点：会话态，不持久化 */
export interface ChartPendingNodeData extends Record<string, unknown> {
  kind: 'chart-pending'
  chartKind: BoardChartKind
  sourceNodeId: string | null
  error?: string
}

export type BoardNodeData =
  | CeNodeData
  | FlowchartNodeData
  | DecisionTableNodeData
  | OrthogonalNodeData
  | MindmapRefNodeData
  | ChartPendingNodeData

export type BoardNode = Node<BoardNodeData>

/** 因果图边载荷；流程图边只用 label */
export interface BoardEdgeData extends Record<string, unknown> {
  groupId: string
  constraint?: CauseEffectConstraint
  label?: string
}

export type BoardEdge = Edge<BoardEdgeData>

/** 画布图：RF 状态即真相 */
export interface BoardGraph {
  nodes: BoardNode[]
  edges: BoardEdge[]
}

export interface BoardViewport {
  x: number
  y: number
  zoom: number
}

export const RF_NODE_TYPES = {
  ceNode: 'ce-node',
  flowchartNode: 'flowchart-node',
  decisionTable: 'decision-table',
  orthogonal: 'orthogonal',
  mindmapRef: 'mindmap-ref',
  chartPending: 'chart-pending',
} as const

export const RF_EDGE_TYPES = {
  ceEdge: 'ce-edge',
  flowEdge: 'flow-edge',
} as const
