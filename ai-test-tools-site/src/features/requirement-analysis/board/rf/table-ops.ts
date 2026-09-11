/** 判定表/正交表表格内编辑的纯操作（跟随票 #20）：全部不可变更新 */

import type { DecisionTableNodeData, OrthogonalNodeData } from './rf-types'
import { selectOrthogonalArray } from '../derive'

type DtRule = DecisionTableNodeData['rules'][number]

/** 条件值循环：Y → N → - → Y */
export function dtNextValue(current: 'Y' | 'N' | '-'): 'Y' | 'N' | '-' {
  return current === 'Y' ? 'N' : current === 'N' ? '-' : 'Y'
}

/** 切换某规则列某条件行的取值 */
export function dtToggleCell(data: DecisionTableNodeData, row: number, col: number): DecisionTableNodeData {
  return {
    ...data,
    rules: data.rules.map((rule, i) =>
      i === col
        ? { ...rule, conditionValues: rule.conditionValues.map((v, j) => (j === row ? dtNextValue(v) : v)) }
        : rule,
    ),
  }
}

/** 切换动作取值（✓ 开/关） */
export function dtToggleAction(data: DecisionTableNodeData, row: number, col: number): DecisionTableNodeData {
  return {
    ...data,
    rules: data.rules.map((rule, i) =>
      i === col ? { ...rule, actionValues: rule.actionValues.map((v, j) => (j === row ? !v : v)) } : rule,
    ),
  }
}

export function dtAddCondition(data: DecisionTableNodeData, text = '新条件'): DecisionTableNodeData {
  return {
    ...data,
    conditions: [...data.conditions, text],
    rules: data.rules.map((rule) => ({ ...rule, conditionValues: [...rule.conditionValues, 'Y'] })),
  }
}

export function dtRemoveCondition(data: DecisionTableNodeData, row: number): DecisionTableNodeData {
  if (data.conditions.length <= 1) return data
  return {
    ...data,
    conditions: data.conditions.filter((_, i) => i !== row),
    rules: data.rules.map((rule) => ({ ...rule, conditionValues: rule.conditionValues.filter((_, i) => i !== row) })),
  }
}

export function dtAddAction(data: DecisionTableNodeData, text = '新动作'): DecisionTableNodeData {
  return {
    ...data,
    actions: [...data.actions, text],
    rules: data.rules.map((rule) => ({ ...rule, actionValues: [...rule.actionValues, true] })),
  }
}

export function dtRemoveAction(data: DecisionTableNodeData, row: number): DecisionTableNodeData {
  if (data.actions.length <= 1) return data
  return {
    ...data,
    actions: data.actions.filter((_, i) => i !== row),
    rules: data.rules.map((rule) => ({ ...rule, actionValues: rule.actionValues.filter((_, i) => i !== row) })),
  }
}

export function dtAddRule(data: DecisionTableNodeData): DecisionTableNodeData {
  const rule: DtRule = {
    conditionValues: data.conditions.map(() => 'Y' as const),
    actionValues: data.actions.map(() => true),
  }
  return { ...data, rules: [...data.rules, rule] }
}

export function dtRemoveRule(data: DecisionTableNodeData, col: number): DecisionTableNodeData {
  if (data.rules.length <= 1) return data
  return { ...data, rules: data.rules.filter((_, i) => i !== col) }
}

/** 重命名条件/动作行 */
export function dtRenameRow(data: DecisionTableNodeData, section: 'conditions' | 'actions', row: number, text: string): DecisionTableNodeData {
  const trimmed = text.trim()
  if (!trimmed) return data
  return {
    ...data,
    [section]: data[section].map((v, i) => (i === row ? trimmed : v)),
  }
}

/** 正交表：因子/水平更新后按算法重算阵列行；因子数越界等由 selectOrthogonalArray 报错 */
export function ogRegenerateRows(data: OrthogonalNodeData): OrthogonalNodeData | { error: string } {
  const selected = selectOrthogonalArray(data.factors)
  if ('error' in selected) return { error: selected.error ?? '正交表重算失败' }
  return { ...data, arrayName: selected.name, rows: selected.rows }
}

/** 更新因子水平（逗号/顿号分隔） */
export function ogSetFactorLevels(data: OrthogonalNodeData, factorIndex: number, levelsText: string): OrthogonalNodeData {
  const levels = levelsText.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  if (levels.length < 2) return data
  return {
    ...data,
    factors: data.factors.map((f, i) => (i === factorIndex ? { ...f, levels } : f)),
  }
}

/** 重命名因子 */
export function ogRenameFactor(data: OrthogonalNodeData, factorIndex: number, name: string): OrthogonalNodeData {
  const trimmed = name.trim()
  if (!trimmed) return data
  return {
    ...data,
    factors: data.factors.map((f, i) => (i === factorIndex ? { ...f, name: trimmed } : f)),
  }
}
