import { useCallback, useEffect, useRef, useState } from 'react'
import { Expand, ImageDown, Loader2, PanelRightClose, PanelRightOpen, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { Finding, RequirementChartType, RequirementNode } from '../../lib/requirement-analysis-api'
import { downloadDataUrl } from '../../lib/requirement-export'
import { ModalPortal } from '../../components/ui/ModalPortal'
import { Tooltip } from '../../components/ui/Tooltip'
import { MindMapView, type ChartCanvasHandle } from './MindMapView'
import { TreeChartView } from './TreeChartView'
import { FindingsPanel } from './FindingsPanel'
import { REQUIREMENT_CHART_TABS } from './chart-tabs'
import { CANVAS_ZOOM_MAX, CANVAS_ZOOM_MIN, formatCanvasZoom, stepCanvasZoom } from './canvas-zoom'

/** 窄于该宽度时结论面板默认收起。 */
const PANEL_DEFAULT_MIN_WIDTH = 1024

type ChartCanvasModalProps = {
  open: boolean
  onClose: () => void
  title: string
  tree: RequirementNode
  findings: Finding[]
  findingCounts: Map<string, number>
  nodeTitles: Map<string, string>
  chartType: RequirementChartType
  onChartTypeChange: (type: RequirementChartType) => void
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  activeFindingId: string | null
  onSelectFinding: (finding: Finding) => void
  onExportError?: (message: string) => void
}

/**
 * 图表画布：全屏只读阅览工作区。
 * 复用结果页的 MindMapView / TreeChartView / FindingsPanel，
 * 缩放直接驱动渲染器原生能力（markmap d3-zoom / ECharts roam），无编辑能力。
 * ESC 或关闭按钮退出；退出后结果页状态（选中节点、图表类型）由共享 state 自然保留。
 */
export function ChartCanvasModal(props: ChartCanvasModalProps) {
  const [panelOpen, setPanelOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= PANEL_DEFAULT_MIN_WIDTH,
  )
  const [zoomRatio, setZoomRatio] = useState(1)
  const [exporting, setExporting] = useState(false)
  const chartHandleRef = useRef<ChartCanvasHandle | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  // 打开时焦点进入关闭按钮（附近即工具栏末尾）；
  // 父组件常驻挂载本组件（非条件挂载），需随 open 变化触发，空依赖只在首次挂载执行会导致永不聚焦。
  useEffect(() => {
    if (!props.open) return
    closeButtonRef.current?.focus()
  }, [props.open])

  // 切换图表类型：渲染期同步重置缩放显示（新图表挂载即初始 fit，缩放状态不跨类型记忆）
  const [lastChartType, setLastChartType] = useState(props.chartType)
  if (lastChartType !== props.chartType) {
    setLastChartType(props.chartType)
    setZoomRatio(1)
  }

  const handleZoomScaleChange = useCallback((ratio: number) => {
    if (Number.isFinite(ratio) && ratio > 0) setZoomRatio(ratio)
  }, [])

  const handleStepZoom = (direction: 'in' | 'out') => {
    const handle = chartHandleRef.current
    if (!handle) return
    // 滚轮/roam 可超出步进区间 [MIN, MAX]：越界后同向步进会被钳回边界，导致"点放大反而缩小"
    if (direction === 'in' && zoomRatio >= CANVAS_ZOOM_MAX) return
    if (direction === 'out' && zoomRatio <= CANVAS_ZOOM_MIN) return
    const next = stepCanvasZoom(zoomRatio, direction)
    if (next === zoomRatio) return
    // 渲染器缩放是相对增量，传入目标/当前的倍率；显示值由 onZoomScaleChange 回报更新
    handle.zoomBy(next / zoomRatio)
  }

  const handleFit = useCallback(async () => {
    await chartHandleRef.current?.fit()
  }, [])

  const handleExportPng = async () => {
    if (exporting) return
    setExporting(true)
    try {
      // 先回到适应屏幕状态，保证导出物是完整树而非当前视口截图
      await chartHandleRef.current?.fit()
      const dataUrl = await chartHandleRef.current?.getPngDataUrl()
      if (!dataUrl) throw new Error('当前图表暂不支持导出 PNG。')
      downloadDataUrl(dataUrl, `${props.title || '需求分析'}.png`)
    } catch (err) {
      props.onExportError?.(err instanceof Error ? err.message : '导出 PNG 失败，请稍后重试。')
    } finally {
      setExporting(false)
    }
  }

  if (!props.open) return null

  return (
    <ModalPortal onClose={props.onClose} closeOnBackdrop={false} closeOnEscape>
      <div className="requirement-canvas-overlay" role="dialog" aria-modal="true" aria-label="图表画布">
        <header className="requirement-canvas-toolbar">
          <div className="requirement-chart-tabs" role="tablist" aria-label="分析结果图表类型">
            {REQUIREMENT_CHART_TABS.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.type}
                  type="button"
                  role="tab"
                  aria-selected={props.chartType === tab.type}
                  className={`requirement-chart-tab${props.chartType === tab.type ? ' is-active' : ''}`}
                  onClick={() => props.onChartTypeChange(tab.type)}
                >
                  <Icon className="h-3.5 w-3.5" />{tab.label}
                </button>
              )
            })}
          </div>

          <div className="requirement-canvas-toolbar-group">
            <div className="requirement-canvas-zoom" role="group" aria-label="缩放控制">
              <button
                type="button"
                className="requirement-canvas-zoom-btn"
                aria-label="缩小"
                disabled={zoomRatio <= CANVAS_ZOOM_MIN}
                onClick={() => handleStepZoom('out')}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="requirement-canvas-zoom-value" aria-label="当前缩放比例">
                {formatCanvasZoom(zoomRatio)}
              </span>
              <button
                type="button"
                className="requirement-canvas-zoom-btn"
                aria-label="放大"
                disabled={zoomRatio >= CANVAS_ZOOM_MAX}
                onClick={() => handleStepZoom('in')}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="requirement-canvas-zoom-btn"
                aria-label="适应屏幕"
                onClick={() => void handleFit()}
              >
                <Expand className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              className="secondary-action px-3 py-2 text-xs"
              disabled={exporting}
              onClick={() => void handleExportPng()}
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageDown className="h-3.5 w-3.5" />}PNG
            </button>

            <Tooltip content={panelOpen ? '收起结论面板' : '展开结论面板'}>
              <button
                type="button"
                className="icon-action h-8 w-8"
                aria-label={panelOpen ? '收起结论面板' : '展开结论面板'}
                aria-expanded={panelOpen}
                onClick={() => setPanelOpen((current) => !current)}
              >
                {panelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
              </button>
            </Tooltip>

            <Tooltip content="关闭（ESC）">
              <button
                ref={closeButtonRef}
                type="button"
                className="icon-action h-8 w-8"
                aria-label="关闭图表画布"
                onClick={props.onClose}
              >
                <X className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        </header>

        <div className="requirement-canvas-body">
          <div className="requirement-canvas-stage">
            {props.chartType === 'mindmap' && (
              <MindMapView
                ref={chartHandleRef}
                tree={props.tree}
                findingCounts={props.findingCounts}
                selectedNodeId={props.selectedNodeId}
                onSelectNode={props.onSelectNode}
                onZoomScaleChange={handleZoomScaleChange}
              />
            )}
            {props.chartType === 'tree' && (
              <TreeChartView
                ref={chartHandleRef}
                tree={props.tree}
                findingCounts={props.findingCounts}
                selectedNodeId={props.selectedNodeId}
                onSelectNode={props.onSelectNode}
                orientation="TB"
                onZoomScaleChange={handleZoomScaleChange}
              />
            )}
            {props.chartType === 'logic' && (
              <TreeChartView
                ref={chartHandleRef}
                tree={props.tree}
                findingCounts={props.findingCounts}
                selectedNodeId={props.selectedNodeId}
                onSelectNode={props.onSelectNode}
                orientation="LR"
                onZoomScaleChange={handleZoomScaleChange}
              />
            )}
          </div>

          {panelOpen && (
            <div className="requirement-canvas-panel">
              <FindingsPanel
                findings={props.findings}
                nodeTitles={props.nodeTitles}
                activeFindingId={props.activeFindingId}
                selectedNodeId={props.selectedNodeId}
                onSelectFinding={props.onSelectFinding}
              />
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}
