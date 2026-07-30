import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Binary,
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
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { RequirementAnalysisResult, RequirementNode, BoardChartKind } from '../../lib/requirement-analysis-api'
import { downloadDataUrl } from '../../lib/requirement-export'
import { MenuButton } from '../../components/ui/MenuButton'
import { Tooltip } from '../../components/ui/Tooltip'
import { BoardCanvas, type BoardCanvasHandle } from './board/BoardCanvas'
import { BoardStore } from './board/board-store'
import type { Board, BoardElement, MindmapRefElement } from './board/types'
import { BOARD_LIMITS } from './board/types'
import { removeElements, updateElement } from './board/commands'
import { TemplateCenterModal } from './TemplateCenterModal'
import { BOARD_ZOOM_MAX, BOARD_ZOOM_MIN, formatZoom, stepZoom } from './board/viewport'
import { renderBoard } from './board/renderer'
import { draftToElement } from './board/ai'

/** 导出格式：文件类由父级处理，PNG 由本组件离屏渲染。 */
type ExportKind = 'xmind' | 'freemind' | 'markdown' | 'png'

export type AnalysisBoardProps = {
  recordName: string
  recordId: string
  result: RequirementAnalysisResult
  board: Board
  onBoardChange: (board: Board) => void
  onHandoff: () => void
  onExportFile: (kind: Exclude<ExportKind, 'png'>) => Promise<void>
  onExportError: (message: string) => void
  error: string | null
  onBack: () => void
  /** 文件库来源时展示徽标。 */
  libraryBadge?: boolean
  /** 插入图表时请求 AI 生成草稿（由 AnalysisBoardPage 提供并调用 generateBoardChart）。 */
  onGenerateChart?: (chartKind: BoardChartKind, nodeId: string) => Promise<unknown>
  /** 画板内 toolbar 动作：derive-decision-table / regenerate-array / edit-factor。 */
  onDerive?: (action: 'derive-decision-table' | 'regenerate-array' | 'edit-factor', elementId: string) => void
}

const EXPORT_OPTIONS: Array<{ value: ExportKind; label: string }> = [
  { value: 'png', label: '图片 (PNG)' },
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

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 创建指定图表的占位图元（灰色闪烁骨架，未入命令栈，不触发持久化）。 */
function createPendingElement(kind: BoardChartKind, sourceNodeId: string): BoardElement {
  const base = { id: generateId(), x: 40, y: 40, w: 320, h: 200, sourceNodeId, pending: true }
  if (kind === 'cause-effect') {
    return { ...base, kind: 'cause-effect', nodes: [], edges: [] }
  }
  if (kind === 'decision-table') {
    return { ...base, kind: 'decision-table', conditions: [], actions: [], rules: [] }
  }
  return { ...base, kind: 'orthogonal', factors: [], arrayName: '', rows: [] }
}

/** 将图元标记为错误态。 */
function markAsError(element: BoardElement, message: string): BoardElement {
  return { ...element, pending: undefined, error: message }
}

/** 判断图元是否为占位图元。 */
function isPendingElement(element: BoardElement): boolean {
  return element.pending === true
}

/** 判断图元是否为错误图元。 */
function isErrorElement(element: BoardElement): boolean {
  return element.error !== undefined
}

/** 查找需求节点。 */
function findNodeById(node: RequirementNode, id: string): RequirementNode | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findNodeById(child, id)
    if (found) return found
  }
  return null
}

/**
 * 分析画板：测试设计白板入口。
 * 中央为 BoardCanvas，控件全部悬浮：左上胶囊、右上生成用例、左侧可收缩工具栏、右下缩放条。
 */
export function AnalysisBoard(props: AnalysisBoardProps) {
  const { result, board, onBoardChange, recordName, recordId, onHandoff, onExportFile, onExportError, error, onBack, onGenerateChart, onDerive, libraryBadge } = props

  const [railExpanded, setRailExpanded] = useState(false)
  const [templateCenterOpen, setTemplateCenterOpen] = useState(false)
  const [zoomRatio, setZoomRatio] = useState(1)
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [activeTool, setActiveTool] = useState<ToolKey>('select')
  const [generating, setGenerating] = useState<BoardChartKind | null>(null)
  const canvasRef = useRef<BoardCanvasHandle | null>(null)

  // 内部 store：每个实例对应一份 board，命令执行时通过 onBoardChange 同步给父级持久化。
  // 同时订阅 store 变更以触发本组件重绘（占位/错误卡片、插入按钮禁用态等）。
  const [renderedBoard, setRenderedBoard] = useState(board)
  const [store] = useState(() => new BoardStore(board))

  const selectedNodeId = (renderedBoard.elements.find((el) => el.kind === 'mindmap-ref') as MindmapRefElement | undefined)?.selectedNodeId ?? null

  useEffect(() => {
    const unsubscribe = store.subscribe(() => setRenderedBoard(store.getBoard()))
    return unsubscribe
  }, [store])

  useEffect(() => {
    store.setOnChange(onBoardChange)
  }, [store, onBoardChange])

  useEffect(() => {
    if (store.getBoard() !== board) {
      store.replaceBoard(board)
    }
  }, [store, board])

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
    const handle = canvasRef.current
    if (!handle) return
    if (direction === 'in' && zoomRatio >= BOARD_ZOOM_MAX) return
    if (direction === 'out' && zoomRatio <= BOARD_ZOOM_MIN) return
    const next = stepZoom(zoomRatio, direction)
    if (next === zoomRatio) return
    handle.zoomBy(next / zoomRatio)
  }

  const handleFit = useCallback(async () => {
    await canvasRef.current?.fit()
  }, [])

  /** 离屏渲染白板全部图元，按包围盒 fit 后导出 PNG。 */
  const exportPng = useCallback((): string | null => {
    const elements = store.getBoard().elements
    if (elements.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const el of elements) {
      minX = Math.min(minX, el.x)
      minY = Math.min(minY, el.y)
      maxX = Math.max(maxX, el.x + el.w)
      maxY = Math.max(maxY, el.y + el.h)
    }
    const padding = 40
    const width = Math.max(1, Math.round(maxX - minX + padding * 2))
    const height = Math.max(1, Math.round(maxY - minY + padding * 2))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const viewport = { x: minX - padding, y: minY - padding, zoom: 1 }
    renderBoard(canvas, store.getBoard(), viewport, new Set(), { tree: result.tree })
    return canvas.toDataURL('image/png')
  }, [result.tree, store])

  const handleExport = async (kind: ExportKind) => {
    if (exporting) return
    setExporting(kind)
    try {
      if (kind === 'png') {
        const dataUrl = exportPng()
        if (!dataUrl) throw new Error('当前画板为空，无法导出 PNG。')
        downloadDataUrl(dataUrl, `${recordName || result.title || '需求分析'}.png`)
      } else {
        await onExportFile(kind)
      }
    } catch (err) {
      onExportError(err instanceof Error ? err.message : '导出失败，请稍后重试。')
    } finally {
      setExporting(null)
    }
  }

  const showWarningBanner = !bannerDismissed && result.warnings.length > 0

  /** 左栏插入图表：先占位，再 AI 生成，成功替换并触发持久化，失败变错误卡片。 */
  const handleInsertChart = useCallback(async (chartKind: BoardChartKind) => {
    if (!selectedNodeId) return
    if (generating) return
    if (!onGenerateChart) return
    const sourceNode = findNodeById(result.tree, selectedNodeId)
    if (!sourceNode) return
    if (store.getBoard().elements.length >= BOARD_LIMITS.MAX_ELEMENTS) {
      onExportError('画板图元数量已达上限')
      return
    }
    setGenerating(chartKind)
    const pending = createPendingElement(chartKind, selectedNodeId)
    store.replaceBoard({
      ...store.getBoard(),
      elements: [...store.getBoard().elements, pending],
    })
    try {
      const draft = await onGenerateChart(chartKind, selectedNodeId)
      const element = draftToElement(draft, chartKind, selectedNodeId, store.getBoard())
      const nextElements = store.getBoard().elements.map((el) => (el.id === pending.id ? element : el))
      const nextBoard = { ...store.getBoard(), elements: nextElements }
      store.replaceBoard(nextBoard)
      onBoardChange(nextBoard)
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成失败，请稍后重试'
      const nextElements = store.getBoard().elements.map((el) =>
        el.id === pending.id ? markAsError(el, message) : el
      )
      const nextBoard = { ...store.getBoard(), elements: nextElements }
      store.replaceBoard(nextBoard)
      // 错误态也触发持久化，让用户刷新后仍能看到错误卡片。
      onBoardChange(nextBoard)
    } finally {
      setGenerating(null)
    }
  }, [selectedNodeId, generating, result.tree, onExportError, onGenerateChart, onBoardChange, store])

  /** 重试错误图元。 */
  const handleRetryError = useCallback(async (elementId: string) => {
    const el = store.getBoard().elements.find((e) => e.id === elementId)
    if (!el || !isErrorElement(el)) return
    const chartKind = el.kind as BoardChartKind
    const sourceNodeId = el.sourceNodeId
    if (!sourceNodeId || !onGenerateChart) return
    setGenerating(chartKind)
    try {
      const draft = await onGenerateChart(chartKind, sourceNodeId)
      const element = draftToElement(draft, chartKind, sourceNodeId, store.getBoard())
      const nextElements = store.getBoard().elements.map((e) => (e.id === elementId ? { ...element, id: elementId } : e))
      const nextBoard = { ...store.getBoard(), elements: nextElements }
      store.replaceBoard(nextBoard)
      onBoardChange(nextBoard)
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成失败，请稍后重试'
      store.execute(updateElement(elementId, (e) => markAsError(e, message)))
    } finally {
      setGenerating(null)
    }
  }, [onGenerateChart, onBoardChange, store])

  /** 删除错误/占位图元。 */
  const handleDeleteError = useCallback((elementId: string) => {
    store.execute(removeElements([elementId]))
  }, [store])

  /** 画板内 toolbar 动作：推导判定表、重新生成正交表、编辑因子。 */
  const handleCanvasAction = useCallback((action: 'derive-decision-table' | 'regenerate-array' | 'edit-factor', selection: ReadonlySet<string>) => {
    if (!onDerive) return
    const selected = store.getBoard().elements.filter((e) => selection.has(e.id))
    if (action === 'derive-decision-table') {
      const ce = selected.find((e) => e.kind === 'cause-effect')
      if (ce) onDerive('derive-decision-table', ce.id)
    } else if (action === 'regenerate-array') {
      const dt = selected.find((e) => e.kind === 'decision-table')
      if (dt) onDerive('regenerate-array', dt.id)
    } else if (action === 'edit-factor') {
      const ortho = selected.find((e) => e.kind === 'orthogonal')
      if (ortho) onDerive('edit-factor', ortho.id)
    }
  }, [onDerive, store])

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
            const tooltipContent = !onGenerateChart ? '请在会话中生成新图表' : disabled ? '先在需求树中选择一个节点' : tool.label
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
          <BoardCanvas
            ref={canvasRef}
            store={store}
            tree={result.tree}
            onZoomChange={handleZoomScaleChange}
            onAction={handleCanvasAction}
          />

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
              onClick={() => void handleFit()}
            >
              <Expand className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 占位/错误卡片浮动提示 */}
          {renderedBoard.elements.filter((el) => isPendingElement(el) || isErrorElement(el)).map((el) => {
            const errorMessage = el.error
            return (
              <div
                key={el.id}
                className="analysis-board-pending-card"
                style={{ left: 40, top: 40 + renderedBoard.elements.indexOf(el) * 120 }}
              >
                {errorMessage ? (
                  <>
                    <p role="alert">{errorMessage}</p>
                    <button type="button" onClick={() => void handleRetryError(el.id)}>重试</button>
                    <button type="button" onClick={() => handleDeleteError(el.id)}>删除</button>
                  </>
                ) : (
                  <p>AI 生成中…</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <TemplateCenterModal open={templateCenterOpen} onClose={() => setTemplateCenterOpen(false)} />
    </div>
  )
}
