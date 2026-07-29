import type { Board, BoardElement, MindmapRefElement, CauseEffectElement, DecisionTableElement, OrthogonalElement } from './types'
import type { Viewport } from './viewport'
import { drawMindmapRef } from './elements/mindmap-ref'
import { drawCauseEffect } from './elements/cause-effect'
import { drawDecisionTable } from './elements/decision-table'
import { drawOrthogonal } from './elements/orthogonal'

/**
 * 渲染白板到 Canvas。
 * 按上游视口语义：screen = world * zoom - vp，等价于
 * setTransform(dpr*zoom, 0, 0, dpr*zoom, -vp.x*dpr*zoom, -vp.y*dpr*zoom)。
 */
export function renderBoard(
  canvas: HTMLCanvasElement,
  board: Board,
  vp: Viewport,
  selection: ReadonlySet<string>
): void {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight

  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.save()

  // 清除整屏
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 设置世界坐标变换
  ctx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, -vp.x * dpr * vp.zoom, -vp.y * dpr * vp.zoom)

  // 逐图元绘制
  for (const el of board.elements) {
    drawElement(ctx, el, vp, selection.has(el.id))
  }

  ctx.restore()
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  vp: Viewport,
  selected: boolean
): void {
  switch (el.kind) {
    case 'mindmap-ref':
      drawMindmapRef(ctx, el as MindmapRefElement, vp, selected)
      break
    case 'cause-effect':
      drawCauseEffect(ctx, el as CauseEffectElement, vp, selected)
      break
    case 'decision-table':
      drawDecisionTable(ctx, el as DecisionTableElement, vp, selected)
      break
    case 'orthogonal':
      drawOrthogonal(ctx, el as OrthogonalElement, vp, selected)
      break
  }
}
