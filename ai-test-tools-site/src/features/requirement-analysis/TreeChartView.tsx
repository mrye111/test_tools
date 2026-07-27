import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { TreeChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { RequirementNode } from '../../lib/requirement-analysis-api'
import { nodeLabelWithBadge } from '../../lib/requirement-export'
import type { ChartCanvasHandle } from './MindMapView'

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
  /** 缩放比变化回调（1 = 初始布局即适应屏幕基线）；画布工具栏用于显示当前百分比。 */
  onZoomScaleChange?: (ratio: number) => void
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

function buildTreeOption(orientation: 'TB' | 'LR', chartData: EChartsTreeDatum) {
  const horizontal = orientation === 'LR'
  return {
    tooltip: { trigger: 'item', triggerOn: 'mousemove' },
    series: [
      {
        type: 'tree',
        data: [chartData],
        orient: orientation,
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
  } as const
}

/** 读取 tree series 当前缩放值（用户 roam 后 echarts 会把 zoom/center 回写到 series option）。 */
function readChartZoom(chart: echarts.ECharts): number {
  const option = chart.getOption() as { series?: Array<{ zoom?: unknown }> }
  const zoom = option.series?.[0]?.zoom
  return typeof zoom === 'number' && zoom > 0 ? zoom : 1
}

/** ECharts 树图：树状图（TB）与逻辑图（LR）共用，仅方向不同。 */
export const TreeChartView = forwardRef<ChartCanvasHandle, TreeChartViewProps>(function TreeChartView(props, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const onSelectNodeRef = useRef(props.onSelectNode)
  onSelectNodeRef.current = props.onSelectNode
  const onZoomScaleChangeRef = useRef(props.onZoomScaleChange)
  onZoomScaleChangeRef.current = props.onZoomScaleChange
  const lastOrientationRef = useRef<'TB' | 'LR' | null>(null)
  const lastTreeRef = useRef<RequirementNode | null>(null)
  const lastOptionRef = useRef<ReturnType<typeof buildTreeOption> | null>(null)

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
    // 用户滚轮/拖拽 roam 后回报缩放比（初始布局为基线 1）
    chart.on('treeroam', () => {
      onZoomScaleChangeRef.current?.(readChartZoom(chart))
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
    const option = buildTreeOption(props.orientation, chartData)
    lastOptionRef.current = option
    // 方向切换或整棵树更换（切换分析记录，组件不重挂载）时整体重建，roam 缩放自然复位；
    // 选中节点/计数等数据变化走 merge，保留当前缩放/平移
    const orientationChanged = lastOrientationRef.current !== null && lastOrientationRef.current !== props.orientation
    lastOrientationRef.current = props.orientation
    const treeChanged = lastTreeRef.current !== null && lastTreeRef.current !== props.tree
    lastTreeRef.current = props.tree
    chart.setOption(option, orientationChanged || treeChanged)
    onZoomScaleChangeRef.current?.(readChartZoom(chart))
  }, [chartData, props.orientation, props.tree])

  useImperativeHandle(ref, () => ({
    getPngDataUrl: async () => chartRef.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }) ?? null,
    zoomBy: (factor) => {
      const chart = chartRef.current
      if (!chart || !(factor > 0) || !Number.isFinite(factor)) return
      const current = readChartZoom(chart)
      chart.setOption({ series: [{ zoom: current * factor }] })
      onZoomScaleChangeRef.current?.(readChartZoom(chart))
    },
    fit: async () => {
      const chart = chartRef.current
      const option = lastOptionRef.current
      if (!chart || !option) return
      // 复位 roam：关闭动画整体重建，缩放/平移回到初始布局，getDataURL 可立即取到完整树
      chart.setOption({ ...option, animation: false }, true)
      chart.setOption({ animation: true })
      onZoomScaleChangeRef.current?.(1)
    },
  }), [])

  return <div ref={containerRef} className="requirement-chart-canvas" role="img" aria-label="需求分解树图" />
})
