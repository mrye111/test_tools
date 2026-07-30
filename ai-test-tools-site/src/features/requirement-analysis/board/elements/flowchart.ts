import type { FlowchartElement, FlowchartNode, FlowchartNodeKind } from '../types'
import { CE_NODE_H, CE_NODE_W } from '../types'
import { BOARD_COLORS } from './colors'
import { drawSelectionOutline, roundRect, truncate } from './canvas-utils'

const {
  accent,
  border,
  surface,
  text,
  edgeStroke,
  flowchartStart,
  flowchartStartBorder,
  flowchartEnd,
  flowchartEndBorder,
  flowchartProcess,
  flowchartProcessBorder,
  flowchartDecision,
  flowchartDecisionBorder,
} = BOARD_COLORS

export function drawFlowchart(
  ctx: CanvasRenderingContext2D,
  el: FlowchartElement,
  selected: boolean
): void {
  ctx.save()
  ctx.translate(el.x, el.y)

  // 背景卡片
  ctx.fillStyle = surface
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
  roundRect(ctx, 0, 0, el.w, el.h, 12)
  ctx.fill()
  ctx.shadowColor = 'transparent'

  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.stroke()

  // 边：折线 + 箭头 + 中点 label
  for (const edge of el.edges) {
    const from = el.nodes.find((n) => n.id === edge.from)
    const to = el.nodes.find((n) => n.id === edge.to)
    if (!from || !to) continue
    drawEdge(ctx, from, to, edge.label)
  }

  // 节点
  for (const node of el.nodes) {
    drawNode(ctx, node)
  }

  drawSelectionOutline(ctx, el.w, el.h, selected, accent)
  ctx.restore()
}

function nodeColor(kind: FlowchartNodeKind): { fill: string; stroke: string } {
  switch (kind) {
    case 'start':
      return { fill: flowchartStart, stroke: flowchartStartBorder }
    case 'end':
      return { fill: flowchartEnd, stroke: flowchartEndBorder }
    case 'process':
      return { fill: flowchartProcess, stroke: flowchartProcessBorder }
    case 'decision':
      return { fill: flowchartDecision, stroke: flowchartDecisionBorder }
  }
}

function nodeBounds(node: FlowchartNode): { x: number; y: number; w: number; h: number } {
  return { x: node.x - CE_NODE_W / 2, y: node.y - CE_NODE_H / 2, w: CE_NODE_W, h: CE_NODE_H }
}

function drawNode(ctx: CanvasRenderingContext2D, node: FlowchartNode): void {
  const w = CE_NODE_W
  const h = CE_NODE_H
  const { fill, stroke } = nodeColor(node.kind)

  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2

  if (node.kind === 'decision') {
    // 菱形：中心在 node.x, node.y，外接包围盒 w x h
    ctx.beginPath()
    ctx.moveTo(node.x, node.y - h / 2)
    ctx.lineTo(node.x + w / 2, node.y)
    ctx.lineTo(node.x, node.y + h / 2)
    ctx.lineTo(node.x - w / 2, node.y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else if (node.kind === 'start' || node.kind === 'end') {
    // 体育场形：全圆角胶囊
    roundRect(ctx, node.x - w / 2, node.y - h / 2, w, h, h / 2)
    ctx.fill()
    ctx.stroke()
  } else {
    // 圆角矩形
    roundRect(ctx, node.x - w / 2, node.y - h / 2, w, h, 8)
    ctx.fill()
    ctx.stroke()
  }

  ctx.fillStyle = text
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(truncate(ctx, node.text, w - 16), node.x, node.y)
}

/** 计算从矩形内中心向外射线到 cx,cy 与矩形边界的交点；用于边终点不进入节点内部 */
function rectIntersection(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): { x: number; y: number } {
  const halfW = rw / 2
  const halfH = rh / 2
  const dx = cx - (rx + halfW)
  const dy = cy - (ry + halfH)
  if (dx === 0 && dy === 0) return { x: rx + halfW, y: ry }
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  const scale = absDy === 0 ? halfW / absDx : absDx === 0 ? halfH / absDy : Math.min(halfW / absDx, halfH / absDy)
  return { x: cx - dx * scale, y: cy - dy * scale }
}

function drawEdge(
  ctx: CanvasRenderingContext2D,
  from: FlowchartNode,
  to: FlowchartNode,
  label?: string
): void {
  const fromBounds = nodeBounds(from)
  const toBounds = nodeBounds(to)
  const midX = (from.x + to.x) / 2

  // 折线：从源节点边界出发，水平到 midX，再垂直到目标 y，最后水平到目标节点边界
  const p1 = rectIntersection(from.x, from.y, fromBounds.x, fromBounds.y, fromBounds.w, fromBounds.h)
  const p2 = { x: midX, y: from.y }
  const p3 = { x: midX, y: to.y }
  const p4 = rectIntersection(to.x, to.y, toBounds.x, toBounds.y, toBounds.w, toBounds.h)
  // 当 midX 已经在目标节点范围内时，p4 可能落在左侧/右侧；需要保证最后一段从 p3 到 p4 是水平向目标中心
  p4.y = to.y
  // 修正 p4.x：从目标中心向 p3 方向取边界交点
  if (p3.x <= to.x) {
    p4.x = toBounds.x
  } else {
    p4.x = toBounds.x + toBounds.w
  }

  ctx.strokeStyle = edgeStroke
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.lineTo(p3.x, p3.y)
  ctx.lineTo(p4.x, p4.y)
  ctx.stroke()

  drawArrow(ctx, p3.x, p3.y, p4.x, p4.y)

  if (label) {
    // label 放在实际路径中点（折线总长度中点）
    const segments = [{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }, { x: p3.x, y: p3.y }, { x: p4.x, y: p4.y }]
    const totalLen = segments.slice(1).reduce((sum, seg, i) => {
      const dx = seg.x - segments[i].x
      const dy = seg.y - segments[i].y
      return sum + Math.sqrt(dx * dx + dy * dy)
    }, 0)
    let half = totalLen / 2
    let mid = segments[0]
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i]
      const b = segments[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (half <= len || i === segments.length - 2) {
        const t = half / len || 0
        mid = { x: a.x + dx * t, y: a.y + dy * t }
        break
      }
      half -= len
    }
    ctx.fillStyle = text
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, mid.x, mid.y - 6)
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = 6
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fillStyle = edgeStroke
  ctx.fill()
}
