/** React Flow 画板图模型（纯白板化，ADR 0010）：节点即 RF 默认节点，data 仅持 label */

import type { Node, Edge } from '@xyflow/react'

export interface BoardNodeData extends Record<string, unknown> {
  label: string
}

export type BoardNode = Node<BoardNodeData>
export type BoardEdge = Edge

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
