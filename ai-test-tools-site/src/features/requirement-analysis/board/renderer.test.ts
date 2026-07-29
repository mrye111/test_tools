import { describe, expect, it, vi } from 'vitest'
import { fitBounds, screenToWorld, worldToScreen } from './viewport'
import { layoutMindmap } from './elements/layout'
import { measureDecisionTable, measureOrthogonal } from './elements/measure'
import { renderBoard } from './renderer'
import type { Board } from './types'

function createMockContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
  } as unknown as CanvasRenderingContext2D
}

describe('layoutMindmap', () => {
  it('按深度分列、父节点纵向居中于子节点', () => {
    const layout = layoutMindmap({
      id: 'r', title: '根', children: [
        { id: 'a', title: 'A', children: [
          { id: 'a1', title: 'A1', children: [] },
          { id: 'a2', title: 'A2', children: [] },
        ] },
        { id: 'b', title: 'B', children: [] },
      ],
    })
    const byId = new Map(layout.map((n) => [n.id, n]))
    expect(byId.get('r')!.x).toBe(0)
    expect(byId.get('a')!.x).toBeGreaterThan(byId.get('r')!.x)
    expect(byId.get('a1')!.x).toBeGreaterThan(byId.get('a')!.x)
    expect(byId.get('a')!.y).toBeCloseTo((byId.get('a1')!.y + byId.get('a2')!.y) / 2)
  })

  it('布局节点包含正确 parentId 以支持连线', () => {
    const layout = layoutMindmap({
      id: 'r', title: '根', children: [
        { id: 'a', title: 'A', children: [
          { id: 'a1', title: 'A1', children: [] },
        ] },
      ],
    })
    const byId = new Map(layout.map((n) => [n.id, n]))
    expect(byId.get('r')!.parentId).toBeNull()
    expect(byId.get('a')!.parentId).toBe('r')
    expect(byId.get('a1')!.parentId).toBe('a')
  })
})

describe('measure', () => {
  it('判定表尺寸 = 行数 × 行高 + 表头，含规则列宽', () => {
    const size = measureDecisionTable({
      id: 'dt', kind: 'decision-table', x: 0, y: 0, w: 0, h: 0, sourceNodeId: null,
      conditions: ['c1', 'c2'], actions: ['a1'],
      rules: [{ conditionValues: ['Y', 'N'], actionValues: [true] }],
    })
    expect(size.h).toBeGreaterThan(0)
    expect(size.w).toBeGreaterThan(0)
  })

  it('正交表尺寸随行列增长', () => {
    const small = measureOrthogonal({
      id: 'o', kind: 'orthogonal', x: 0, y: 0, w: 0, h: 0, sourceNodeId: null,
      factors: [{ name: 'A', levels: ['1', '2'] }], arrayName: 'L4', rows: [['1'], ['2']],
    })
    const big = measureOrthogonal({
      id: 'o', kind: 'orthogonal', x: 0, y: 0, w: 0, h: 0, sourceNodeId: null,
      factors: [{ name: 'A', levels: ['1', '2'] }], arrayName: 'L4',
      rows: [['1'], ['2'], ['1'], ['2'], ['1'], ['2']],
    })
    expect(big.h).toBeGreaterThan(small.h)
  })
})

describe('renderer viewport 互逆', () => {
  it('fitBounds 后的 zoom 下 worldToScreen/screenToWorld 互逆', () => {
    const bounds = { x: 40, y: 40, w: 1000, h: 5960 }
    const vp = fitBounds(bounds, 1454, 934, 40)
    expect(vp.zoom).toBeLessThan(1)

    const wx = 40
    const wy = 40
    const s = worldToScreen(vp, wx, wy)
    const recovered = screenToWorld(vp, s.x, s.y)
    expect(recovered.x).toBeCloseTo(wx, 6)
    expect(recovered.y).toBeCloseTo(wy, 6)
  })

  it('renderBoard setTransform 平移量只乘 dpr，与 worldToScreen 语义一致', () => {
    // 以 dpr=1 创建 canvas 与 mock context，避免 devicePixelRatio 缩放干扰。
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true, configurable: true })

    const canvas = document.createElement('canvas')
    canvas.width = 1454
    canvas.height = 934
    const ctx = createMockContext()
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx)

    const board: Board = { version: 1, elements: [] }
    const vp = { x: 649.6, y: 34.3, zoom: 0.143 }
    renderBoard(canvas, board, vp, new Set())

    const setTransformCalls = ctx.setTransform.mock.calls
    // 第一次是 clearRect 的 identity，第二次是世界坐标变换
    expect(setTransformCalls.length).toBeGreaterThanOrEqual(2)
    const worldTransform = setTransformCalls[1] as [number, number, number, number, number, number]
    expect(worldTransform[0]).toBeCloseTo(vp.zoom, 6)
    expect(worldTransform[3]).toBeCloseTo(vp.zoom, 6)
    expect(worldTransform[4]).toBeCloseTo(-vp.x, 4)
    expect(worldTransform[5]).toBeCloseTo(-vp.y, 4)

    // 验证该变换对应的 css 坐标与 worldToScreen 等价：
    // css = scale * world + translate = world*zoom - vp.x
    const wx = 40
    const wy = 40
    const s = worldToScreen(vp, wx, wy)
    expect(worldTransform[0] * wx + worldTransform[4]).toBeCloseTo(s.x, 4)
    expect(worldTransform[3] * wy + worldTransform[5]).toBeCloseTo(s.y, 4)
  })
})
