/** 白板元素与常量（spec §4 图元模型；上限 spec §7） */

export const BOARD_LIMITS = {
  MAX_ELEMENTS: 50,
  MAX_CE_NODES: 60,
  MAX_DT_RULES: 64,
  MAX_ORTHO_FACTORS: 4,
  MAX_ORTHO_LEVELS_TOTAL: 18,
  MAX_TEXT_LENGTH: 200,
} as const

/** 因果图节点在命中的默认绘制尺寸（供命中检测使用） */
export const CE_NODE_W = 160
export const CE_NODE_H = 40

export type ElementKind = 'mindmap-ref' | 'cause-effect' | 'decision-table' | 'orthogonal'

export interface ElementBase {
  id: string
  kind: ElementKind
  x: number
  y: number
  w: number
  h: number
  /** 溯源：从哪个需求节点生成；null = 用户白手建 */
  sourceNodeId: string | null
  /** 占位图元标记：AI 生成中；会话态/临时态，不持久化 */
  pending?: boolean
  /** 图元生成/推导错误信息；会话态/临时态，不持久化 */
  error?: string
}

export interface MindmapRefElement extends ElementBase {
  kind: 'mindmap-ref'
  /** 选中 = AI 生成上下文；会话态，持久化时始终为 null */
  selectedNodeId: string | null
}

export type CauseEffectNodeRole = 'cause' | 'intermediate' | 'effect'
export type CauseEffectConstraint = 'and' | 'or' | 'not' | 'identity'

export interface CauseEffectNode {
  id: string
  role: CauseEffectNodeRole
  text: string
  /** 相对图元原点的局部坐标 */
  x: number
  y: number
}

export interface CauseEffectEdge {
  id: string
  from: string
  to: string
  constraint: CauseEffectConstraint
}

export interface CauseEffectElement extends ElementBase {
  kind: 'cause-effect'
  nodes: CauseEffectNode[]
  edges: CauseEffectEdge[]
}

export type DecisionTableConditionValue = 'Y' | 'N' | '-'

export interface DecisionTableRule {
  conditionValues: DecisionTableConditionValue[]
  actionValues: boolean[]
}

export interface DecisionTableElement extends ElementBase {
  kind: 'decision-table'
  conditions: string[]
  actions: string[]
  rules: DecisionTableRule[]
}

export interface OrthogonalFactor {
  name: string
  levels: string[]
}

export interface OrthogonalElement extends ElementBase {
  kind: 'orthogonal'
  factors: OrthogonalFactor[]
  arrayName: string
  rows: string[][]
}

export type BoardElement =
  | MindmapRefElement
  | CauseEffectElement
  | DecisionTableElement
  | OrthogonalElement

export interface Board {
  version: 1
  elements: BoardElement[]
}
