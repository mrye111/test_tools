import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Binary,
  Copy,
  Download,
  Expand,
  GitGraph,
  Hand,
  LayoutTemplate,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Share2,
  Table2,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { RequirementAnalysisResult, BoardChartKind } from '../../lib/requirement-analysis-api'
import { MenuButton } from '../../components/ui/MenuButton'
import { Tooltip } from '../../components/ui/Tooltip'
import { BoardFlow, type BoardFlowHandle } from './board/rf/BoardFlow'
import type { BoardGraph, BoardViewport } from './board/rf/rf-types'
import {
  buildMindmapRefNode,
  countElements,
  createPendingNode,
  draftToRfGraph,
  markPendingNodeError,
} from './board/rf/rf-graph'
import { TemplateCenterModal } from './TemplateCenterModal'
import type { BoardTemplate } from './templates'
import { BOARD_LIMITS } from './board/types'
import { BOARD_ZOOM_MAX, BOARD_ZOOM_MIN, formatZoom, stepZoom } from './board/viewport'
import { emptyBoard } from './board/persistence'

/** 导出格式：文件类由父级处理；PNG 离屏渲染随旧引擎下线（移入二期，见地图 #13 雾里区域）。 */
type ExportKind = 'xmind' | 'freemind' | 'markdown'

export type AnalysisBoardProps = {
  recordName: string
  recordId: string
  result: RequirementAnalysisResult
  graph: BoardGraph
  onGraphChange: (graph: BoardGraph) => void
  viewport?: BoardViewport
  onViewportChange?: (viewport: BoardViewport) => void
  onHandoff: () => void
  onExportFile: (kind: ExportKind) => Promise<void>
  onExportError: (message: string) => void
  error: string | null
  onBack: () => void
  /** 文件库来源时展示徽标。 */
  libraryBadge?: boolean
  /** 插入图表时请求 AI 生成草稿（由 AnalysisBoardPage 提供并调用 generateBoardChart）。 */
  onGenerateChart?: (chartKind: BoardChartKind, nodeId: string) => Promise<unknown>
  /** 画板内 toolbar 动作：derive-decision-table / regenerate-array。 */
  onDerive?: (action: 'derive-decision-table' | 'regenerate-array', elementId: string) => void
}

const EXPORT_OPTIONS: Array<{ value: ExportKind; label: string }> = [
  { value: 'xmind', label: 'XMind' },
  { value: 'freemind', label: 'FreeMind' },
  { value: 'markdown', label: 'Markdown' },
]

/** 左栏工具项。 */
type ToolKey = 'select' | 'pan' | 'cause-effect' | 'decision-table' | 'orthogonal'

const RAIL_TOOLS: Array<{ key: ToolKey; icon: typeof MousePointer2; label: string; insert?: BoardChartKind }> = [
  { key: 'select', icon: MousePointer2, label: '选择' },
  { key: 'pan', icon: Hand, label: '手型' },
  { key: 'cause-effect', icon: GitGraph, label: '因果图', insert: 'cause-effect' },
  { key: 'decision-table', icon: Table2, label: '判定表', insert: 'decision-table' },
  { key: 'orthogonal', icon: Binary, label: '正交表', insert: 'orthogonal' },
]

function findNodeById(node: RequirementAnalysisResult['tree'], id: string): RequirementAnalysisResult['tree'] | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findNodeById(child, id)
    if (found) return found
  }
  return null
}

/** 选中集合里的首个指定 kind 图元 id（CE 组归 groupId，单节点归自身） */
function firstSelectedOfKind(graph: BoardGraph, selection: ReadonlySet<string>, kind: 'cause-effect' | 'decision-table' | 'orthogonal'): string | null {
  for (const node of graph.nodes) {
    const d = node.data
    if (kind === 'cause-effect' && d.kind === 'ce-node' && selection.has(d.groupId)) return d.groupId
    if (kind === 'decision-table' && d.kind === 'decision-table' && selection.has(node.id)) return node.id
    if (kind === 'orthogonal' && d.kind === 'orthogonal' && selection.has(node.id)) return node.id
  }
  return null
}

/**
 * 分析画板：测试设计白板入口。
 * 中央为 BoardFlow（React Flow），控件全部悬浮：左上胶囊、右上生成用例、左侧可收缩工具栏、右下缩放条。
 */
export function AnalysisBoard(props: AnalysisBoardProps) {
  const {
    result,
    graph,
    onGraphChange,
    viewport,
    onViewportChange,
    recordName,
    recordId,
    onHandoff,
    onExportFile,
    onExportError,
    error,
    onBack,
    onGenerateChart,
    onDerive,
    libraryBadge,
  } = props

  const [railExpanded, setRailExpanded] = useState(false)
  const [templateCenterOpen, setTemplateCenterOpen] = useState(false)
  const [zoomRatio, setZoomRatio] = useState(1)
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [activeTool, setActiveTool] = useState<ToolKey>('select')
  const [generating, setGenerating] = useState<BoardChartKind | null>(null)
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  const flowRef = useRef<BoardFlowHandle | null>(null)

  // AI 异步回写期间 graph 可能已被用户改动，经 ref 取最新图
  const graphRef = useRef(graph)
  useEffect(() => {
    graphRef.current = graph
  }, [graph])

  const selectedNodeId =
    (graph.nodes.find((n) => n.data.kind === 'mindmap-ref')?.data as { selectedNodeId: string | null } | undefined)
      ?.selectedNodeId ?? null

  // ESC 退出画板；模板中心打开时由弹窗自己处理 ESC。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !templateCenterOpen) onBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [templateCenterOpen, onBack])

  const handleZoomScaleChange = useCallback((ratio: number) => {
    if (Number.isFinite(ratio) && ratio > 0) setZoomRatio(ratio)
  }, [])

  const handleStepZoom = (direction: 'in' | 'out') => {
    const handle = flowRef.current
    if (!handle) return
    if (direction === 'in' && zoomRatio >= BOARD_ZOOM_MAX) return
    if (direction === 'out' && zoomRatio <= BOARD_ZOOM_MIN) return
    const next = stepZoom(zoomRatio, direction)
    if (next === zoomRatio) return
    handle.zoomBy(next / zoomRatio)
  }

  const handleFit = useCallback(() => {
    flowRef.current?.fit()
  }, [])

  const handleExport = async (kind: ExportKind) => {
    if (exporting) return
    setExporting(kind)
    try {
      await onExportFile(kind)
    } catch (err) {
      onExportError(err instanceof Error ? err.message : '导出失败，请稍后重试。')
    } finally {
      setExporting(null)
    }
  }

  const showWarningBanner = !bannerDismissed && result.warnings.length > 0

  /** 左栏插入图表：先占位节点，再 AI 生成，成功替换为真实图元，失败变错误节点。 */
  const handleInsertChart = useCallback(
    async (chartKind: BoardChartKind) => {
      if (!selectedNodeId) return
      if (generating) return
      if (!onGenerateChart) return
      const sourceNode = findNodeById(result.tree, selectedNodeId)
      if (!sourceNode) return
      if (countElements(graph) >= BOARD_LIMITS.MAX_ELEMENTS) {
        onExportError('画板图元数量已达上限')
        return
      }
      setGenerating(chartKind)
      const pending = createPendingNode(chartKind, selectedNodeId)
      onGraphChange({ nodes: [...graph.nodes, pending], edges: graph.edges })
      try {
        const draft = await onGenerateChart(chartKind, selectedNodeId)
        // draftToElement 的落位避让基于旧 Board 模型；本票以空板落位（40,40），#16 迁移时统一改造
        const generated = draftToRfGraph(draft, chartKind, selectedNodeId, emptyBoard())
        const current = graphRef.current
        onGraphChange({
          nodes: [...current.nodes.filter((n) => n.id !== pending.id), ...generated.nodes],
          edges: [...current.edges, ...generated.edges],
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : '生成失败，请稍后重试'
        const current = graphRef.current
        onGraphChange({
          nodes: current.nodes.map((n) => (n.id === pending.id ? markPendingNodeError(n, message) : n)),
          edges: current.edges,
        })
      } finally {
        setGenerating(null)
      }
    },
    [selectedNodeId, generating, result.tree, onExportError, onGenerateChart, graph, onGraphChange],
  )

  /** 重试错误节点。 */
  const handleRetryPending = useCallback(
    async (nodeId: string) => {
      const node = graphRef.current.nodes.find((n) => n.id === nodeId)
      if (!node || node.data.kind !== 'chart-pending') return
      const { chartKind, sourceNodeId } = node.data
      if (!sourceNodeId || !onGenerateChart) return
      setGenerating(chartKind)
      const current = graphRef.current
      onGraphChange({
        nodes: current.nodes.map((n) =>
          n.id === nodeId && n.data.kind === 'chart-pending'
            ? { ...n, data: { ...n.data, error: undefined } }
            : n,
        ),
        edges: current.edges,
      })
      try {
        const draft = await onGenerateChart(chartKind, sourceNodeId)
        const generated = draftToRfGraph(draft, chartKind, sourceNodeId, emptyBoard())
        const latest = graphRef.current
        onGraphChange({
          nodes: [...latest.nodes.filter((n) => n.id !== nodeId), ...generated.nodes],
          edges: [...latest.edges, ...generated.edges],
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : '生成失败，请稍后重试'
        const latest = graphRef.current
        onGraphChange({
          nodes: latest.nodes.map((n) => (n.id === nodeId ? markPendingNodeError(n, message) : n)),
          edges: latest.edges,
        })
      } finally {
        setGenerating(null)
      }
    },
    [onGenerateChart, onGraphChange],
  )

  /** 删除占位/错误节点。 */
  const handleDeletePending = useCallback(
    (nodeId: string) => {
      const current = graphRef.current
      onGraphChange({
        nodes: current.nodes.filter((n) => n.id !== nodeId),
        edges: current.edges,
      })
    },
    [onGraphChange],
  )

  /** mindmap 子节点点选：写回节点 data.selectedNodeId */
  const handleSelectMindmapNode = useCallback(
    (mindmapNodeId: string, requirementNodeId: string | null) => {
      const current = graphRef.current
      onGraphChange({
        nodes: current.nodes.map((n) =>
          n.id === mindmapNodeId && n.data.kind === 'mindmap-ref'
            ? { ...n, data: { ...n.data, selectedNodeId: requirementNodeId } }
            : n,
        ),
        edges: current.edges,
      })
    },
    [onGraphChange],
  )

  /** 选中集删除（工具栏按钮；键盘删除由 RF deleteKeyCode 处理） */
  const handleDeleteSelection = useCallback(() => {
    if (selection.size === 0) return
    const current = graphRef.current
    const removedIds = new Set(
      current.nodes
        .filter((n) => {
          const d = n.data
          const key = d.kind === 'ce-node' || d.kind === 'flowchart-node' ? d.groupId : n.id
          return selection.has(key)
        })
        .map((n) => n.id),
    )
    onGraphChange({
      nodes: current.nodes.filter((n) => !removedIds.has(n.id)),
      edges: current.edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target)),
    })
    setSelection(new Set())
  }, [selection, onGraphChange])

  /** 复制选中（粘贴由 BoardFlow 的 Ctrl+V 监听完成） */
  const handleCopySelection = useCallback(() => {
    const current = graphRef.current
    const selected = current.nodes.filter((n) => {
      const d = n.data
      const key = d.kind === 'ce-node' || d.kind === 'flowchart-node' ? d.groupId : n.id
      return selection.has(key)
    })
    if (selected.length === 0) return
    const selectedIds = new Set(selected.map((n) => n.id))
    ;(window as unknown as Record<string, unknown>).__rfBoardClipboard = {
      nodes: selected,
      edges: current.edges.filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target)),
    }
  }, [selection])

  /** 画板内 toolbar 动作：推导判定表 / 重新生成正交表。 */
  const handleToolbarDerive = useCallback(
    (action: 'derive-decision-table' | 'regenerate-array') => {
      if (!onDerive) return
      if (action === 'derive-decision-table') {
        const groupId = firstSelectedOfKind(graph, selection, 'cause-effect')
        if (groupId) onDerive('derive-decision-table', groupId)
      } else {
        const dtId = firstSelectedOfKind(graph, selection, 'decision-table')
        if (dtId) onDerive('regenerate-array', dtId)
      }
    },
  [graph, selection, onDerive],
  )

  /** 模板中心使用模板：测试设计图表复用 handleInsertChart，思维导图直接插入参考节点。 */
  const handleUseTemplate = useCallback(
    async (template: BoardTemplate) => {
      const chartKind = template.chartKind
      if (!chartKind) return

      if (countElements(graph) >= BOARD_LIMITS.MAX_ELEMENTS) {
        onExportError('画板图元数量已达上限')
        return
      }

      if (chartKind === 'mindmap') {
        const node = buildMindmapRefNode(result.tree, 40, 40)
        onGraphChange({ nodes: [...graph.nodes, node], edges: graph.edges })
        return
      }

      await handleInsertChart(chartKind)
    },
    [result.tree, graph, handleInsertChart, onExportError, onGraphChange],
  )

  const hasCeSelected = firstSelectedOfKind(graph, selection, 'cause-effect') !== null
  const hasDtSelected = firstSelectedOfKind(graph, selection, 'decision-table') !== null

  const railTool = (
    <button
      type="button"
      className="analysis-board-rail-btn"
      aria-label="插入模板"
      onClick={() => setTemplateCenterOpen(true)}
    >
      <LayoutTemplate className="h-4 w-4" />
      {railExpanded && <span>插入模板</span>}
    </button>
  )

  return (
    <div className="analysis-board" role="region" aria-label="分析画板" data-record-id={recordId}>
      <div className="analysis-board-capsule">
        <Tooltip content="返回列表">
          <button
            type="button"
            className="analysis-board-capsule-btn"
            aria-label="返回列表"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Tooltip>
        <div className="analysis-board-capsule-divider" role="separator" />
        <div className="analysis-board-title" title={recordName}>
          {recordName || result.title || '需求分析'}
        </div>
        {libraryBadge && (
          <span className="analysis-board-library-badge" aria-label="文件库副本">
            文件库副本
          </span>
        )}
        <div className="analysis-board-capsule-divider" role="separator" />
        <Tooltip content={exporting ? '导出中…' : '导出'}>
          <MenuButton
            options={EXPORT_OPTIONS}
            onSelect={(value) => void handleExport(value as ExportKind)}
            ariaLabel="导出"
            menuMinWidth={160}
          >
            <Download className="h-4 w-4" />
          </MenuButton>
        </Tooltip>
      </div>

      <div className="analysis-board-capsule analysis-board-capsule-right">
        <Tooltip content="基于此需求生成测试用例" placement="left">
          <button
            type="button"
            className="analysis-board-capsule-btn is-primary"
            aria-label="基于此需求生成测试用例"
            onClick={onHandoff}
          >
            <Share2 className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {(showWarningBanner || error) && (
        <div className="analysis-board-banners">
          {error && (
            <p className="analysis-board-banner analysis-board-banner-error" role="alert">
              {error}
            </p>
          )}
          {showWarningBanner && (
            <div className="analysis-board-banner analysis-board-banner-warning">
              <ul>
                {result.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
              <button
                type="button"
                className="analysis-board-banner-close"
                aria-label="关闭警告提示"
                onClick={() => setBannerDismissed(true)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="analysis-board-body">
        <div className={`analysis-board-rail${railExpanded ? ' is-expanded' : ''}`}>
          {RAIL_TOOLS.map((tool) => {
            const Icon = tool.icon
            const isInsert = tool.insert !== undefined
            const disabled = isInsert && (!selectedNodeId || generating !== null || !onGenerateChart)
            const tooltipContent = !onGenerateChart
              ? '请在会话中生成新图表'
              : disabled
                ? '先在需求树中选择一个节点'
                : tool.label
            const button = (
              <button
                key={tool.key}
                type="button"
                className={`analysis-board-rail-btn${activeTool === tool.key ? ' is-active' : ''}`}
                aria-label={tool.label}
                aria-pressed={activeTool === tool.key}
                disabled={disabled}
                onClick={() => {
                  if (tool.insert) {
                    void handleInsertChart(tool.insert)
                  } else {
                    setActiveTool(tool.key)
                  }
                }}
              >
                <Icon className="h-4 w-4" />
                {railExpanded && <span>{tool.label}</span>}
              </button>
            )
            if (!railExpanded) {
              return (
                <Tooltip
                  key={tool.key}
                  content={tooltipContent}
                  placement="right"
                >
                  {button}
                </Tooltip>
              )
            }
            return button
          })}
          {railExpanded ? railTool : <Tooltip content="插入模板" placement="right">{railTool}</Tooltip>}
          <div className="analysis-board-rail-spacer" />
          <Tooltip content={railExpanded ? '收缩工具栏' : '展开工具栏'} placement="right">
            <button
              type="button"
              className="analysis-board-rail-btn"
              aria-label={railExpanded ? '收缩工具栏' : '展开工具栏'}
              aria-expanded={railExpanded}
              onClick={() => setRailExpanded((current) => !current)}
            >
              {railExpanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              {railExpanded && <span>收缩</span>}
            </button>
          </Tooltip>
        </div>

        <div className="analysis-board-stage">
          <BoardFlow
            ref={flowRef}
            graph={graph}
            onGraphChange={onGraphChange}
            viewport={viewport}
            onViewportChange={onViewportChange}
            tree={result.tree}
            onSelectMindmapNode={handleSelectMindmapNode}
            onRetryPending={handleRetryPending}
            onDeletePending={handleDeletePending}
            onSelectionChange={setSelection}
            onZoomChange={handleZoomScaleChange}
          />

          {/* 选中工具栏：derive 动作 + 复制/删除 */}
          {selection.size > 0 && (
            <div className="analysis-board-flow-toolbar" role="toolbar" aria-label="选中操作">
              {hasCeSelected && onDerive && (
                <button type="button" onClick={() => handleToolbarDerive('derive-decision-table')}>
                  推导判定表
                </button>
              )}
              {hasDtSelected && onDerive && (
                <button type="button" onClick={() => handleToolbarDerive('regenerate-array')}>
                  生成正交表
                </button>
              )}
              <Tooltip content="复制（Ctrl+C / Ctrl+V 粘贴）">
                <button type="button" aria-label="复制选中" onClick={handleCopySelection}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip content="删除选中">
                <button type="button" aria-label="删除选中" onClick={handleDeleteSelection}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          )}

          <div className="analysis-board-zoom" role="group" aria-label="缩放控制">
            <button
              type="button"
              className="analysis-board-zoom-btn"
              aria-label="缩小"
              disabled={zoomRatio <= BOARD_ZOOM_MIN}
              onClick={() => handleStepZoom('out')}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="analysis-board-zoom-value" aria-label="当前缩放比例">
              {formatZoom(zoomRatio)}
            </span>
            <button
              type="button"
              className="analysis-board-zoom-btn"
              aria-label="放大"
              disabled={zoomRatio >= BOARD_ZOOM_MAX}
              onClick={() => handleStepZoom('in')}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="analysis-board-zoom-btn"
              aria-label="适应屏幕"
              onClick={handleFit}
            >
              <Expand className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <TemplateCenterModal open={templateCenterOpen} onClose={() => setTemplateCenterOpen(false)} onUseTemplate={handleUseTemplate} />
    </div>
  )
}
