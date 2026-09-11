/** 画布共享上下文：需求树 + 占位节点动作（独立文件以满足 react-refresh 约束） */

import { createContext } from 'react'
import type { RequirementNode } from '../../../../lib/requirement-analysis-api'

export interface BoardCanvasContextValue {
  tree: RequirementNode | null
  onSelectMindmapNode?: (mindmapNodeId: string, requirementNodeId: string | null) => void
  onRetryPending?: (nodeId: string) => void
  onDeletePending?: (nodeId: string) => void
  /** 文本编辑提交（#19）：更新 CE/流程图节点文案 */
  onUpdateNodeText?: (nodeId: string, text: string) => void
  /** 点击因果图边标签循环切换约束（#19） */
  onCycleConstraint?: (edgeId: string) => void
  /** 判定表内容更新（#20）：整份 data 替换，调用方保证不可变 */
  onUpdateDecisionTable?: (nodeId: string, data: import('./rf-types').DecisionTableNodeData) => void
  /** 正交表内容更新（#20） */
  onUpdateOrthogonal?: (nodeId: string, data: import('./rf-types').OrthogonalNodeData) => void
}

export const BoardCanvasContext = createContext<BoardCanvasContextValue>({ tree: null })
