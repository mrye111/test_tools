import type { Viewport } from '../viewport'
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
  flowchartEnd,
  flowchartProcess,
  flowchartDecision,
} = BOARD_COLORS

export function drawFlowchart(
  ctx: CanvasRenderingContext2D,
  el: FlowchartElement,
  _vp: Viewport,
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
      return { fill: flowchartStart, stroke: '#22c55e' }
    case 'end':
      return { fill: flowchartEnd, stroke: '#ef4444' }
    case 'process':
      return { fill: flowchartProcess, stroke: '#3b82f6' }
    case 'decision':
      return { fill: flowchartDecision, stroke: '#f97316' }
  }
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

function drawEdge(
  ctx: CanvasRenderingContext2D,
  from: FlowchartNode,
  to: FlowchartNode,
  label?: string
): void {
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2

  ctx.strokeStyle = edgeStroke
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(midX, from.y)
  ctx.lineTo(midX, to.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()

  drawArrow(ctx, midX, to.y, to.x, to.y)

  if (label) {
    ctx.fillStyle = text
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, midX, midY - 6)
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

export { roundRect, truncate }
