import { describe, expect, it } from 'vitest'
import { decisionTableToSkeleton, orthogonalToSkeleton, serializeSkeletons } from './derive'
import type { DecisionTableElement, OrthogonalElement } from './types'

const table: DecisionTableElement = {
  id: 'dt1', kind: 'decision-table', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
  conditions: ['字数≤210', '含变量'],
  actions: ['按长短信拆分计费', '提示拆分规则'],
  rules: [
    { conditionValues: ['Y', 'Y'], actionValues: [true, false] },
    { conditionValues: ['N', '-'], actionValues: [false, false] },
  ],
}

describe('decisionTableToSkeleton', () => {
  it('每列规则 → 一条骨架：Y/N 组合进前置，动作 true 项进预期', () => {
    const skeletons = decisionTableToSkeleton(table)
    expect(skeletons).toHaveLength(2)
    expect(skeletons[0].source).toBe('decision-table')
    expect(skeletons[0].precondition).toContain('字数≤210')
    expect(skeletons[0].precondition).toContain('含变量')
    expect(skeletons[0].steps).toContain('当字数≤210成立')
    expect(skeletons[0].expected).toContain('按长短信拆分计费')
    expect(skeletons[0].expected).not.toContain('提示拆分规则')
  })

  it('无关项（-）不出现在前置条件中，全 false 动作预期为占位文案', () => {
    const skeletons = decisionTableToSkeleton(table)
    expect(skeletons[1].precondition).not.toContain('含变量')
    expect(skeletons[1].expected).toBe('无附加动作发生')
  })
})

const ortho: OrthogonalElement = {
  id: 'o1', kind: 'orthogonal', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
  factors: [{ name: '渠道', levels: ['短信', '邮件'] }, { name: '定时', levels: ['是', '否'] }],
  arrayName: 'L4(2^3)',
  rows: [['短信', '是'], ['邮件', '否']],
}

describe('orthogonalToSkeleton', () => {
  it('每行 → 一条组合骨架（因子=水平 键值对）', () => {
    const skeletons = orthogonalToSkeleton(ortho)
    expect(skeletons).toHaveLength(2)
    expect(skeletons[0].precondition).toContain('渠道=短信')
    expect(skeletons[0].precondition).toContain('定时=是')
    expect(skeletons[0].steps).toContain('按渠道=短信；定时=是组合构造输入')
    expect(skeletons[0].expected).toContain('渠道=短信；定时=是 时行为符合对应规则')
  })
})

describe('serializeSkeletons', () => {
  it('产出含需求标题与骨架条目的 Markdown 文本，并转义单元格中的管道符', () => {
    const text = serializeSkeletons('调研问卷需求', [
      ...decisionTableToSkeleton(table),
      ...orthogonalToSkeleton(ortho),
      {
        source: 'decision-table',
        precondition: 'A | B',
        steps: 'C | D',
        expected: 'E | F',
      },
    ])
    expect(text).toContain('调研问卷需求')
    expect(text).toContain('判定表')
    expect(text).toContain('正交表')
    expect(text).toContain('前置条件')
    expect(text).toContain('预期')
    expect(text).toContain('A \\| B')
    expect(text).toContain('C \\| D')
    expect(text).toContain('E \\| F')
  })
})
