import { describe, expect, it } from 'vitest'
import { clampZoom, fitBounds, screenToWorld, worldToScreen, zoomAt, BOARD_ZOOM_MIN, BOARD_ZOOM_MAX } from './viewport'

describe('viewport', () => {
  it('世界↔屏幕坐标换算互逆', () => {
    const vp = { x: 100, y: 50, zoom: 2 }
    const s = worldToScreen(vp, 300, 200)
    expect(s).toEqual({ x: 500, y: 350 })
    expect(screenToWorld(vp, s.x, s.y)).toEqual({ x: 300, y: 200 })
  })

  it('zoomAt 以屏幕锚点缩放：锚点对应的世界点不动', () => {
    const vp = { x: 0, y: 0, zoom: 1 }
    const anchor = { sx: 200, sy: 150 }
    const before = screenToWorld(vp, anchor.sx, anchor.sy)
    const next = zoomAt(vp, anchor.sx, anchor.sy, 1.5)
    const after = screenToWorld(next, anchor.sx, anchor.sy)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(next.zoom).toBeCloseTo(1.5)
  })

  it('clampZoom 夹取边界，非法值回退 1', () => {
    expect(clampZoom(0)).toBe(1)
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(0.0001)).toBe(BOARD_ZOOM_MIN)
    expect(clampZoom(1000)).toBe(BOARD_ZOOM_MAX)
  })

  it('fitBounds 让包围盒完整可见并居中（含 padding）', () => {
    const vp = fitBounds({ x: 0, y: 0, w: 1000, h: 500 }, 1200, 800, 40)
    // 可用 1120×720，缩放 = min(1120/1000, 720/500) = 1.12
    expect(vp.zoom).toBeCloseTo(1.12)
    const center = worldToScreen(vp, 500, 250)
    expect(center.x).toBeCloseTo(600)
    expect(center.y).toBeCloseTo(400)
  })

  it('fitBounds 空/零尺寸包围盒回退 zoom 1', () => {
    const vp = fitBounds({ x: 0, y: 0, w: 0, h: 0 }, 1200, 800)
    expect(vp.zoom).toBe(1)
  })
})
