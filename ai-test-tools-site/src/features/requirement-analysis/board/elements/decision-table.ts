import type { Viewport } from '../viewport'
import type { DecisionTableElement } from '../types'
import { measureDecisionTable } from './measure'
import { BOARD_COLORS } from './colors'
import { drawSelectionOutline, roundRect, truncate } from './canvas-utils'

const { accent, border, surface, headerBg, textMuted } = BOARD_COLORS

const ROW_HEIGHT = 28
const CHAR_WIDTH = 8
const MAX_COL_WIDTH = 240
const STUB_MIN_WIDTH = 140

export function drawDecisionTable(
  ctx: CanvasRenderingContext2D,
  el: DecisionTableElement,
  _vp: Viewport,
  selected: boolean
): void {
  const measured = measureDecisionTable(el)
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

  // 计算各列宽度
  const stubWidth = Math.max(
    STUB_MIN_WIDTH,
    ...[...el.conditions, ...el.actions].map((t) => Math.min(t.length * CHAR_WIDTH, MAX_COL_WIDTH))
  )

  let ruleColWidth = 40
  for (const rule of el.rules) {
    const values = [...rule.conditionValues, ...rule.actionValues.map((v) => (v ? 'Y' : 'N'))]
    for (const value of values) {
      ruleColWidth = Math.max(ruleColWidth, Math.min(value.length * CHAR_WIDTH, MAX_COL_WIDTH))
    }
  }

  // 表头
  ctx.fillStyle = headerBg
  ctx.fillRect(0, 0, stubWidth, ROW_HEIGHT)
  ctx.fillStyle = textMuted
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('规则', stubWidth / 2, ROW_HEIGHT / 2)

  for (let i = 0; i < el.rules.length; i++) {
    ctx.fillStyle = headerBg
    ctx.fillRect(stubWidth + i * ruleColWidth, 0, ruleColWidth, ROW_HEIGHT)
    ctx.fillStyle = textMuted
    ctx.fillText(`${i + 1}`, stubWidth + i * ruleColWidth + ruleColWidth / 2, ROW_HEIGHT / 2)
  }

  // 条件行
  el.conditions.forEach((condition, index) => {
    const y = (1 + index) * ROW_HEIGHT
    drawCell(ctx, 0, y, stubWidth, ROW_HEIGHT, condition, 'left')
    el.rules.forEach((rule, ruleIndex) => {
      drawCell(ctx, stubWidth + ruleIndex * ruleColWidth, y, ruleColWidth, ROW_HEIGHT, rule.conditionValues[index], 'center')
    })
  })

  // 动作行
  el.actions.forEach((action, index) => {
    const y = (1 + el.conditions.length + index) * ROW_HEIGHT
    drawCell(ctx, 0, y, stubWidth, ROW_HEIGHT, action, 'left')
    el.rules.forEach((rule, ruleIndex) => {
      drawCell(ctx, stubWidth + ruleIndex * ruleColWidth, y, ruleColWidth, ROW_HEIGHT, rule.actionValues[index] ? 'Y' : 'N', 'center')
    })
  })

  // 网格线
  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= rowCount(el); i++) {
    const y = i * ROW_HEIGHT
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.moveTo(stubWidth, 0)
  ctx.lineTo(stubWidth, h)
  for (let i = 0; i < el.rules.length; i++) {
    const x = stubWidth + i * ruleColWidth
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  const lastX = stubWidth + el.rules.length * ruleColWidth
  ctx.moveTo(lastX, 0)
  ctx.lineTo(lastX, h)
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

function rowCount(el: DecisionTableElement): number {
  return 1 + el.conditions.length + el.actions.length
}

export { roundRect, truncate }
