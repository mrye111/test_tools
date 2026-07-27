/**
 * 图表画布缩放计算（纯函数，便于单测）。
 * 缩放比以"适应屏幕"状态为基线 1（即 100%），工具栏按固定倍率步进。
 */

/** 工具栏单次步进倍率：放大 ×1.2，缩小 ÷1.2。 */
export const CANVAS_ZOOM_STEP = 1.2
/** 缩放比下限（相对适应屏幕基线）。 */
export const CANVAS_ZOOM_MIN = 0.1
/** 缩放比上限（相对适应屏幕基线）。 */
export const CANVAS_ZOOM_MAX = 8

/** 非法输入（NaN / 非正 / Infinity）回退到基线 1，再夹取到 [CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX]。 */
export function clampCanvasZoom(ratio: number): number {
  const value = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  return Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, value))
}

/** 按方向步进一档缩放比；超出边界时停在边界值。 */
export function stepCanvasZoom(ratio: number, direction: 'in' | 'out'): number {
  const current = clampCanvasZoom(ratio)
  return clampCanvasZoom(direction === 'in' ? current * CANVAS_ZOOM_STEP : current / CANVAS_ZOOM_STEP)
}

/** 缩放比 → 百分比文案（如 1 → "100%"、1.44 → "144%"）；非法输入按基线 100% 显示。 */
export function formatCanvasZoom(ratio: number): string {
  const value = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  return `${Math.round(value * 100)}%`
}
