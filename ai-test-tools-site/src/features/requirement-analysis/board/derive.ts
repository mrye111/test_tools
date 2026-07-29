import {
  BOARD_LIMITS,
  type CauseEffectElement,
  type DecisionTableConditionValue,
  type DecisionTableElement,
  type DecisionTableRule,
  type OrthogonalElement,
  type OrthogonalFactor,
} from './types'

/** 标准正交表模板：行 = 测试组合，列 = 因子位；值为水平索引（从 0 开始） */
const ORTHOGONAL_ARRAY_TEMPLATES = [
  {
    name: 'L4(2^3)',
    rows: [
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ],
  },
  {
    name: 'L8(2^7)',
    rows: [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1],
      [0, 1, 1, 0, 0, 1, 1],
      [0, 1, 1, 1, 1, 0, 0],
      [1, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 1, 0, 1, 0],
      [1, 1, 0, 0, 1, 1, 0],
      [1, 1, 0, 1, 0, 0, 1],
    ],
  },
  {
    name: 'L9(3^4)',
    rows: [
      [0, 0, 0, 0],
      [0, 1, 1, 2],
      [0, 2, 2, 1],
      [1, 0, 1, 1],
      [1, 1, 2, 0],
      [1, 2, 0, 2],
      [2, 0, 2, 2],
      [2, 1, 0, 1],
      [2, 2, 1, 0],
    ],
  },
  {
    name: 'L16(4^5)',
    rows: [
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 1],
      [0, 2, 2, 2, 2],
      [0, 3, 3, 3, 3],
      [1, 0, 1, 2, 3],
      [1, 1, 0, 3, 2],
      [1, 2, 3, 0, 1],
      [1, 3, 2, 1, 0],
      [2, 0, 2, 3, 1],
      [2, 1, 3, 2, 0],
      [2, 2, 0, 1, 3],
      [2, 3, 1, 0, 2],
      [3, 0, 3, 1, 2],
      [3, 1, 2, 0, 3],
      [3, 2, 1, 3, 0],
      [3, 3, 0, 2, 1],
    ],
  },
  {
    name: 'L18(2^1 3^7)',
    rows: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 1, 1, 1, 1],
      [0, 0, 2, 2, 2, 2, 2, 2],
      [0, 1, 0, 0, 1, 1, 2, 2],
      [0, 1, 1, 1, 2, 2, 0, 0],
      [0, 1, 2, 2, 0, 0, 1, 1],
      [0, 2, 0, 1, 0, 2, 1, 2],
      [0, 2, 1, 2, 1, 0, 2, 0],
      [0, 2, 2, 0, 2, 1, 0, 1],
      [1, 0, 0, 2, 2, 1, 1, 0],
      [1, 0, 1, 0, 0, 2, 2, 1],
      [1, 0, 2, 1, 1, 0, 0, 2],
      [1, 1, 0, 2, 0, 1, 2, 1],
      [1, 1, 1, 0, 1, 2, 0, 2],
      [1, 1, 2, 1, 2, 0, 1, 0],
      [1, 2, 0, 1, 2, 0, 2, 1],
      [1, 2, 1, 2, 0, 1, 0, 2],
      [1, 2, 2, 0, 1, 2, 1, 0],
    ],
  },
]

/** 计算每列最多可容纳的水平数 */
function getColumnMaxLevels(templateRows: number[][]): number[] {
  if (templateRows.length === 0) return []
  const columnCount = templateRows[0].length
  return Array.from({ length: columnCount }, (_, col) => {
    let max = 0
    for (const row of templateRows) {
      if (row[col] > max) max = row[col]
    }
    return max + 1
  })
}

/**
 * 为每个因子分配一个满足其水平数需求的列。
 * 采用“水平数降序 + 列容量降序”的贪心策略，确保混合水平阵列（如 L18）中
 * 高水因子优先放入高容量列。
 */
function assignColumns(factorLevels: number[], columnMaxLevels: number[]): number[] | null {
  const factors = factorLevels
    .map((levels, index) => ({ levels, index }))
    .sort((a, b) => b.levels - a.levels)

  const used = new Array(columnMaxLevels.length).fill(false)
  const assignment = new Array(factorLevels.length).fill(-1)

  for (const factor of factors) {
    // 找到能容纳该因子水平数且未被使用的最小列（保留大列给后续高水因子）
    let chosen = -1
    for (let col = 0; col < columnMaxLevels.length; col++) {
      if (used[col]) continue
      if (columnMaxLevels[col] >= factor.levels) {
        if (chosen === -1 || columnMaxLevels[col] < columnMaxLevels[chosen]) {
          chosen = col
        }
      }
    }
    if (chosen === -1) return null
    used[chosen] = true
    assignment[factor.index] = chosen
  }

  return assignment
}

/**
 * 正交表选型与生成。
 * 内置 L4/L8/L9/L16/L18 五张标准阵列，按行数由小到大依次匹配：
 * 因子数 ≤ 列数，且能为每个因子找到水平容量足够的列。
 * 水平值不足阵列列水平数时，按循环复用填充（直接构造法的常规近似）。
 */
export function selectOrthogonalArray(
  factors: OrthogonalFactor[]
): { name: string; rows: string[][] } | { error: string } {
  const totalLevels = factors.reduce((sum, f) => sum + f.levels.length, 0)
  if (
    factors.length > BOARD_LIMITS.MAX_ORTHO_FACTORS ||
    totalLevels > BOARD_LIMITS.MAX_ORTHO_LEVELS_TOTAL
  ) {
    return { error: '因子/水平超出支持范围（≤4 因子、总水平 ≤ 18）' }
  }

  for (const template of ORTHOGONAL_ARRAY_TEMPLATES) {
    const columnMaxLevels = getColumnMaxLevels(template.rows)
    const factorLevels = factors.map((f) => f.levels.length)
    const assignment = assignColumns(factorLevels, columnMaxLevels)
    if (!assignment) continue

    const rows = template.rows.map((row) =>
      factors.map((factor, index) => {
        const col = assignment[index]
        const levelIndex = row[col] % factor.levels.length
        return factor.levels[levelIndex]
      })
    )

    return { name: template.name, rows }
  }

  return { error: '因子/水平超出支持范围（≤4 因子、总水平 ≤ 18）' }
}

/** 获取节点的所有入边 */
function getIncomingEdges(nodeId: string, edges: CauseEffectElement['edges']) {
  return edges.filter((edge) => edge.to === nodeId)
}

/**
 * 递归求值因果图节点。
 * 支持 cause（取当前组合值）、intermediate/effect（按入边约束求值）。
 * and：所有操作数全真；or：任一真；not：对单源取反；identity：原值。
 */
function evaluateNode(
  nodeId: string,
  ce: CauseEffectElement,
  combination: Record<string, boolean>,
  stack: Set<string>
): boolean {
  if (stack.has(nodeId)) {
    throw new Error('原因链成环')
  }

  const node = ce.nodes.find((n) => n.id === nodeId)
  if (!node) return false

  if (node.role === 'cause') {
    return nodeId in combination ? combination[nodeId] : false
  }

  const incoming = getIncomingEdges(nodeId, ce.edges)
  if (incoming.length === 0) return false

  stack.add(nodeId)
  const operands = incoming.map((edge) => {
    const value = evaluateNode(edge.from, ce, combination, stack)
    return edge.constraint === 'not' ? !value : value
  })
  stack.delete(nodeId)

  const hasOr = incoming.some((edge) => edge.constraint === 'or')
  return hasOr ? operands.some(Boolean) : operands.every(Boolean)
}

/** 从结果节点反向回溯，收集所有原因节点并检测环路 */
function collectCauses(
  ce: CauseEffectElement
): { causes: { id: string; text: string }[]; error?: string } {
  const effects = ce.nodes.filter((n) => n.role === 'effect')
  if (effects.length === 0) {
    return { error: '因果图中没有结果节点', causes: [] }
  }

  const seen = new Set<string>()
  const stack = new Set<string>()
  const causes: { id: string; text: string }[] = []

  function visit(nodeId: string) {
    if (stack.has(nodeId)) {
      throw new Error('原因链成环')
    }
    if (seen.has(nodeId)) return
    seen.add(nodeId)

    const node = ce.nodes.find((n) => n.id === nodeId)
    if (!node) return

    if (node.role === 'cause') {
      causes.push({ id: node.id, text: node.text })
    }

    // 即使命节点也继续遍历其入边，以便检测从结果节点反向连回原因节点形成的环路
    stack.add(nodeId)
    for (const edge of getIncomingEdges(nodeId, ce.edges)) {
      visit(edge.from)
    }
    stack.delete(nodeId)
  }

  try {
    for (const effect of effects) {
      visit(effect.id)
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : '因果图存在环', causes: [] }
  }

  return { causes }
}

/**
 * 因果图推导判定表。
 * 每个 effect 作为动作，全部 cause 作为条件桩；枚举 2^n 种组合（n > 8 时截断至前 8 个原因），
 * 按约束规则求出每个动作是否发生。
 */
export function deriveDecisionTable(
  ce: CauseEffectElement
): DecisionTableElement | { error: string } {
  const effects = ce.nodes.filter((n) => n.role === 'effect')
  const { causes, error } = collectCauses(ce)
  if (error) return { error }

  // 原因数超过 8 时截断，避免组合爆炸；保留首次出现的前 8 个原因
  const effectiveCauses = causes.length > 8 ? causes.slice(0, 8) : causes
  const causeCount = effectiveCauses.length

  const rules: DecisionTableRule[] = []
  for (let mask = 0; mask < 1 << causeCount; mask++) {
    const combination: Record<string, boolean> = {}
    const conditionValues: DecisionTableConditionValue[] = []

    for (let i = 0; i < causeCount; i++) {
      const value = Boolean(mask & (1 << i))
      combination[effectiveCauses[i].id] = value
      conditionValues.push(value ? 'Y' : 'N')
    }

    const actionValues = effects.map((effect) =>
      evaluateNode(effect.id, ce, combination, new Set<string>())
    )

    rules.push({ conditionValues, actionValues })
  }

  return {
    id: `${ce.id}-dt`,
    kind: 'decision-table',
    x: 0,
    y: 0,
    w: 400,
    h: 200,
    sourceNodeId: ce.sourceNodeId,
    conditions: effectiveCauses.map((c) => c.text),
    actions: effects.map((e) => e.text),
    rules,
  }
}

/**
 * 合并判定表中条件取值与动作取值完全相同的规则列，
 * 以 conditionValues.join('') + actionValues.join('') 为键去重，保留首次出现的列。
 */
export function mergeEquivalentRules(table: DecisionTableElement): DecisionTableElement {
  const seen = new Set<string>()
  const rules = table.rules.filter((rule) => {
    const key = rule.conditionValues.join('') + rule.actionValues.join('')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { ...table, rules }
}

/**
 * 用例骨架：测试设计画布向标准测试用例过渡的中间结构。
 */
export interface CaseSkeleton {
  source: 'decision-table' | 'orthogonal'
  precondition: string
  steps: string
  expected: string
}

/**
 * 将判定表展开为多条用例骨架。
 * 前置条件：Y → "条件名成立"、N → "条件名不成立"、- 跳过；多条件以 "；" 连接。
 * 步骤：基于前置条件生成触发描述，例如 "当{条件}时，触发对应业务操作"。
 * 预期结果：动作取值为 true 的项以 "、" 连接，全为 false 时输出 "无附加动作发生"。
 */
export function decisionTableToSkeleton(table: DecisionTableElement): CaseSkeleton[] {
  return table.rules.map((rule) => {
    const preconditions = rule.conditionValues
      .map((value, index) => {
        if (value === 'Y') return `${table.conditions[index]}成立`
        if (value === 'N') return `${table.conditions[index]}不成立`
        return null
      })
      .filter((text): text is string => text !== null)
      .join('；')

    const trueActions = rule.actionValues
      .map((value, index) => (value ? table.actions[index] : null))
      .filter((text): text is string => text !== null)
    const expected = trueActions.length > 0 ? trueActions.join('、') : '无附加动作发生'
    const steps = preconditions ? `当${preconditions}时，触发对应业务操作` : '触发对应业务操作'

    return {
      source: 'decision-table',
      precondition: preconditions,
      steps,
      expected,
    }
  })
}

/**
 * 将正交表展开为多条用例骨架。
 * 每行对应一条组合，前置条件为 "因子名=水平值" 键值对的 "；" 连接。
 * 步骤：按该组合构造输入描述。
 * 预期：引用该组合，说明行为符合对应规则。
 */
export function orthogonalToSkeleton(el: OrthogonalElement): CaseSkeleton[] {
  return el.rows.map((row) => {
    const preconditions = row
      .map((level, index) => `${el.factors[index].name}=${level}`)
      .join('；')

    return {
      source: 'orthogonal',
      precondition: preconditions,
      steps: `按${preconditions}组合构造输入`,
      expected: `${preconditions} 时行为符合对应规则`,
    }
  })
}

/** 转义 Markdown 表格单元格中的管道符，避免破坏表格结构。 */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/**
 * 将一组用例骨架序列化为 Markdown 文本，供后续接力补全为完整用例。
 * 按来源拆分为判定表规则与正交表组合两个表格输出。
 */
export function serializeSkeletons(sourceTitle: string, skeletons: CaseSkeleton[]): string {
  const decisionSkeletons = skeletons.filter((s) => s.source === 'decision-table')
  const orthogonalSkeletons = skeletons.filter((s) => s.source === 'orthogonal')

  const lines = [
    `## 需求：${sourceTitle}`,
    '',
    '以下用例骨架由测试设计画布产出，请据此补全为标准用例。',
    '',
    `### 判定表规则（共 ${decisionSkeletons.length} 条）`,
    '| # | 前置条件 | 步骤 | 预期 |',
    '|---|---|---|---|',
  ]

  decisionSkeletons.forEach((skeleton, index) => {
    lines.push(
      `| ${index + 1} | ${escapeTableCell(skeleton.precondition)} | ${escapeTableCell(skeleton.steps)} | ${escapeTableCell(skeleton.expected)} |`
    )
  })

  lines.push('', `### 正交表组合（共 ${orthogonalSkeletons.length} 条）`, '| # | 前置条件 | 步骤 | 预期 |', '|---|---|---|---|')

  orthogonalSkeletons.forEach((skeleton, index) => {
    lines.push(
      `| ${index + 1} | ${escapeTableCell(skeleton.precondition)} | ${escapeTableCell(skeleton.steps)} | ${escapeTableCell(skeleton.expected)} |`
    )
  })

  return lines.join('\n')
}
