import { describe, expect, it } from 'vitest'
import {
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  CANVAS_ZOOM_STEP,
  clampCanvasZoom,
  formatCanvasZoom,
  stepCanvasZoom,
} from './canvas-zoom'

describe('clampCanvasZoom', () => {
  it('合法值原样返回', () => {
    expect(clampCanvasZoom(1)).toBe(1)
    expect(clampCanvasZoom(2.5)).toBe(2.5)
  })

  it('超出边界时夹取到边界', () => {
    expect(clampCanvasZoom(0.0001)).toBe(CANVAS_ZOOM_MIN)
    expect(clampCanvasZoom(999)).toBe(CANVAS_ZOOM_MAX)
  })

  it('非法输入回退到基线 1', () => {
    expect(clampCanvasZoom(NaN)).toBe(1)
    expect(clampCanvasZoom(0)).toBe(1)
    expect(clampCanvasZoom(-3)).toBe(1)
    expect(clampCanvasZoom(Infinity)).toBe(1)
  })
})

describe('stepCanvasZoom', () => {
  it('放大按 CANVAS_ZOOM_STEP 倍率步进', () => {
    expect(stepCanvasZoom(1, 'in')).toBeCloseTo(CANVAS_ZOOM_STEP)
    expect(stepCanvasZoom(CANVAS_ZOOM_STEP, 'in')).toBeCloseTo(CANVAS_ZOOM_STEP ** 2)
  })

  it('缩小按 1/CANVAS_ZOOM_STEP 步进', () => {
    expect(stepCanvasZoom(1, 'out')).toBeCloseTo(1 / CANVAS_ZOOM_STEP)
  })

  it('连续放大后缩小能回到基线', () => {
    const zoomed = stepCanvasZoom(stepCanvasZoom(1, 'in'), 'out')
    expect(zoomed).toBeCloseTo(1)
  })

  it('到达上限后继续放大停在上限', () => {
    expect(stepCanvasZoom(CANVAS_ZOOM_MAX, 'in')).toBe(CANVAS_ZOOM_MAX)
    expect(stepCanvasZoom(CANVAS_ZOOM_MAX - 0.01, 'in')).toBe(CANVAS_ZOOM_MAX)
  })

  it('到达下限后继续缩小停在下限', () => {
    expect(stepCanvasZoom(CANVAS_ZOOM_MIN, 'out')).toBe(CANVAS_ZOOM_MIN)
    expect(stepCanvasZoom(CANVAS_ZOOM_MIN + 0.001, 'out')).toBe(CANVAS_ZOOM_MIN)
  })

  it('非法输入先回退基线再步进', () => {
    expect(stepCanvasZoom(NaN, 'in')).toBeCloseTo(CANVAS_ZOOM_STEP)
    expect(stepCanvasZoom(0, 'out')).toBeCloseTo(1 / CANVAS_ZOOM_STEP)
  })
})

describe('formatCanvasZoom', () => {
  it('基线显示 100%', () => {
    expect(formatCanvasZoom(1)).toBe('100%')
  })

  it('按比例取整显示', () => {
    expect(formatCanvasZoom(1.44)).toBe('144%')
    expect(formatCanvasZoom(0.693)).toBe('69%')
  })

  it('非法输入显示 100%', () => {
    expect(formatCanvasZoom(NaN)).toBe('100%')
    expect(formatCanvasZoom(-1)).toBe('100%')
  })
})
