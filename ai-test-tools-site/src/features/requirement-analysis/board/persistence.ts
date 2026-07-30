import { BOARD_LIMITS, type Board, type BoardElement, type CauseEffectConstraint, type CauseEffectElement, type CauseEffectNodeRole, type DecisionTableConditionValue, type DecisionTableElement, type ElementKind, type FlowchartElement, type MindmapRefElement, type OrthogonalElement } from './types'

/** 创建空白白板 */
export function emptyBoard(): Board {
  return { version: 1, elements: [] }
}

/** 序列化白板；selectedNodeId/pending/error 为会话态，不持久化 */
export function serializeBoard(board: Board): string {
  const toPersist: Board = {
    ...board,
    elements: board.elements.map((el) => {
      const cleaned = { ...el, pending: undefined, error: undefined }
      if (cleaned.kind === 'mindmap-ref') {
        cleaned.selectedNodeId = null
      }
      return cleaned
    }),
  }
  return JSON.stringify(toPersist)
}

/** 反序列化白板；按 kind 做结构校验，坏图元过滤，version 非 1 返回 null */
export function deserializeBoard(raw: unknown): Board | null {
  if (!isRecord(raw)) return null
  if (raw.version !== 1) return null
  if (!Array.isArray(raw.elements)) return null

  const elements = raw.elements.map(parseElement).filter((el): el is BoardElement => el !== null)
  return { version: 1, elements }
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

const VALID_ELEMENT_KINDS: ElementKind[] = ['mindmap-ref', 'cause-effect', 'decision-table', 'orthogonal', 'flowchart']

function parseElement(raw: unknown): BoardElement | null {
  if (!isRecord(raw)) return null

  const id = raw.id
  const kind = raw.kind
  const x = raw.x
  const y = raw.y
  const w = raw.w
  const h = raw.h
  const sourceNodeId = raw.sourceNodeId

  if (!isString(id) || id === '') return null
  if (!isString(kind) || !VALID_ELEMENT_KINDS.includes(kind as ElementKind)) return null
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) return null
  if (!isStringOrNull(sourceNodeId)) return null

  // pending/error 为会话态，反序列化时剥离
  const base = { id, kind, x, y, w, h, sourceNodeId }

  switch (kind) {
    case 'mindmap-ref': {
      const selectedNodeId = raw.selectedNodeId
      if (!isStringOrNull(selectedNodeId)) return null
      return { ...base, kind: 'mindmap-ref', selectedNodeId } as MindmapRefElement
    }
    case 'cause-effect': {
      if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null
      const nodes = raw.nodes.map(parseCauseEffectNode).filter((n): n is typeof n => n !== null)
      const edges = raw.edges.map(parseCauseEffectEdge).filter((e): e is typeof e => e !== null)
      if (nodes.length !== raw.nodes.length || edges.length !== raw.edges.length) return null
      return { ...base, kind: 'cause-effect', nodes, edges } as CauseEffectElement
    }
    case 'decision-table': {
      if (!Array.isArray(raw.conditions) || !Array.isArray(raw.actions) || !Array.isArray(raw.rules)) return null
      if (!raw.conditions.every((v: unknown): v is string => isString(v))) return null
      if (!raw.actions.every((v: unknown): v is string => isString(v))) return null
      const conditions = raw.conditions as string[]
      const actions = raw.actions as string[]
      const rules = raw.rules.map(parseDecisionTableRule).filter((r): r is typeof r => r !== null)
      if (rules.length !== raw.rules.length) return null
      return { ...base, kind: 'decision-table', conditions, actions, rules } as DecisionTableElement
    }
    case 'orthogonal': {
      if (!Array.isArray(raw.factors) || !Array.isArray(raw.rows)) return null
      if (!isString(raw.arrayName)) return null
      const factors = raw.factors.map(parseOrthogonalFactor).filter((f): f is typeof f => f !== null)
      const rows = raw.rows.map(parseOrthogonalRow).filter((r): r is typeof r => r !== null)
      if (factors.length !== raw.factors.length || rows.length !== raw.rows.length) return null
      return { ...base, kind: 'orthogonal', factors, arrayName: raw.arrayName, rows } as OrthogonalElement
    }
    case 'flowchart': {
      if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null
      const nodes = raw.nodes.map(parseFlowchartNode).filter((n): n is typeof n => n !== null)
      if (nodes.length !== raw.nodes.length) return null
      const nodeIds = new Set(nodes.map((n) => n!.id))
      const edges = raw.edges.map((e) => parseFlowchartEdge(e, nodeIds)).filter((e): e is typeof e => e !== null)
      if (edges.length !== raw.edges.length) return null
      return { ...base, kind: 'flowchart', nodes, edges } as FlowchartElement
    }
    default:
      return null
  }
}

function parseCauseEffectNode(raw: unknown): { id: string; role: CauseEffectNodeRole; text: string; x: number; y: number } | null {
  if (!isRecord(raw)) return null
  const id = raw.id
  const role = raw.role
  const text = raw.text
  const x = raw.x
  const y = raw.y
  if (!isString(id) || id === '') return null
  if (!isString(role) || !['cause', 'intermediate', 'effect'].includes(role)) return null
  if (!isString(text)) return null
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
  return { id, role: role as CauseEffectNodeRole, text, x, y }
}

function parseCauseEffectEdge(raw: unknown): { id: string; from: string; to: string; constraint: CauseEffectConstraint } | null {
  if (!isRecord(raw)) return null
  const id = raw.id
  const from = raw.from
  const to = raw.to
  const constraint = raw.constraint
  if (!isString(id) || id === '') return null
  if (!isString(from) || from === '') return null
  if (!isString(to) || to === '') return null
  if (!isString(constraint) || !['and', 'or', 'not', 'identity'].includes(constraint)) return null
  return { id, from, to, constraint: constraint as CauseEffectConstraint }
}

function parseDecisionTableRule(raw: unknown): { conditionValues: DecisionTableConditionValue[]; actionValues: boolean[] } | null {
  if (!isRecord(raw)) return null
  if (!Array.isArray(raw.conditionValues) || !Array.isArray(raw.actionValues)) return null
  const conditionValues = raw.conditionValues.filter((v): v is DecisionTableConditionValue => isString(v) && ['Y', 'N', '-'].includes(v))
  const actionValues = raw.actionValues.filter((v): v is boolean => typeof v === 'boolean')
  if (conditionValues.length !== raw.conditionValues.length) return null
  if (actionValues.length !== raw.actionValues.length) return null
  return { conditionValues, actionValues }
}

function parseOrthogonalFactor(raw: unknown): { name: string; levels: string[] } | null {
  if (!isRecord(raw)) return null
  if (!isString(raw.name) || !Array.isArray(raw.levels)) return null
  const levels = raw.levels.map((v) => (isString(v) ? v : null)).filter((v): v is string => v !== null)
  if (levels.length !== raw.levels.length) return null
  return { name: raw.name, levels }
}

function parseOrthogonalRow(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const row = raw.map((v) => (isString(v) ? v : null)).filter((v): v is string => v !== null)
  if (row.length !== raw.length) return null
  return row
}

function parseFlowchartNode(raw: unknown): { id: string; kind: 'start' | 'end' | 'process' | 'decision'; text: string; x: number; y: number } | null {
  if (!isRecord(raw)) return null
  const id = raw.id
  const kind = raw.kind
  const text = raw.text
  const x = raw.x
  const y = raw.y
  if (!isString(id) || id === '') return null
  if (!isString(kind) || !['start', 'end', 'process', 'decision'].includes(kind)) return null
  if (!isString(text) || text.length > BOARD_LIMITS.MAX_TEXT_LENGTH) return null
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
  return { id, kind: kind as 'start' | 'end' | 'process' | 'decision', text, x, y }
}

function parseFlowchartEdge(raw: unknown, nodeIds: Set<string>): { id: string; from: string; to: string; label?: string } | null {
  if (!isRecord(raw)) return null
  const id = raw.id
  const from = raw.from
  const to = raw.to
  const label = raw.label
  if (!isString(id) || id === '') return null
  if (!isString(from) || from === '' || !nodeIds.has(from)) return null
  if (!isString(to) || to === '' || !nodeIds.has(to)) return null
  if (label !== undefined && !isString(label)) return null
  if (label !== undefined && label.length > BOARD_LIMITS.MAX_TEXT_LENGTH) return null
  return { id, from, to, label }
}
