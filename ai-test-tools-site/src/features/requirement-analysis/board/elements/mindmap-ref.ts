import type { Viewport } from '../viewport'
import type { MindmapRefElement } from '../types'
import { layoutMindmap } from './layout'

// 设计令牌近似色值（与项目 CSS 变量 --color-accent、--color-border 对齐）
const ACCENT = '#3b82f6'
const BORDER = '#e2e8f0'
const SURFACE = '#ffffff'
const SURFACE_MUTED = '#f1f5f9'
const TEXT = '#1e293b'
const TEXT_MUTED = '#64748b'
const LINE = '#cbd5e1'

export function drawMindmapRef(
  ctx: CanvasRenderingContext2D,
  el: MindmapRefElement,
  _vp: Viewport,
  selected: boolean
): void {
  const tree = { id: el.id, title: '需求树', children: [] }
  const nodes = layoutMindmap(tree)
  const selectedId = el.selectedNodeId

  ctx.save()
  ctx.translate(el.x, el.y)

  // 背景
  ctx.fillStyle = selected ? '#eff6ff' : SURFACE_MUTED
  roundRect(ctx, 0, 0, el.w, el.h, 12)
  ctx.fill()

  // 绘制连线（按深度父子关系，简化：连接相邻深度节点）
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i]
    const parent = nodes.find((n) => n.depth === node.depth - 1 && n.y === node.y)
    if (!parent) continue
    ctx.beginPath()
    ctx.moveTo(parent.x + 80, parent.y)
    ctx.lineTo(node.x, node.y)
    ctx.stroke()
  }

  // 绘制节点
  for (const node of nodes) {
    const isSelected = selectedId === node.id
    ctx.fillStyle = isSelected ? '#eff6ff' : SURFACE
    ctx.strokeStyle = isSelected ? ACCENT : BORDER
    ctx.lineWidth = isSelected ? 2 : 1
    roundRect(ctx, node.x - 60, node.y - 16, 120, 32, 8)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = TEXT
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(truncate(ctx, node.title, 110), node.x, node.y)
  }

  // 选中图元外描框
  drawSelectionOutline(ctx, el.w, el.h, selected)
  ctx.restore()
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
