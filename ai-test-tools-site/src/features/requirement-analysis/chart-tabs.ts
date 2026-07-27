import { ListTree, Map as MapIcon, Network } from 'lucide-react'
import type { RequirementChartType } from '../../lib/requirement-analysis-api'

/** 结果页与图表画布共用的图表类型 tabs 定义。 */
export const REQUIREMENT_CHART_TABS: Array<{ type: RequirementChartType; label: string; icon: typeof MapIcon }> = [
  { type: 'mindmap', label: '思维导图', icon: MapIcon },
  { type: 'tree', label: '树状图', icon: ListTree },
  { type: 'logic', label: '逻辑图', icon: Network },
]
