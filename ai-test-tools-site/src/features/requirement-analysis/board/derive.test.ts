import { describe, expect, it } from 'vitest'
import { deriveDecisionTable, mergeEquivalentRules, selectOrthogonalArray } from './derive'
import type { CauseEffectElement, DecisionTableElement, OrthogonalFactor } from './types'

function assertRows(result: ReturnType<typeof selectOrthogonalArray>): string[][] {
  if (!('rows' in result)) throw new Error('应产出阵列')
  return result.rows
}

function cartesianProduct<T>(sets: T[][]): T[][] {
  return sets.reduce<T[][]>((acc, set) => acc.flatMap((item) => set.map((s) => [...item, s])), [[]])
}

function assertPairwiseCoverage(factors: OrthogonalFactor[], rows: string[][]) {
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const expected = new Set(cartesianProduct([factors[i].levels, factors[j].levels]).map((p) => p.join('|')))
      const actual = new Set(rows.map((row) => `${row[i]}|${row[j]}`))
      expect(actual).toEqual(expected)
    }
  }
}

describe('selectOrthogonalArray', () => {
  it('L4: 2 因子各 2 水平 → 4 行且两两覆盖完整', () => {
    const factors: OrthogonalFactor[] = [
      { name: 'A', levels: ['A0', 'A1'] },
      { name: 'B', levels: ['B0', 'B1'] },
    ]
    const result = selectOrthogonalArray(factors)
    expect('name' in result && result.name).toContain('L4')
    const rows = assertRows(result)
    expect(rows).toHaveLength(4)
    assertPairwiseCoverage(factors, rows)
  })

  it('L8: 4 个 2 水平因子 → 8 行且两两覆盖完整', () => {
    const factors: OrthogonalFactor[] = [
      { name: 'A', levels: ['A0', 'A1'] },
      { name: 'B', levels: ['B0', 'B1'] },
      { name: 'C', levels: ['C0', 'C1'] },
      { name: 'D', levels: ['D0', 'D1'] },
    ]
    const result = selectOrthogonalArray(factors)
    expect('name' in result && result.name).toContain('L8')
    const rows = assertRows(result)
    expect(rows).toHaveLength(8)
    assertPairwiseCoverage(factors, rows)
  })

  it('L9: 3 因子各 3 水平 → 9 行且两两覆盖完整', () => {
    const factors: OrthogonalFactor[] = [
      { name: 'A', levels: ['1', '2', '3'] },
      { name: 'B', levels: ['x', 'y', 'z'] },
      { name: 'C', levels: ['p', 'q', 'r'] },
    ]
    const result = selectOrthogonalArray(factors)
    expect('name' in result && result.name).toContain('L9')
    const rows = assertRows(result)
    expect(rows).toHaveLength(9)
    assertPairwiseCoverage(factors, rows)
  })

  it('L16: 4 因子各 4 水平 → 16 行且两两覆盖完整', () => {
    const factors: OrthogonalFactor[] = [
      { name: 'A', levels: ['A0', 'A1', 'A2', 'A3'] },
      { name: 'B', levels: ['B0', 'B1', 'B2', 'B3'] },
      { name: 'C', levels: ['C0', 'C1', 'C2', 'C3'] },
      { name: 'D', levels: ['D0', 'D1', 'D2', 'D3'] },
    ]
    const result = selectOrthogonalArray(factors)
    expect('name' in result && result.name).toContain('L16')
    const rows = assertRows(result)
    expect(rows).toHaveLength(16)
    assertPairwiseCoverage(factors, rows)
  })

  it('L18: 1 个 2 水平 + 3 个 3 水平因子 → 18 行且两两覆盖完整', () => {
    const factors: OrthogonalFactor[] = [
      { name: 'Two', levels: ['T0', 'T1'] },
      { name: 'X', levels: ['X0', 'X1', 'X2'] },
      { name: 'Y', levels: ['Y0', 'Y1', 'Y2'] },
      { name: 'Z', levels: ['Z0', 'Z1', 'Z2'] },
    ]
    const result = selectOrthogonalArray(factors)
    expect('name' in result && result.name).toContain('L18')
    const rows = assertRows(result)
    expect(rows).toHaveLength(18)
    assertPairwiseCoverage(factors, rows)
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
