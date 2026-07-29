import {
  Brain,
  FileText,
  GitBranch,
  Kanban,
  Layers,
  Lightbulb,
  ListTree,
  Map as MapIcon,
  Network,
  Presentation,
  Route,
  StickyNote,
  Table2,
  Target,
  Users,
} from 'lucide-react'

export type TemplateCategory = {
  id: string
  label: string
  icon: typeof Layers
}

export type BoardTemplate = {
  id: string
  name: string
  description: string
  categoryId: string
  icon: typeof MapIcon
}

/** 模板中心分类导航（本期纯骨架，对齐 boardmix 模板中心结构）。 */
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { id: 'all', label: '全部模板', icon: Layers },
  { id: 'drawing', label: '绘图&创作', icon: GitBranch },
  { id: 'research', label: '调研分析', icon: Target },
  { id: 'notes', label: '灵感/笔记', icon: StickyNote },
  { id: 'management', label: '项目管理', icon: Kanban },
  { id: 'brainstorm', label: '头脑风暴', icon: Lightbulb },
  { id: 'strategy', label: '策略&分析', icon: Presentation },
  { id: 'meeting', label: '会议&工作坊', icon: Users },
]

/** 内置静态模板列表；本期仅用于模板中心展示，"使用模板"不真正插入画布（ADR 0005）。 */
export const BOARD_TEMPLATES: BoardTemplate[] = [
  { id: 'mindmap', name: '思维导图', description: '围绕中心主题发散整理思路', categoryId: 'drawing', icon: MapIcon },
  { id: 'flowchart', name: '流程图', description: '表达流程步骤与分支判断', categoryId: 'drawing', icon: GitBranch },
  { id: 'org-chart', name: '组织结构图', description: '呈现团队层级与汇报关系', categoryId: 'drawing', icon: ListTree },
  { id: 'architecture', name: '架构图', description: '描述系统分层与模块依赖', categoryId: 'drawing', icon: Network },
  { id: 'timeline', name: '时间轴', description: '按时间顺序排布里程碑', categoryId: 'drawing', icon: Route },
  { id: 'er-diagram', name: 'E-R 图', description: '建模实体、属性与关系', categoryId: 'drawing', icon: Table2 },
  { id: 'user-journey', name: '用户旅程地图', description: '梳理用户阶段、行为与痛点', categoryId: 'research', icon: Route },
  { id: 'persona', name: '用户画像', description: '沉淀目标用户特征与目标', categoryId: 'research', icon: Users },
  { id: 'competitor', name: '竞品分析', description: '多维度对比竞品能力', categoryId: 'research', icon: Target },
  { id: 'sticky-wall', name: '便签墙', description: '快速收集与归类零散想法', categoryId: 'notes', icon: StickyNote },
  { id: 'reading-notes', name: '读书笔记', description: '结构化摘录与心得整理', categoryId: 'notes', icon: FileText },
  { id: 'kanban', name: '任务看板', description: '以泳道管理任务流转状态', categoryId: 'management', icon: Kanban },
  { id: 'gantt', name: '项目计划', description: '排期、负责人与里程碑一览', categoryId: 'management', icon: Table2 },
  { id: 'brain-writing', name: '脑力写作', description: '轮流书写激发团队创意', categoryId: 'brainstorm', icon: Brain },
  { id: 'swot', name: 'SWOT 分析', description: '优势、劣势、机会与威胁', categoryId: 'strategy', icon: Target },
  { id: 'quadrant', name: '四象限法', description: '按两个维度划分优先级', categoryId: 'strategy', icon: Layers },
  { id: 'retro', name: '复盘会', description: '保持、改进与停止清单', categoryId: 'meeting', icon: Presentation },
  { id: 'weekly', name: '周会议程', description: '同步进展、风险与下一步', categoryId: 'meeting', icon: Users },
]
