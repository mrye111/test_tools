/**
 * 需求分析 Chat 智能体模板常量。
 * 与服务端 chat 域的 AgentTemplate 对齐，但前端独立维护元数据。
 */

import { GitGraph, LayoutGrid, ListTree, Table2, Workflow, type LucideIcon } from 'lucide-react'

export type AgentTemplate =
  | 'mindmap'
  | 'cause-effect'
  | 'decision-table'
  | 'orthogonal'
  | 'flowchart'

export interface AgentTemplateMeta {
  kind: AgentTemplate
  label: string
  description: string
  icon: LucideIcon
  gradient: string
}

/** 默认展示顺序即优先级：mindmap 为首。 */
export const AGENT_TEMPLATES: AgentTemplateMeta[] = [
  {
    kind: 'mindmap',
    label: '思维导图',
    description: '从需求文本生成结构化的层级思维导图。',
    icon: ListTree,
    gradient: 'from-violet-500 to-blue-500',
  },
  {
    kind: 'cause-effect',
    label: '因果图',
    description: '梳理需求中的原因与结果关系。',
    icon: GitGraph,
    gradient: 'from-rose-500 to-amber-500',
  },
  {
    kind: 'decision-table',
    label: '判定表',
    description: '把条件与动作整理成可执行的判定表。',
    icon: Table2,
    gradient: 'from-cyan-500 to-teal-500',
  },
  {
    kind: 'orthogonal',
    label: '正交表',
    description: '生成正交试验因子组合，覆盖关键场景。',
    icon: LayoutGrid,
    gradient: 'from-emerald-500 to-lime-500',
  },
  {
    kind: 'flowchart',
    label: '流程图',
    description: '将需求主流程绘制为流程图。',
    icon: Workflow,
    gradient: 'from-indigo-500 to-purple-500',
  },
]
