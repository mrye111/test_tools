import { describe, expect, it } from 'vitest'
import { layoutMindmap } from './elements/layout'
import { measureDecisionTable, measureOrthogonal } from './elements/measure'

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
