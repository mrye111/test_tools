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
