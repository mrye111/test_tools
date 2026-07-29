import type { Viewport } from '../viewport'
import type { OrthogonalElement } from '../types'
import { measureOrthogonal } from './measure'
import { BOARD_COLORS } from './colors'
import { drawSelectionOutline, roundRect, truncate } from './canvas-utils'

const { accent, border, surface, headerBg, text, textMuted } = BOARD_COLORS

const ROW_HEIGHT = 28
const CHAR_WIDTH = 8
const MAX_COL_WIDTH = 240
const PADDING = 20

export function drawOrthogonal(
  ctx: CanvasRenderingContext2D,
  el: OrthogonalElement,
  _vp: Viewport,
  selected: boolean
): void {
  const measured = measureOrthogonal(el)
  const w = Math.max(el.w, measured.w)
  const h = measured.h

  ctx.save()
  ctx.translate(el.x, el.y)

  // 背景卡片
  ctx.fillStyle = surface
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
  roundRect(ctx, 0, 0, w, h, 12)
  ctx.fill()
  ctx.shadowColor = 'transparent'

  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.stroke()

  // 列宽
  const nameColWidth = Math.max(80, el.arrayName.length * CHAR_WIDTH)
  const colWidths = el.factors.map((factor) => {
    const levelWidths = factor.levels.map((level) => level.length * CHAR_WIDTH)
    return Math.min(Math.max(factor.name.length * CHAR_WIDTH, ...levelWidths), MAX_COL_WIDTH)
  })

  // 表头
  ctx.fillStyle = headerBg
  ctx.fillRect(0, 0, nameColWidth, ROW_HEIGHT)
  ctx.fillStyle = textMuted
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(el.arrayName, nameColWidth / 2, ROW_HEIGHT / 2)

  let x = nameColWidth
  for (const factor of el.factors) {
    ctx.fillStyle = headerBg
    ctx.fillRect(x, 0, colWidths[el.factors.indexOf(factor)], ROW_HEIGHT)
    ctx.fillStyle = textMuted
    ctx.fillText(factor.name, x + colWidths[el.factors.indexOf(factor)] / 2, ROW_HEIGHT / 2)
    x += colWidths[el.factors.indexOf(factor)]
  }

  // 数据行
  el.rows.forEach((row, rowIndex) => {
    const y = (1 + rowIndex) * ROW_HEIGHT
    x = 0
    drawCell(ctx, x, y, nameColWidth, ROW_HEIGHT, `${rowIndex + 1}`, 'center')
    x += nameColWidth
    row.forEach((value, colIndex) => {
      drawCell(ctx, x, y, colWidths[colIndex], ROW_HEIGHT, value, 'center')
      x += colWidths[colIndex]
    })
  })

  // 网格线
  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= 1 + el.rows.length; i++) {
    const y = i * ROW_HEIGHT
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  x = 0
  ctx.moveTo(x, 0)
  ctx.lineTo(x, h)
  x += nameColWidth
  ctx.moveTo(x, 0)
  ctx.lineTo(x, h)
  for (const width of colWidths) {
    x += width
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  ctx.stroke()

  drawSelectionOutline(ctx, w, h, selected, accent)
  ctx.restore()
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  align: 'left' | 'center'
): void {
  ctx.fillStyle = text
  ctx.font = '12px sans-serif'
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  const maxW = w - 10
  const display = align === 'left' ? truncate(ctx, text, maxW - 6) : truncate(ctx, text, maxW)
  const tx = align === 'left' ? x + 8 : x + w / 2
  ctx.fillText(display, tx, y + h / 2)
}

export { roundRect, truncate }
