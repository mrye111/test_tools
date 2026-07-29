/** 白板视口与坐标换算（BoardCanvas 命中检测/渲染器消费） */

export const BOARD_ZOOM_MIN = 0.1
export const BOARD_ZOOM_MAX = 8

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** 世界坐标 → 屏幕坐标：screen = world * zoom - vp.{x,y} */
export function worldToScreen(vp: Viewport, wx: number, wy: number): { x: number; y: number } {
  return {
    x: wx * vp.zoom - vp.x,
    y: wy * vp.zoom - vp.y,
  }
}

/** 屏幕坐标 → 世界坐标：world = (screen + vp.{x,y}) / zoom */
export function screenToWorld(vp: Viewport, sx: number, sy: number): { x: number; y: number } {
  return {
    x: (sx + vp.x) / vp.zoom,
    y: (sy + vp.y) / vp.zoom,
  }
}

/** 将 zoom 限制在 [BOARD_ZOOM_MIN, BOARD_ZOOM_MAX]；非法/非正数回退 1 */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom) || zoom <= 0) {
    return 1
  }
  return Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, zoom))
}

/**
 * 以屏幕坐标 (sx, sy) 为锚点缩放，保持锚点对应的世界坐标不变。
 * 先求锚点世界坐标，再按新 zoom 反推 vp 原点。
 */
export function zoomAt(vp: Viewport, sx: number, sy: number, factor: number): Viewport {
  const anchorWorld = screenToWorld(vp, sx, sy)
  const newZoom = clampZoom(vp.zoom * factor)
  return {
    x: anchorWorld.x * newZoom - sx,
    y: anchorWorld.y * newZoom - sy,
    zoom: newZoom,
  }
}

/**
 * 让包围盒在视口内完整可见并居中。
 * zoom = min((viewportW - 2p) / w, (viewportH - 2p) / h) 后夹取；
 * 原点使 bounds 中心与视口中心对齐。
 */
export function fitBounds(
  bounds: { x: number; y: number; w: number; h: number },
  viewportW: number,
  viewportH: number,
  padding = 0
): Viewport {
  if (bounds.w <= 0 || bounds.h <= 0) {
    return { x: bounds.x, y: bounds.y, zoom: 1 }
  }

  const availableW = viewportW - 2 * padding
  const availableH = viewportH - 2 * padding
  const scaleW = availableW / bounds.w
  const scaleH = availableH / bounds.h
  const zoom = clampZoom(Math.min(scaleW, scaleH))

  const boundsCenterX = bounds.x + bounds.w / 2
  const boundsCenterY = bounds.y + bounds.h / 2
  const viewportCenterX = viewportW / 2
  const viewportCenterY = viewportH / 2

  return {
    x: boundsCenterX * zoom - viewportCenterX,
    y: boundsCenterY * zoom - viewportCenterY,
    zoom,
  }
}
