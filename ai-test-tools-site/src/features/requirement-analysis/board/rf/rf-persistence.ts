/** RF 画板持久化：序列化/反序列化（version 2；旧 version 1 Board 格式一律视为空画板，不做迁移——地图 #13） */

import type { BoardEdge, BoardGraph, BoardNode, BoardViewport } from './rf-types'
import { RF_EDGE_TYPES, RF_NODE_TYPES } from './rf-types'
import { BOARD_LIMITS } from '../types'

export interface RfBoardSnapshot {
  version: 2
  nodes: BoardNode[]
  edges: BoardEdge[]
  viewport?: BoardViewport
}

/** 序列化画板；chart-pending（会话态）与 mindmap-ref 的 selectedNodeId 不持久化 */
export function serializeRfBoard(graph: BoardGraph, viewport?: BoardViewport): string {
  const nodes = graph.nodes
    .filter((n) => n.data.kind !== 'chart-pending')
    .map((n) => {
      if (n.data.kind === 'mindmap-ref') {
        return { ...n, data: { ...n.data, selectedNodeId: null }, selected: false }
      }
      return { ...n, selected: false }
    })
  const edges = graph.edges.map((e) => ({ ...e, selected: false }))
  const snapshot: RfBoardSnapshot = { version: 2, nodes, edges, viewport }
  return JSON.stringify(snapshot)
}

/** 反序列化画板；结构坏图元过滤，version 非 2 返回 null */
export function deserializeRfBoard(raw: unknown): RfBoardSnapshot | null {
  if (!isRecord(raw)) return null
  if (raw.version !== 2) return null
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null

  const nodes = raw.nodes.map(parseNode).filter((n): n is BoardNode => n !== null)
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = raw.edges.map((e) => parseEdge(e, nodeIds)).filter((e): e is BoardEdge => e !== null)

  let viewport: BoardViewport | undefined
  if (isRecord(raw.viewport)) {
    const { x, y, zoom } = raw.viewport
    if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(zoom) && zoom > 0) {
      viewport = { x, y, zoom }
    }
  }

  return { version: 2, nodes, edges, viewport }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

const VALID_NODE_TYPES: string[] = [
  RF_NODE_TYPES.ceNode,
  RF_NODE_TYPES.flowchartNode,
  RF_NODE_TYPES.decisionTable,
  RF_NODE_TYPES.orthogonal,
  RF_NODE_TYPES.mindmapRef,
]

function parseNode(raw: unknown): BoardNode | null {
  if (!isRecord(raw)) return null
  const { id, type, position, data } = raw
  if (!isString(id) || id === '') return null
  if (!isString(type) || !VALID_NODE_TYPES.includes(type)) return null
  if (!isRecord(position) || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) return null
  if (!isRecord(data)) return null

  const parsedData = parseNodeData(type, data)
  if (!parsedData) return null

  return { id, type, position: { x: position.x, y: position.y }, data: parsedData }
}

function parseNodeData(type: string, data: Record<string, unknown>): BoardNode['data'] | null {
  switch (type) {
    case RF_NODE_TYPES.ceNode: {
      const { groupId, role, text, sourceNodeId } = data
      if (!isString(groupId) || groupId === '') return null
      if (!isString(role) || !['cause', 'intermediate', 'effect'].includes(role)) return null
      if (!isString(text) || text.length > BOARD_LIMITS.MAX_TEXT_LENGTH) return null
      if (!isStringOrNull(sourceNodeId)) return null
      return { kind: 'ce-node', groupId, role: role as 'cause' | 'intermediate' | 'effect', text, sourceNodeId }
    }
    case RF_NODE_TYPES.flowchartNode: {
      const { groupId, nodeKind, text, sourceNodeId } = data
      if (!isString(groupId) || groupId === '') return null
      if (!isString(nodeKind) || !['start', 'end', 'process', 'decision'].includes(nodeKind)) return null
      if (!isString(text) || text.length > BOARD_LIMITS.MAX_TEXT_LENGTH) return null
      if (!isStringOrNull(sourceNodeId)) return null
      return { kind: 'flowchart-node', groupId, nodeKind: nodeKind as 'start' | 'end' | 'process' | 'decision', text, sourceNodeId }
    }
    case RF_NODE_TYPES.decisionTable: {
      const { conditions, actions, rules, sourceNodeId } = data
      if (!isStringArray(conditions) || !isStringArray(actions)) return null
      if (!Array.isArray(rules)) return null
      const parsedRules = rules.map(parseDtRule).filter((r): r is NonNullable<typeof r> => r !== null)
      if (parsedRules.length !== rules.length) return null
      if (!isStringOrNull(sourceNodeId)) return null
      return { kind: 'decision-table', conditions, actions, rules: parsedRules, sourceNodeId }
    }
    case RF_NODE_TYPES.orthogonal: {
      const { factors, arrayName, rows, sourceNodeId } = data
      if (!Array.isArray(factors) || !isString(arrayName) || !Array.isArray(rows)) return null
      const parsedFactors = factors.map(parseFactor).filter((f): f is NonNullable<typeof f> => f !== null)
      if (parsedFactors.length !== factors.length) return null
      const parsedRows = rows.map((r) => (isStringArray(r) ? r : null)).filter((r): r is string[] => r !== null)
      if (parsedRows.length !== rows.length) return null
      if (!isStringOrNull(sourceNodeId)) return null
      return { kind: 'orthogonal', factors: parsedFactors, arrayName, rows: parsedRows, sourceNodeId }
    }
    case RF_NODE_TYPES.mindmapRef:
      // selectedNodeId 为会话态，反序列化始终置 null
      return { kind: 'mindmap-ref', selectedNodeId: null }
    default:
      return null
  }
}

function parseDtRule(raw: unknown): { conditionValues: ('Y' | 'N' | '-')[]; actionValues: boolean[] } | null {
  if (!isRecord(raw)) return null
  const { conditionValues, actionValues } = raw
  if (!Array.isArray(conditionValues) || !Array.isArray(actionValues)) return null
  const cv = conditionValues.filter((v): v is 'Y' | 'N' | '-' => isString(v) && ['Y', 'N', '-'].includes(v))
  const av = actionValues.filter((v): v is boolean => typeof v === 'boolean')
  if (cv.length !== conditionValues.length || av.length !== actionValues.length) return null
  return { conditionValues: cv, actionValues: av }
}

function parseFactor(raw: unknown): { name: string; levels: string[] } | null {
  if (!isRecord(raw)) return null
  if (!isString(raw.name) || !isStringArray(raw.levels)) return null
  return { name: raw.name, levels: raw.levels }
}

const VALID_EDGE_TYPES: string[] = [RF_EDGE_TYPES.ceEdge, RF_EDGE_TYPES.flowEdge]

function parseEdge(raw: unknown, nodeIds: Set<string>): BoardEdge | null {
  if (!isRecord(raw)) return null
  const { id, type, source, target } = raw
  if (!isString(id) || id === '') return null
  if (!isString(source) || !nodeIds.has(source)) return null
  if (!isString(target) || !nodeIds.has(target)) return null
  const edgeType = isString(type) && VALID_EDGE_TYPES.includes(type) ? type : RF_EDGE_TYPES.ceEdge

  const data = isRecord(raw.data) ? raw.data : {}
  const groupId = isString(data.groupId) ? data.groupId : ''
  if (edgeType === RF_EDGE_TYPES.ceEdge) {
    const constraint = data.constraint
    if (!isString(constraint) || !['and', 'or', 'not', 'identity'].includes(constraint)) return null
    return { id, type: edgeType, source, target, data: { groupId, constraint: constraint as 'and' | 'or' | 'not' | 'identity' } }
  }
  const label = data.label
  if (label !== undefined && !isString(label)) return null
  return { id, type: edgeType, source, target, data: { groupId, label } }
}
