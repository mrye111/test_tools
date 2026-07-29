import { describe, expect, it } from 'vitest'
import { deriveDecisionTable, mergeEquivalentRules, selectOrthogonalArray } from './derive'
import type { CauseEffectElement, DecisionTableElement } from './types'

describe('selectOrthogonalArray', () => {
  it('2 因子各 2 水平 → L4 全组合（4 行）', () => {
    const result = selectOrthogonalArray([
      { name: '渠道', levels: ['短信', '邮件'] },
      { name: '定时', levels: ['是', '否'] },
    ])
    expect('name' in result && result.name).toContain('L4')
    expect('rows' in result && result.rows).toHaveLength(4)
  })

  it('3 因子各 3 水平 → L9（9 行，每对因子水平组合至少出现一次）', () => {
    const factors = [
      { name: 'A', levels: ['1', '2', '3'] },
      { name: 'B', levels: ['x', 'y', 'z'] },
      { name: 'C', levels: ['p', 'q', 'r'] },
    ]
    const result = selectOrthogonalArray(factors)
    if (!('rows' in result)) throw new Error('应产出阵列')
    expect(result.rows).toHaveLength(9)
    // 两两覆盖校验：任意两列的 (水平, 水平) 组合全集 ⊆ 行集合
    const pairs = new Set(result.rows.map((row) => `${row[0]}|${row[1]}`))
    expect(pairs.size).toBe(9)
  })

  it('超出支持范围返回错误', () => {
    const result = selectOrthogonalArray([
      { name: 'A', levels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'] },
    ])
    expect('error' in result).toBe(true)
  })
})

const ceBase: CauseEffectElement = {
  id: 'ce1', kind: 'cause-effect', x: 0, y: 0, w: 600, h: 400, sourceNodeId: 'n1',
  nodes: [
    { id: 'c1', role: 'cause', text: '字数≤210', x: 0, y: 0 },
    { id: 'c2', role: 'cause', text: '含变量', x: 0, y: 100 },
    { id: 'e1', role: 'effect', text: '按长短信拆分计费', x: 300, y: 50 },
  ],
  edges: [
    { id: 'edge1', from: 'c1', to: 'e1', constraint: 'and' },
    { id: 'edge2', from: 'c2', to: 'e1', constraint: 'and' },
  ],
}

describe('deriveDecisionTable', () => {
  it('and 约束：仅全真时动作发生（规则列枚举原因组合）', () => {
    const result = deriveDecisionTable(ceBase)
    if ('error' in result) throw new Error(result.error)
    expect(result.conditions).toEqual(['字数≤210', '含变量'])
    expect(result.actions).toEqual(['按长短信拆分计费'])
    // and：全 Y 动作 true，其余组合动作 false；规则列覆盖 2^2 枚举
    expect(result.rules).toHaveLength(4)
    const full = result.rules.find((r) => r.conditionValues.every((v) => v === 'Y'))
    expect(full?.actionValues).toEqual([true])
  })

  it('无结果节点返回错误', () => {
    const noEffect: CauseEffectElement = { ...ceBase, nodes: ceBase.nodes.filter((n) => n.role !== 'effect') }
    expect('error' in deriveDecisionTable(noEffect)).toBe(true)
  })

  it('原因链成环返回错误', () => {
    const cyclic: CauseEffectElement = {
      ...ceBase,
      edges: [...ceBase.edges, { id: 'edge3', from: 'e1', to: 'c1', constraint: 'identity' }],
    }
    expect('error' in deriveDecisionTable(cyclic)).toBe(true)
  })
})

describe('mergeEquivalentRules', () => {
  it('条件与动作完全相同的规则列合并为一列', () => {
    const table: DecisionTableElement = {
      id: 'dt1', kind: 'decision-table', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
      conditions: ['A'], actions: ['X'],
      rules: [
        { conditionValues: ['Y'], actionValues: [true] },
        { conditionValues: ['Y'], actionValues: [true] },
        { conditionValues: ['N'], actionValues: [false] },
      ],
    }
    expect(mergeEquivalentRules(table).rules).toHaveLength(2)
  })
})
