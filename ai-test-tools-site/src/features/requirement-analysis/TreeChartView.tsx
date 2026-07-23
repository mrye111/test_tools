import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { TreeChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { RequirementNode } from '../../lib/requirement-analysis-api'
import { nodeLabelWithBadge } from '../../lib/requirement-export'
import type { ChartExportHandle } from './MindMapView'

echarts.use([TreeChart, TooltipComponent, CanvasRenderer])

type EChartsTreeDatum = {
  name: string
  rid: string
  children: EChartsTreeDatum[]
  itemStyle?: { borderColor: string; borderWidth: number }
}

type TreeChartViewProps = {
  tree: RequirementNode
  findingCounts: Map<string, number>
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  /** TB = 自上而下的树状图，LR = 向右展开的逻辑图 */
  orientation: 'TB' | 'LR'
}

function toChartDatum(node: RequirementNode, counts: Map<string, number>, selectedNodeId: string | null): EChartsTreeDatum {
  return {
    name: nodeLabelWithBadge(node, counts),
    rid: node.id,
    children: node.children.map((child) => toChartDatum(child, counts, selectedNodeId)),
    ...(node.id === selectedNodeId
      ? { itemStyle: { borderColor: '#0891b2', borderWidth: 3 } }
      : {}),
  }
}

/** ECharts 树图：树状图（TB）与逻辑图（LR）共用，仅方向不同。 */
export const TreeChartView = forwardRef<ChartExportHandle, TreeChartViewProps>(function TreeChartView(props, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const onSelectNodeRef = useRef(props.onSelectNode)
  onSelectNodeRef.current = props.onSelectNode

  const chartData = useMemo(
    () => toChartDatum(props.tree, props.findingCounts, props.selectedNodeId),
    [props.tree, props.findingCounts, props.selectedNodeId],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = echarts.init(container)
    chartRef.current = chart
    chart.on('click', (params) => {
      const datum = (params as { data?: EChartsTreeDatum }).data
      onSelectNodeRef.current(datum?.rid ?? null)
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const horizontal = props.orientation === 'LR'
    chart.setOption(
      {
        tooltip: { trigger: 'item', triggerOn: 'mousemove' },
        series: [
          {
            type: 'tree',
            data: [chartData],
            orient: props.orientation,
            roam: true,
            expandAndCollapse: false,
            initialTreeDepth: -1,
            symbolSize: 9,
            itemStyle: { color: '#0891b2', borderColor: '#0891b2' },
            lineStyle: { color: '#c7c9d9', width: 1.2, curveness: 0.5 },
            label: {
              position: horizontal ? 'left' : 'bottom',
              verticalAlign: 'middle',
              align: horizontal ? 'right' : 'center',
              fontSize: 12,
              color: '#26273a',
            },
            leaves: {
              label: {
                position: horizontal ? 'right' : 'bottom',
                align: horizontal ? 'left' : 'center',
              },
            },
            emphasis: { focus: 'descendant' },
            animationDuration: 300,
            animationDurationUpdate: 300,
          },
        ],
      },
      true,
    )
  }, [chartData, props.orientation])

  useImperativeHandle(ref, () => ({
    getPngDataUrl: async () => chartRef.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }) ?? null,
  }), [])

  return <div ref={containerRef} className="requirement-chart-canvas" role="img" aria-label="需求分解树图" />
})
