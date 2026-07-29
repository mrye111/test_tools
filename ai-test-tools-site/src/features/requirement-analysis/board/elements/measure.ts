import type { DecisionTableElement, OrthogonalElement } from '../types'

const ROW_HEIGHT = 28
const CHAR_WIDTH = 8
const MAX_COL_WIDTH = 240
const STUB_MIN_WIDTH = 140
const PADDING = 20

/**
 * 判定表尺寸：表头 + 条件行 + 动作行，每行 28px；
 * 宽度 = 条件/动作桩列 + 规则列（最长文本 × 字宽系数，上限 240）。
 */
export function measureDecisionTable(el: DecisionTableElement): { w: number; h: number } {
  const rowCount = 1 + el.conditions.length + el.actions.length
  const h = rowCount * ROW_HEIGHT

  const stubTexts = [...el.conditions, ...el.actions]
  const stubWidth = Math.max(
    STUB_MIN_WIDTH,
    ...stubTexts.map((text) => Math.min(text.length * CHAR_WIDTH, MAX_COL_WIDTH))
  )

  let ruleColWidth = 0
  for (const rule of el.rules) {
    const values = [...rule.conditionValues, ...rule.actionValues.map((v) => (v ? 'Y' : 'N'))]
    for (const value of values) {
      ruleColWidth = Math.max(ruleColWidth, Math.min(value.length * CHAR_WIDTH, MAX_COL_WIDTH))
    }
  }
  ruleColWidth = Math.max(ruleColWidth, 40)

  const w = stubWidth + Math.max(el.rules.length, 1) * ruleColWidth + PADDING
  return { w, h }
}

/**
 * 正交表尺寸：表头 + 数据行，每行 28px；
 * 宽度 = 名称列 + 各因子列（名称/水平最长文本 × 字宽系数，上限 240）。
 */
export function measureOrthogonal(el: OrthogonalElement): { w: number; h: number } {
  const rowCount = 1 + el.rows.length
  const h = rowCount * ROW_HEIGHT

  const nameColWidth = Math.max(80, el.arrayName.length * CHAR_WIDTH)
  let dataWidth = 0
  for (const factor of el.factors) {
    const levelWidths = factor.levels.map((level) => level.length * CHAR_WIDTH)
    const factorWidth = Math.max(factor.name.length * CHAR_WIDTH, ...levelWidths)
    dataWidth += Math.min(factorWidth, MAX_COL_WIDTH)
  }

  const w = nameColWidth + dataWidth + PADDING
  return { w, h }
}
