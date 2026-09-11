/** 画板缩放条常量与格式化（旧 viewport.ts 退役后仅存部分；坐标换算由 React Flow 接管） */

export const BOARD_ZOOM_MIN = 0.1
export const BOARD_ZOOM_MAX = 8
export const BOARD_ZOOM_STEP = 1.2

/** 将 zoom 限制在 [BOARD_ZOOM_MIN, BOARD_ZOOM_MAX]；非法/非正数回退 1 */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom) || zoom <= 0) {
    return 1
  }
  return Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, zoom))
}

/** 按方向步进一档 zoom；超出边界时停在边界值。 */
export function stepZoom(zoom: number, direction: 'in' | 'out'): number {
  const current = clampZoom(zoom)
  return clampZoom(direction === 'in' ? current * BOARD_ZOOM_STEP : current / BOARD_ZOOM_STEP)
}

/** zoom → 百分比文案（如 1 → "100%"、1.44 → "144%"）；非法输入按基线 100% 显示。 */
export function formatZoom(zoom: number): string {
  const value = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return `${Math.round(value * 100)}%`
}
