/** RF 画板持久化（version 3，纯白板：默认节点 + label）。旧版本（v1 语义图元 / v2 自定义节点）一律读为空画板，不做迁移（ADR 0010） */

import type { BoardEdge, BoardGraph, BoardNode, BoardViewport } from './rf-types'

export interface RfBoardSnapshot {
  version: 3
  nodes: BoardNode[]
  edges: BoardEdge[]
  viewport?: BoardViewport
}

export function serializeRfBoard(graph: BoardGraph, viewport?: BoardViewport): string {
  const nodes = graph.nodes.map((n) => ({ ...n, selected: false }))
  const edges = graph.edges.map((e) => ({ ...e, selected: false }))
  const snapshot: RfBoardSnapshot = { version: 3, nodes, edges, viewport }
  return JSON.stringify(snapshot)
}

export function deserializeRfBoard(raw: unknown): RfBoardSnapshot | null {
  if (!isRecord(raw) || raw.version !== 3) return null
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null

  const nodes = raw.nodes.map(parseNode).filter((n): n is BoardNode => n !== null)
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = raw.edges
    .map((e) => parseEdge(e, nodeIds))
    .filter((e): e is BoardEdge => e !== null)

  let viewport: BoardViewport | undefined
  if (isRecord(raw.viewport)) {
    const { x, y, zoom } = raw.viewport
    if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(zoom) && zoom > 0) {
      viewport = { x, y, zoom }
    }
  }

  return { version: 3, nodes, edges, viewport }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseNode(raw: unknown): BoardNode | null {
  if (!isRecord(raw)) return null
  const { id, position } = raw
  if (typeof id !== 'string' || id === '') return null
  if (!isRecord(position) || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) return null
  const label = isRecord(raw.data) && typeof raw.data.label === 'string' ? raw.data.label : ''
  return { id, position: { x: position.x, y: position.y }, data: { label } }
}

function parseEdge(raw: unknown, nodeIds: Set<string>): BoardEdge | null {
  if (!isRecord(raw)) return null
  const { id, source, target } = raw
  if (typeof id !== 'string' || id === '') return null
  if (typeof source !== 'string' || !nodeIds.has(source)) return null
  if (typeof target !== 'string' || !nodeIds.has(target)) return null
  const label = isRecord(raw) && typeof raw.label === 'string' ? raw.label : undefined
  return { id, source, target, label }
}
