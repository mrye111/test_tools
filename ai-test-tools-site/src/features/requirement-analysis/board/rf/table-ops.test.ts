import { describe, expect, it } from 'vitest'
import {
  dtAddCondition,
  dtAddRule,
  dtNextValue,
  dtRemoveCondition,
  dtRemoveRule,
  dtRenameRow,
  dtToggleAction,
  dtToggleCell,
  ogRegenerateRows,
  ogSetFactorLevels,
} from './table-ops'
import type { DecisionTableNodeData, OrthogonalNodeData } from './rf-types'

const dt: DecisionTableNodeData = {
  kind: 'decision-table',
  conditions: ['密码正确', '账号未锁定'],
  actions: ['登录成功'],
  rules: [
    { conditionValues: ['Y', 'Y'], actionValues: [true] },
    { conditionValues: ['N', '-'], actionValues: [false] },
  ],
  sourceNodeId: null,
}

describe('table-ops 判定表编辑（#20）', () => {
  it('单元格循环 Y→N→-→Y', () => {
    expect(dtNextValue('Y')).toBe('N')
    expect(dtNextValue('N')).toBe('-')
    expect(dtNextValue('-')).toBe('Y')

    const next = dtToggleCell(dt, 0, 0)
    expect(next.rules[0].conditionValues[0]).toBe('N')
    expect(dt.rules[0].conditionValues[0]).toBe('Y') // 不可变
    // 其他行列不受影响
    expect(next.rules[1].conditionValues[0]).toBe('N')
    expect(next.rules[0].conditionValues[1]).toBe('Y')
  })

  it('动作开关切换', () => {
    const next = dtToggleAction(dt, 0, 1)
    expect(next.rules[1].actionValues[0]).toBe(true)
  })

  it('增删条件联动规则行数；增删规则列', () => {
    const added = dtAddCondition(dt)
    expect(added.conditions).toHaveLength(3)
    expect(added.rules[0].conditionValues).toHaveLength(3)

    const removed = dtRemoveCondition(dt, 0)
    expect(removed.conditions).toEqual(['账号未锁定'])
    expect(removed.rules[0].conditionValues).toEqual(['Y'])
    // 仅剩一条条件时不可再删
    expect(dtRemoveCondition(removed, 0)).toBe(removed)

    const ruleAdded = dtAddRule(dt)
    expect(ruleAdded.rules).toHaveLength(3)
    expect(ruleAdded.rules[2].conditionValues).toEqual(['Y', 'Y'])

    const ruleRemoved = dtRemoveRule(dt, 0)
    expect(ruleRemoved.rules).toHaveLength(1)
    expect(dtRemoveRule(ruleRemoved, 0)).toBe(ruleRemoved)
  })

  it('行重命名；空文本不动', () => {
    const next = dtRenameRow(dt, 'conditions', 0, ' 密码校验通过 ')
    expect(next.conditions[0]).toBe('密码校验通过')
    expect(dtRenameRow(dt, 'conditions', 0, '  ')).toBe(dt)
  })
})

const og: OrthogonalNodeData = {
  kind: 'orthogonal',
  factors: [
    { name: '浏览器', levels: ['Chrome', 'Firefox'] },
    { name: '系统', levels: ['Win', 'Mac'] },
  ],
  arrayName: '',
  rows: [],
  sourceNodeId: null,
}

describe('table-ops 正交表编辑（#20）', () => {
  it('水平编辑（逗号/顿号分隔）后重算阵列', () => {
    const updated = ogSetFactorLevels(og, 0, 'Chrome，Edge, Firefox')
    expect(updated.factors[0].levels).toEqual(['Chrome', 'Edge', 'Firefox'])
    // 少于 2 个水平不动
    expect(ogSetFactorLevels(og, 0, 'Chrome')).toBe(og)

    const regenerated = ogRegenerateRows(updated)
    expect('error' in regenerated).toBe(false)
    if (!('error' in regenerated)) {
      expect(regenerated.rows.length).toBeGreaterThan(0)
      expect(regenerated.rows[0]).toHaveLength(2)
    }
  })

  it('因子数超上限时重算报错', () => {
    const tooMany: OrthogonalNodeData = {
      ...og,
      factors: Array.from({ length: 5 }, (_, i) => ({ name: `F${i}`, levels: ['a', 'b'] })),
    }
    const result = ogRegenerateRows(tooMany)
    expect('error' in result).toBe(true)
  })
})
