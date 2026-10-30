/** 需求分析 v2 → 用例生成的接力载荷（替代旧 REQUIREMENT_HANDOFF_KEY 的原文传递，#25 决策：结构化载荷） */

export const REQUIREMENT_CONDITIONS_HANDOFF_KEY = 'requirement-analysis-v2-handoff'

export interface HandoffCondition {
  id: string
  text: string
  kind: 'normal' | 'boundary' | 'exception'
  reqId: string | null
}

export interface ConditionsHandoffPayload {
  /** 渲染好的需求描述文本（预填用例弹窗） */
  requirement: string
  /** 分析记录名（用例集名预填） */
  name: string
  /** 分析记录 id（RTM 溯源） */
  recordId: string
  /** 勾选的测试条件（用例集保存后回写关联） */
  conditions: HandoffCondition[]
}

export const CONDITION_KIND_LABEL: Record<HandoffCondition['kind'], string> = {
  normal: '正常',
  boundary: '边界',
  exception: '异常',
}

/** 需求原文摘要上限：超长文档只取头部，避免挤爆生成上下文。 */
export const SOURCE_TEXT_SUMMARY_LIMIT = 2000

/** 渲染接力文本：需求原文摘要 + 逐条测试条件（需逐条覆盖）。与服务端 handoff-text.ts 同形状。 */
export function buildConditionsHandoffText(
  record: { title: string; sourceText: string },
  conditions: Array<Pick<HandoffCondition, 'kind' | 'text'>>,
): string {
  return [
    `【需求分析接力】${record.title}`,
    '',
    '需求原文摘要：',
    record.sourceText.slice(0, SOURCE_TEXT_SUMMARY_LIMIT),
    '',
    '测试条件（需逐条覆盖）：',
    ...conditions.map((c) => `- [${CONDITION_KIND_LABEL[c.kind]}] ${c.text}`),
  ].join('\n')
}
