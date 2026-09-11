/** RF 图操作：BoardElement ↔ RF 图转换、AI 草稿落图、占位节点、按组重建语义图元 */

import type { BoardChartKind, RequirementNode } from '../../../../lib/requirement-analysis-api'
import type {
  Board,
  BoardElement,
  CauseEffectElement,
  DecisionTableElement,
  OrthogonalElement,
} from '../types'
import { draftToElement } from '../ai'
import type { BoardEdge, BoardGraph, BoardNode } from './rf-types'
import { RF_EDGE_TYPES, RF_NODE_TYPES } from './rf-types'

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function emptyGraph(): BoardGraph {
  return { nodes: [], edges: [] }
}

/** 单个 BoardElement → RF 节点组（CE/流程图拆为一等节点+边；表类为整体节点） */
export function elementToRf(element: BoardElement): BoardGraph {
  if (element.kind === 'cause-effect') {
    const nodes: BoardNode[] = element.nodes.map((n) => ({
      id: n.id,
      type: RF_NODE_TYPES.ceNode,
      position: { x: element.x + n.x, y: element.y + n.y },
      data: { kind: 'ce-node', groupId: element.id, role: n.role, text: n.text, sourceNodeId: element.sourceNodeId },
    }))
    const edges: BoardEdge[] = element.edges.map((e) => ({
      id: e.id,
      type: RF_EDGE_TYPES.ceEdge,
      source: e.from,
      target: e.to,
      data: { groupId: element.id, constraint: e.constraint },
    }))
    return { nodes, edges }
  }

  if (element.kind === 'flowchart') {
    const nodes: BoardNode[] = element.nodes.map((n) => ({
      id: n.id,
      type: RF_NODE_TYPES.flowchartNode,
      position: { x: element.x + n.x, y: element.y + n.y },
      data: { kind: 'flowchart-node', groupId: element.id, nodeKind: n.kind, text: n.text, sourceNodeId: element.sourceNodeId },
    }))
    const edges: BoardEdge[] = element.edges.map((e) => ({
      id: e.id,
      type: RF_EDGE_TYPES.flowEdge,
      source: e.from,
      target: e.to,
      data: { groupId: element.id, label: e.label },
    }))
    return { nodes, edges }
  }

  if (element.kind === 'decision-table') {
    return {
      nodes: [{
        id: element.id,
        type: RF_NODE_TYPES.decisionTable,
        position: { x: element.x, y: element.y },
        data: {
          kind: 'decision-table',
          conditions: element.conditions,
          actions: element.actions,
          rules: element.rules,
          sourceNodeId: element.sourceNodeId,
        },
      }],
      edges: [],
    }
  }

  if (element.kind === 'orthogonal') {
    return {
      nodes: [{
        id: element.id,
        type: RF_NODE_TYPES.orthogonal,
        position: { x: element.x, y: element.y },
        data: {
          kind: 'orthogonal',
          factors: element.factors,
          arrayName: element.arrayName,
          rows: element.rows,
          sourceNodeId: element.sourceNodeId,
        },
      }],
      edges: [],
    }
  }

  // mindmap-ref：树由画布 context 提供，data 只持选中态
  return {
    nodes: [{
      id: element.id,
      type: RF_NODE_TYPES.mindmapRef,
      position: { x: element.x, y: element.y },
      data: { kind: 'mindmap-ref', selectedNodeId: element.selectedNodeId },
    }],
    edges: [],
  }
}

/** 整板转换（用于旧测试夹具等一次性迁移场景） */
export function boardToRf(board: Board): BoardGraph {
  const out = emptyGraph()
  for (const el of board.elements) {
    const g = elementToRf(el)
    out.nodes.push(...g.nodes)
    out.edges.push(...g.edges)
  }
  return out
}

/** AI 草稿 → RF 图（经 draftToElement 校验后转换，落位由 draftToElement 负责） */
export function draftToRfGraph(
  draft: unknown,
  chartKind: BoardChartKind,
  sourceNodeId: string | null,
  board: Board,
): BoardGraph {
  return elementToRf(draftToElement(draft, chartKind, sourceNodeId, board))
}

/** 需求树参考节点（空板自动占位） */
export function buildMindmapRefNode(_tree: RequirementNode, x = 40, y = 40): BoardNode {
  return {
    id: generateId(),
    type: RF_NODE_TYPES.mindmapRef,
    position: { x, y },
    data: { kind: 'mindmap-ref', selectedNodeId: null },
  }
}

/** AI 生成占位节点（会话态） */
export function createPendingNode(chartKind: BoardChartKind, sourceNodeId: string | null): BoardNode {
  return {
    id: generateId(),
    type: RF_NODE_TYPES.chartPending,
    position: { x: 40, y: 40 },
    data: { kind: 'chart-pending', chartKind, sourceNodeId },
  }
}

/** 把占位节点标记为错误态（不可变更新） */
export function markPendingNodeError(node: BoardNode, message: string): BoardNode {
  if (node.data.kind !== 'chart-pending') return node
  return { ...node, data: { ...node.data, error: message } }
}

/** 从 RF 图按 groupId 重建因果图语义图元（derive 输入） */
export function reconstructCauseEffectElement(graph: BoardGraph, groupId: string): CauseEffectElement | null {
  const members = graph.nodes.filter((n) => n.data.kind === 'ce-node' && n.data.groupId === groupId)
  if (members.length === 0) return null
  const minX = Math.min(...members.map((n) => n.position.x))
  const minY = Math.min(...members.map((n) => n.position.y))
  const memberIds = new Set(members.map((n) => n.id))
  const first = members[0].data
  return {
    id: groupId,
    kind: 'cause-effect',
    x: minX,
    y: minY,
    w: Math.max(...members.map((n) => n.position.x)) - minX + 160,
    h: Math.max(...members.map((n) => n.position.y)) - minY + 40,
    sourceNodeId: first.kind === 'ce-node' ? first.sourceNodeId : null,
    nodes: members.map((n) => {
      const d = n.data as Extract<typeof n.data, { kind: 'ce-node' }>
      return { id: n.id, role: d.role, text: d.text, x: n.position.x - minX, y: n.position.y - minY }
    }),
    edges: graph.edges
      .filter((e) => e.data?.groupId === groupId && memberIds.has(e.source) && memberIds.has(e.target))
      .map((e) => ({ id: e.id, from: e.source, to: e.target, constraint: e.data?.constraint ?? 'identity' })),
  }
}

/** RF 节点 → 判定表语义图元（handoff / 重新生成正交表输入） */
export function nodeToDecisionTableElement(node: BoardNode): DecisionTableElement | null {
  if (node.data.kind !== 'decision-table') return null
  const d = node.data
  return {
    id: node.id,
    kind: 'decision-table',
    x: node.position.x,
    y: node.position.y,
    w: 400,
    h: 200,
    sourceNodeId: d.sourceNodeId,
    conditions: d.conditions,
    actions: d.actions,
    rules: d.rules,
  }
}

/** RF 节点 → 正交表语义图元（handoff 输入） */
export function nodeToOrthogonalElement(node: BoardNode): OrthogonalElement | null {
  if (node.data.kind !== 'orthogonal') return null
  const d = node.data
  return {
    id: node.id,
    kind: 'orthogonal',
    x: node.position.x,
    y: node.position.y,
    w: 400,
    h: 240,
    sourceNodeId: d.sourceNodeId,
    factors: d.factors,
    arrayName: d.arrayName,
    rows: d.rows,
  }
}

/** 统计画板图元数（组算一个），供上限检查 */
export function countElements(graph: BoardGraph): number {
  const groups = new Set<string>()
  let singles = 0
  for (const n of graph.nodes) {
    const d = n.data
    if (d.kind === 'ce-node' || d.kind === 'flowchart-node') {
      groups.add(d.groupId)
    } else {
      singles += 1
    }
  }
  return groups.size + singles
}

export { RF_NODE_TYPES }
