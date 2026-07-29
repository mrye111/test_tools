import type { Viewport } from '../viewport'
import type { CauseEffectElement, CauseEffectNode, CauseEffectConstraint } from '../types'
import { CE_NODE_H, CE_NODE_W } from '../types'
import { BOARD_COLORS } from './colors'
import { drawSelectionOutline, roundRect, truncate } from './canvas-utils'

const {
  accent,
  border,
  surface,
  surfaceMuted2,
  text,
  causeBorder,
  effectBorder,
  edgeStroke,
  symbol,
} = BOARD_COLORS

export function drawCauseEffect(
  ctx: CanvasRenderingContext2D,
  el: CauseEffectElement,
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

  // 边：折线 + 箭头 + 中点约束符号
  for (const edge of el.edges) {
    const from = el.nodes.find((n) => n.id === edge.from)
    const to = el.nodes.find((n) => n.id === edge.to)
    if (!from || !to) continue
    drawEdge(ctx, from, to, edge.constraint)
  }

  // 节点
  for (const node of el.nodes) {
    drawNode(ctx, node)
  }

  drawSelectionOutline(ctx, el.w, el.h, selected, accent)
  ctx.restore()
}

function drawNode(ctx: CanvasRenderingContext2D, node: CauseEffectNode): void {
  const w = CE_NODE_W
  const h = CE_NODE_H
  const x = node.x - w / 2
  const y = node.y - h / 2

  if (node.role === 'cause') {
    ctx.fillStyle = surface
    ctx.strokeStyle = causeBorder
  } else if (node.role === 'intermediate') {
    ctx.fillStyle = surfaceMuted2
    ctx.strokeStyle = border
  } else {
    ctx.fillStyle = surface
    ctx.strokeStyle = effectBorder
  }

  ctx.lineWidth = node.role === 'cause' || node.role === 'effect' ? 2 : 1
  roundRect(ctx, x, y, w, h, 8)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = text
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(truncate(ctx, node.text, w - 16), node.x, node.y)
}

function drawEdge(
  ctx: CanvasRenderingContext2D,
  from: CauseEffectNode,
  to: CauseEffectNode,
  constraint: CauseEffectConstraint
): void {
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2

  // 折线：从起点水平到中间，再垂直/水平到终点（简化曼哈顿路由）
  ctx.strokeStyle = edgeStroke
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(midX, from.y)
  ctx.lineTo(midX, to.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()

  // 末端箭头
  drawArrow(ctx, midX, to.y, to.x, to.y)

  // 中点约束符号
  if (constraint !== 'identity') {
    drawConstraintSymbol(ctx, midX, midY, constraint)
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

function drawConstraintSymbol(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  constraint: CauseEffectConstraint
): void {
  ctx.fillStyle = symbol
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const symbolText = constraint === 'and' ? '∧' : constraint === 'or' ? '∨' : '¬'
  ctx.fillText(symbolText, x, y)
}

export { roundRect, truncate }
