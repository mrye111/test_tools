import { CE_NODE_H, CE_NODE_W, type BoardElement, type CauseEffectElement, type MindmapRefElement } from './types'
import { layoutMindmap } from './elements/layout'
import type { RequirementNode } from '../../../lib/requirement-analysis-api'

const MINDMAP_NODE_W = 120
const MINDMAP_NODE_H = 32

/** 命中结果 */
export type HitResult =
  | { elementId: string; part: 'body' }
  | { elementId: string; part: 'node'; nodeId: string }
  | { elementId: string; part: 'edge'; edgeId: string }

/** 边命中容差（像素） */
export const EDGE_HIT_TOLERANCE = 4

/** 点到线段的距离：投影参数 clamp 到 [0, 1] */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy

  // 退化线段：直接到端点距离
  if (lenSq === 0) {
    const ox = px - x1
    const oy = py - y1
    return Math.sqrt(ox * ox + oy * oy)
  }

  // 投影参数 t clamp 到 [0, 1]
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const projX = x1 + t * dx
  const projY = y1 + t * dy
  const ox = px - projX
  const oy = py - projY
  return Math.sqrt(ox * ox + oy * oy)
}

/** 点 (wx, wy) 是否落在矩形内 */
function inRect(wx: number, wy: number, x: number, y: number, w: number, h: number): boolean {
  return wx >= x && wx <= x + w && wy >= y && wy <= y + h
}

/** 单一图元的命中检测；需求树参考图元需传入 tree 以命中真实节点 */
export function hitTestElement(el: BoardElement, wx: number, wy: number, tree?: RequirementNode): HitResult | null {
  if (el.kind === 'cause-effect') {
    return hitTestCauseEffect(el, wx, wy)
  }

  if (el.kind === 'mindmap-ref') {
    return hitTestMindmapRef(el, wx, wy, tree)
  }

  // 其他图元仅测整体包围盒
  if (inRect(wx, wy, el.x, el.y, el.w, el.h)) {
    return { elementId: el.id, part: 'body' }
  }

  return null
}

/** 需求树参考图元命中：先按节点（z 序倒序取最上层），再整体包围盒 */
function hitTestMindmapRef(el: MindmapRefElement, wx: number, wy: number, tree?: RequirementNode): HitResult | null {
  const effectiveTree: RequirementNode = tree ?? { id: el.id, title: '需求树', children: [] }
  const nodes = layoutMindmap(effectiveTree)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    const nx = el.x + node.x - MINDMAP_NODE_W / 2
    const ny = el.y + node.y - MINDMAP_NODE_H / 2
    if (inRect(wx, wy, nx, ny, MINDMAP_NODE_W, MINDMAP_NODE_H)) {
      return { elementId: el.id, part: 'node', nodeId: node.id }
    }
  }

  if (inRect(wx, wy, el.x, el.y, el.w, el.h)) {
    return { elementId: el.id, part: 'body' }
  }

  return null
}

/** 因果图命中：先节点，再边，最后整体包围盒 */
function hitTestCauseEffect(el: CauseEffectElement, wx: number, wy: number): HitResult | null {
  // 1. 节点：按节点局部包围盒（以节点坐标为中心，宽 CE_NODE_W、高 CE_NODE_H）
  for (const node of el.nodes) {
    const nx = el.x + node.x
    const ny = el.y + node.y
    if (inRect(wx, wy, nx - CE_NODE_W / 2, ny - CE_NODE_H / 2, CE_NODE_W, CE_NODE_H)) {
      return { elementId: el.id, part: 'node', nodeId: node.id }
    }
  }

  // 2. 边：两端节点中心连线，容差 4
  for (const edge of el.edges) {
    const fromNode = el.nodes.find((n) => n.id === edge.from)
    const toNode = el.nodes.find((n) => n.id === edge.to)
    if (!fromNode || !toNode) continue

    const x1 = el.x + fromNode.x
    const y1 = el.y + fromNode.y
    const x2 = el.x + toNode.x
    const y2 = el.y + toNode.y

    if (distToSegment(wx, wy, x1, y1, x2, y2) <= EDGE_HIT_TOLERANCE) {
      return { elementId: el.id, part: 'edge', edgeId: edge.id }
    }
  }

  // 3. 整体包围盒
  if (inRect(wx, wy, el.x, el.y, el.w, el.h)) {
    return { elementId: el.id, part: 'body' }
  }

  return null
}

/** 白板命中：按 z 序倒序遍历，返回首个命中；需求树参考图元需传入 tree */
export function hitTestBoard(elements: BoardElement[], wx: number, wy: number, tree?: RequirementNode): HitResult | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const hit = hitTestElement(elements[i], wx, wy, tree)
    if (hit) return hit
  }
  return null
}
