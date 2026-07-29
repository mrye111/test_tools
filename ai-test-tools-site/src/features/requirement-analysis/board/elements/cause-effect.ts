import type { Viewport } from '../viewport'
import type { CauseEffectElement, CauseEffectNode, CauseEffectEdge, CauseEffectConstraint } from '../types'
import { CE_NODE_H, CE_NODE_W } from '../types'

// 设计令牌近似色值
const ACCENT = '#3b82f6'
const BORDER = '#e2e8f0'
const SURFACE = '#ffffff'
const SURFACE_MUTED = '#e2e8f0'
const TEXT = '#1e293b'
const CAUSE_BORDER = '#3b82f6'
const EFFECT_BORDER = '#ef4444'
const EDGE_STROKE = '#94a3b8'

export function drawCauseEffect(
  ctx: CanvasRenderingContext2D,
  el: CauseEffectElement,
  _vp: Viewport,
  selected: boolean
): void {
  ctx.save()
  ctx.translate(el.x, el.y)

  // 背景卡片
  ctx.fillStyle = SURFACE
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
  roundRect(ctx, 0, 0, el.w, el.h, 12)
  ctx.fill()
  ctx.shadowColor = 'transparent'

  ctx.strokeStyle = BORDER
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

  drawSelectionOutline(ctx, el.w, el.h, selected)
  ctx.restore()
}

function drawNode(ctx: CanvasRenderingContext2D, node: CauseEffectNode): void {
  const w = CE_NODE_W
  const h = CE_NODE_H
  const x = node.x - w / 2
  const y = node.y - h / 2

  if (node.role === 'cause') {
    ctx.fillStyle = SURFACE
    ctx.strokeStyle = CAUSE_BORDER
  } else if (node.role === 'intermediate') {
    ctx.fillStyle = SURFACE_MUTED
    ctx.strokeStyle = BORDER
  } else {
    ctx.fillStyle = SURFACE
    ctx.strokeStyle = EFFECT_BORDER
  }

  ctx.lineWidth = node.role === 'cause' || node.role === 'effect' ? 2 : 1
  roundRect(ctx, x, y, w, h, 8)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = TEXT
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
  const dx = to.x - from.x
  const dy = to.y - from.y
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2

  // 折线：从起点水平到中间，再垂直/水平到终点（简化曼哈顿路由）
  ctx.strokeStyle = EDGE_STROKE
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
  ctx.fillStyle = EDGE_STROKE
  ctx.fill()
}

function drawConstraintSymbol(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  constraint: CauseEffectConstraint
): void {
  ctx.fillStyle = '#475569'
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const symbol = constraint === 'and' ? '∧' : constraint === 'or' ? '∨' : '¬'
  ctx.fillText(symbol, x, y)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let i = text.length
  while (i > 0) {
    const candidate = `${text.slice(0, i)}…`
    if (ctx.measureText(candidate).width <= maxW) return candidate
    i -= 1
  }
  return '…'
}

function drawSelectionOutline(ctx: CanvasRenderingContext2D, w: number, h: number, selected: boolean): void {
  if (!selected) return
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 2
  roundRect(ctx, -2, -2, w + 4, h + 4, 14)
  ctx.stroke()
}

export { roundRect, truncate }
