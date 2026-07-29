/** 白板 AI 生成草稿与图元转换：校验、id 分配、坐标落位 */

import type { BoardChartKind, RequirementNode } from '../../../lib/requirement-analysis-api'
import type { Board, BoardElement, CauseEffectElement, DecisionTableElement, OrthogonalElement } from './types'
import { BOARD_LIMITS, CE_NODE_H, CE_NODE_W } from './types'

export interface DraftValidationError {
  field: string
  message: string
}

const DEFAULT_DIMENSIONS: Record<Exclude<BoardChartKind, 'mindmap-ref'>, { w: number; h: number }> = {
  'cause-effect': { w: 480, h: 320 },
  'decision-table': { w: 400, h: 200 },
  'orthogonal': { w: 400, h: 240 },
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateNode(node: unknown, prefix: string): DraftValidationError[] {
  const errors: DraftValidationError[] = []
  if (!isRecord(node)) {
    errors.push({ field: prefix, message: '节点必须是对象' })
    return errors
  }
  if (!isString(node.text) || node.text.trim() === '') {
    errors.push({ field: `${prefix}.text`, message: '节点文本不能为空' })
  }
  if (!isString(node.id) || node.id.trim() === '') {
    errors.push({ field: `${prefix}.id`, message: '节点 id 不能为空' })
  }
  const role = node.role
  if (!isString(role) || !['cause', 'intermediate', 'effect'].includes(role)) {
    errors.push({ field: `${prefix}.role`, message: '节点 role 必须是 cause/intermediate/effect 之一' })
  }
  const x = node.x
  const y = node.y
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    errors.push({ field: `${prefix}.x`, message: '节点 x 坐标必须是有限数字' })
  }
  if (typeof y !== 'number' || !Number.isFinite(y)) {
    errors.push({ field: `${prefix}.y`, message: '节点 y 坐标必须是有限数字' })
  }
  return errors
}

function validateDraft(draft: unknown, chartKind: BoardChartKind): DraftValidationError[] {
  const errors: DraftValidationError[] = []
  if (!isRecord(draft)) {
    return [{ field: 'draft', message: 'AI 草稿必须是对象' }]
  }

  if (chartKind === 'cause-effect') {
    const nodes = Array.isArray(draft.nodes) ? draft.nodes : []
    const edges = Array.isArray(draft.edges) ? draft.edges : []
    if (nodes.length === 0) {
      errors.push({ field: 'nodes', message: '因果图至少需要一个节点' })
    }
    if (nodes.length > BOARD_LIMITS.MAX_CE_NODES) {
      errors.push({ field: 'nodes', message: `因果图节点数超过上限 ${BOARD_LIMITS.MAX_CE_NODES}` })
    }
    nodes.forEach((node, index) => {
      errors.push(...validateNode(node, `nodes[${index}]`))
    })
    edges.forEach((edge, index) => {
      if (!isRecord(edge)) {
        errors.push({ field: `edges[${index}]`, message: '边必须是对象' })
        return
      }
      if (!isString(edge.from) || edge.from.trim() === '') {
        errors.push({ field: `edges[${index}].from`, message: '边 from 不能为空' })
      }
      if (!isString(edge.to) || edge.to.trim() === '') {
        errors.push({ field: `edges[${index}].to`, message: '边 to 不能为空' })
      }
      const constraint = edge.constraint
      if (!isString(constraint) || !['and', 'or', 'not', 'identity'].includes(constraint)) {
        errors.push({ field: `edges[${index}].constraint`, message: '边 constraint 必须是 and/or/not/identity 之一' })
      }
    })
    return errors
  }

  if (chartKind === 'decision-table') {
    if (!isStringArray(draft.conditions)) {
      errors.push({ field: 'conditions', message: 'conditions 必须是字符串数组' })
    }
    if (!isStringArray(draft.actions)) {
      errors.push({ field: 'actions', message: 'actions 必须是字符串数组' })
    }
    const rules = Array.isArray(draft.rules) ? draft.rules : []
    if (rules.length === 0) {
      errors.push({ field: 'rules', message: '判定表至少需要一个规则' })
    }
    if (rules.length > BOARD_LIMITS.MAX_DT_RULES) {
      errors.push({ field: 'rules', message: `规则数超过上限 ${BOARD_LIMITS.MAX_DT_RULES}` })
    }
    rules.forEach((rule, index) => {
      if (!isRecord(rule)) {
        errors.push({ field: `rules[${index}]`, message: '规则必须是对象' })
        return
      }
      const conditionValues = Array.isArray(rule.conditionValues) ? rule.conditionValues : []
      const actionValues = Array.isArray(rule.actionValues) ? rule.actionValues : []
      if (!conditionValues.every((v) => v === 'Y' || v === 'N' || v === '-')) {
        errors.push({ field: `rules[${index}].conditionValues`, message: '条件取值必须是 Y/N/- 之一' })
      }
      if (!actionValues.every((v) => typeof v === 'boolean')) {
        errors.push({ field: `rules[${index}].actionValues`, message: '动作取值必须是布尔值' })
      }
    })
    return errors
  }

  if (chartKind === 'orthogonal') {
    const factors = Array.isArray(draft.factors) ? draft.factors : []
    if (factors.length === 0) {
      errors.push({ field: 'factors', message: '正交表至少需要一个因子' })
    }
    if (factors.length > BOARD_LIMITS.MAX_ORTHO_FACTORS) {
      errors.push({ field: 'factors', message: `因子数超过上限 ${BOARD_LIMITS.MAX_ORTHO_FACTORS}` })
    }
    let totalLevels = 0
    factors.forEach((factor, index) => {
      if (!isRecord(factor)) {
        errors.push({ field: `factors[${index}]`, message: '因子必须是对象' })
        return
      }
      if (!isString(factor.name) || factor.name.trim() === '') {
        errors.push({ field: `factors[${index}].name`, message: '因子名称不能为空' })
      }
      const levels = Array.isArray(factor.levels) ? factor.levels : []
      if (levels.length === 0) {
        errors.push({ field: `factors[${index}].levels`, message: '因子至少需要一个水平' })
      }
      if (!isStringArray(levels)) {
        errors.push({ field: `factors[${index}].levels`, message: '因子水平必须是字符串数组' })
      }
      totalLevels += levels.length
    })
    if (totalLevels > BOARD_LIMITS.MAX_ORTHO_LEVELS_TOTAL) {
      errors.push({ field: 'factors', message: `总水平数超过上限 ${BOARD_LIMITS.MAX_ORTHO_LEVELS_TOTAL}` })
    }
    if (!isString(draft.arrayName) || draft.arrayName.trim() === '') {
      errors.push({ field: 'arrayName', message: 'arrayName 不能为空' })
    }
    const rows = Array.isArray(draft.rows) ? draft.rows : []
    if (rows.length === 0) {
      errors.push({ field: 'rows', message: '正交表至少需要一个组合行' })
    }
    rows.forEach((row, index) => {
      if (!Array.isArray(row) || row.length !== factors.length) {
        errors.push({ field: `rows[${index}]`, message: '行必须是数组且长度与因子数一致' })
      }
    })
    return errors
  }

  return [{ field: 'chartKind', message: `不支持的图表类型 ${chartKind}` }]
}

/** 计算合适的落位坐标：避免与现有图元重叠，向右下方偏移 */
function findPlacement(board: Board, preferredX: number, preferredY: number, w: number, h: number): { x: number; y: number } {
  const step = 40
  let x = preferredX
  let y = preferredY
  let attempts = 0
  const maxAttempts = 200

  function intersects() {
    return board.elements.some((el) => !(x + w <= el.x || el.x + el.w <= x || y + h <= el.y || el.y + el.h <= y))
  }

  while (intersects() && attempts < maxAttempts) {
    x += step
    if (x > 800) {
      x = preferredX
      y += step
    }
    attempts += 1
  }

  return { x, y }
}

export function draftToElement(
  draft: unknown,
  chartKind: BoardChartKind,
  sourceNodeId: string,
  board: Board,
): BoardElement {
  const errors = validateDraft(draft, chartKind)
  if (errors.length > 0) {
    throw new Error(`AI 草稿校验失败：${errors.map((e) => `${e.field} ${e.message}`).join('；')}`)
  }
  const d = draft as Record<string, unknown>
  const dim = DEFAULT_DIMENSIONS[chartKind]
  const placement = findPlacement(board, 40, 40, dim.w, dim.h)
  const base = {
    id: generateId(),
    x: placement.x,
    y: placement.y,
    w: dim.w,
    h: dim.h,
    sourceNodeId,
  }

  if (chartKind === 'cause-effect') {
    const nodesInput = d.nodes as Array<Record<string, unknown>>
    const edgesInput = d.edges as Array<Record<string, unknown>> | undefined
    const idMap = new Map<string, string>()
    const nodes = nodesInput.map((node) => {
      const newId = generateId()
      idMap.set(String(node.id), newId)
      return {
        id: newId,
        role: String(node.role) as CauseEffectElement['nodes'][number]['role'],
        text: String(node.text).slice(0, BOARD_LIMITS.MAX_TEXT_LENGTH),
        x: Number(node.x),
        y: Number(node.y),
      }
    })
    const edges = (edgesInput ?? []).map((edge) => ({
      id: generateId(),
      from: idMap.get(String(edge.from)) ?? String(edge.from),
      to: idMap.get(String(edge.to)) ?? String(edge.to),
      constraint: String(edge.constraint) as CauseEffectElement['edges'][number]['constraint'],
    }))
    const maxX = Math.max(0, ...nodes.map((n) => n.x + CE_NODE_W / 2))
    const maxY = Math.max(0, ...nodes.map((n) => n.y + CE_NODE_H / 2))
    const minX = Math.min(0, ...nodes.map((n) => n.x - CE_NODE_W / 2))
    const minY = Math.min(0, ...nodes.map((n) => n.y - CE_NODE_H / 2))
    const element: CauseEffectElement = {
      ...base,
      kind: 'cause-effect',
      x: placement.x,
      y: placement.y,
      w: Math.max(dim.w, maxX - minX + 40),
      h: Math.max(dim.h, maxY - minY + 40),
      nodes: nodes.map((n) => ({ ...n, x: n.x - minX + 20, y: n.y - minY + 20 })),
      edges,
    }
    return element
  }

  if (chartKind === 'decision-table') {
    const element: DecisionTableElement = {
      ...base,
      kind: 'decision-table',
      conditions: (d.conditions as string[]).map((text) => text.slice(0, BOARD_LIMITS.MAX_TEXT_LENGTH)),
      actions: (d.actions as string[]).map((text) => text.slice(0, BOARD_LIMITS.MAX_TEXT_LENGTH)),
      rules: (d.rules as Array<Record<string, unknown>>).map((rule) => ({
        conditionValues: (rule.conditionValues as DecisionTableElement['rules'][number]['conditionValues'][]).slice(
          0,
          BOARD_LIMITS.MAX_TEXT_LENGTH,
        ),
        actionValues: (rule.actionValues as boolean[]).slice(0, BOARD_LIMITS.MAX_TEXT_LENGTH),
      })),
    }
    return element
  }

  const element: OrthogonalElement = {
    ...base,
    kind: 'orthogonal',
    factors: (d.factors as Array<Record<string, unknown>>).map((factor) => ({
      name: String(factor.name).slice(0, BOARD_LIMITS.MAX_TEXT_LENGTH),
      levels: (factor.levels as string[]).map((level) => level.slice(0, BOARD_LIMITS.MAX_TEXT_LENGTH)),
    })),
    arrayName: String(d.arrayName),
    rows: (d.rows as string[][]).map((row) => row.map((cell) => cell.slice(0, BOARD_LIMITS.MAX_TEXT_LENGTH))),
  }
  return element
}

/** 构建需求树参考图元，用于空板自动占位 */
export function buildMindmapRefElement(tree: RequirementNode, x = 40, y = 40): BoardElement {
  return {
    id: generateId(),
    kind: 'mindmap-ref',
    x,
    y,
    w: 320,
    h: 200,
    sourceNodeId: null,
    selectedNodeId: null,
  }
}

/** 收集需求树子节点的文本 */
export function collectSubtreeText(node: RequirementNode, depth = 0): string {
  const indent = '  '.repeat(depth)
  let text = `${indent}- ${node.title}`
  for (const child of node.children) {
    text += '\n' + collectSubtreeText(child, depth + 1)
  }
  return text
}

/** 查找需求节点（包含子树） */
export function findNodeById(tree: RequirementNode, nodeId: string): RequirementNode | null {
  if (tree.id === nodeId) return tree
  for (const child of tree.children) {
    const found = findNodeById(child, nodeId)
    if (found) return found
  }
  return null
}
