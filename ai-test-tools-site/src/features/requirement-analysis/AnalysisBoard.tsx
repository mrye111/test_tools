import { useEffect, useState } from 'react'
import { ArrowLeft, Download, X } from 'lucide-react'
import type { RequirementAnalysisResult } from '../../lib/requirement-analysis-api'
import { MenuButton } from '../../components/ui/MenuButton'
import { Tooltip } from '../../components/ui/Tooltip'
import { BoardFlow } from './board/rf/BoardFlow'
import type { BoardGraph, BoardViewport } from './board/rf/rf-types'

/** 导出格式：文件类由父级处理（导出的是分析结果，与画布内容无关）。 */
type ExportKind = 'xmind' | 'freemind' | 'markdown'

export type AnalysisBoardProps = {
  recordName: string
  recordId: string
  result: RequirementAnalysisResult
  graph: BoardGraph
  onGraphChange: (graph: BoardGraph, meta?: { history?: 'commit' | 'transient' | 'silent' }) => void
  viewport?: BoardViewport
  onViewportChange?: (viewport: BoardViewport) => void
  onExportFile: (kind: ExportKind) => Promise<void>
  onExportError: (message: string) => void
  error: string | null
  onBack: () => void
  /** 文件库来源时展示徽标。 */
  libraryBadge?: boolean
  /** 撤销/重做（快照栈） */
  onUndo?: () => void
  onRedo?: () => void
}

const EXPORT_OPTIONS: Array<{ value: ExportKind; label: string }> = [
  { value: 'xmind', label: 'XMind' },
  { value: 'freemind', label: 'FreeMind' },
  { value: 'markdown', label: 'Markdown' },
]

/**
 * 分析画板（纯白板形态，ADR 0010）：
 * 中央为 React Flow 原生画布（Controls/MiniMap/Background），控件仅剩左上胶囊（返回/标题/导出）。
 * 双击空白新增节点，双击节点编辑文案，拖拽连线，Delete 删除，Ctrl+Z 撤销。
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
    onExportFile,
    onExportError,
    error,
    onBack,
    onUndo,
    onRedo,
    libraryBadge,
  } = props

  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // ESC 退出画板
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

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

      <div className="analysis-board-stage analysis-board-stage-plain">
        <BoardFlow
          graph={graph}
          onGraphChange={onGraphChange}
          viewport={viewport}
          onViewportChange={onViewportChange}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      </div>
    </div>
  )
}
