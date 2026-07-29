import type { Viewport } from '../viewport'
import type { MindmapRefElement } from '../types'
import type { RequirementNode } from '../../../../lib/requirement-analysis-api'
import { layoutMindmap } from './layout'
import { BOARD_COLORS } from './colors'
import { drawSelectionOutline, roundRect, truncate } from './canvas-utils'

const { accent, border, surface, surfaceMuted, text, textMuted, line } = BOARD_COLORS

export function drawMindmapRef(
  ctx: CanvasRenderingContext2D,
  el: MindmapRefElement,
  tree: RequirementNode,
  _vp: Viewport,
  selected: boolean
): void {
  const nodes = layoutMindmap(tree)
  const selectedId = el.selectedNodeId

  ctx.save()
  ctx.translate(el.x, el.y)

  // 背景
  ctx.fillStyle = selected ? '#eff6ff' : surfaceMuted
  roundRect(ctx, 0, 0, el.w, el.h, 12)
  ctx.fill()

  // 绘制连线（按 parentId 查找父节点）
  ctx.strokeStyle = line
  ctx.lineWidth = 2
  for (const node of nodes) {
    if (node.parentId == null) continue
    const parent = nodes.find((n) => n.id === node.parentId)
    if (!parent) continue
    ctx.beginPath()
    ctx.moveTo(parent.x + 80, parent.y)
    ctx.lineTo(node.x, node.y)
    ctx.stroke()
  }

  // 绘制节点
  for (const node of nodes) {
    const isSelected = selectedId === node.id
    ctx.fillStyle = isSelected ? '#eff6ff' : surface
    ctx.strokeStyle = isSelected ? accent : border
    ctx.lineWidth = isSelected ? 2 : 1
    roundRect(ctx, node.x - 60, node.y - 16, 120, 32, 8)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = text
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(truncate(ctx, node.title, 110), node.x, node.y)
  }

  // 选中图元外描框
  drawSelectionOutline(ctx, el.w, el.h, selected, accent)
  ctx.restore()
}

export { roundRect, truncate }
