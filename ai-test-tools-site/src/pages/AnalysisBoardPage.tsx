import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  getSessionFile,
  getLibraryFile,
  updateSessionFileBoard,
  updateLibraryFileBoard,
  type SessionFile,
  type LibraryFile,
} from '../features/requirement-analysis/chat/chat-api'
import type { BoardChartKind } from '../lib/requirement-analysis-api'
import { loadStoredModelConfig } from '../lib/model-config-store'
import { getPreferredAiConfig } from '../shared/api-types'
import {
  buildFreeMindXml,
  buildMarkdownOutline,
  downloadTextFile,
} from '../lib/requirement-export'
import { REQUIREMENT_HANDOFF_KEY } from '../lib/requirement-analysis-api'
import type { RequirementAnalysisResult, RequirementNode } from '../lib/requirement-analysis-api'
import { AnalysisBoard } from '../features/requirement-analysis/AnalysisBoard'
import { useBoardPersistence } from '../features/requirement-analysis/board/useBoardPersistence'
import { deserializeBoard, emptyBoard, serializeBoard } from '../features/requirement-analysis/board/persistence'
import { buildMindmapRefElement, draftToElement } from '../features/requirement-analysis/board/ai'
import { deriveDecisionTable, decisionTableToSkeleton, orthogonalToSkeleton, serializeSkeletons, selectOrthogonalArray } from '../features/requirement-analysis/board/derive'
import type { Board, BoardElement } from '../features/requirement-analysis/board/types'
import { BOARD_LIMITS } from '../features/requirement-analysis/board/types'

/**
 * 分析画板页（双来源改造）：
 * - /requirement-analysis/board/:id?from=library 打开文件库文件
 * - /requirement-analysis/board/:id 默认打开会话文件
 * 两种来源分别加载、持久化；title 用文件 title，id 用文件 id。
 */
export function AnalysisBoardPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const fromLibrary = searchParams.get('from') === 'library'
  const navigate = useNavigate()
  const [file, setFile] = useState<SessionFile | LibraryFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [boardError, setBoardError] = useState<string | null>(null)

  const fileTitle = file?.title ?? ''

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const loader = fromLibrary ? getLibraryFile(id) : getSessionFile(id)
    loader
      .then((data) => {
        if (cancelled) return
        setFile(data)
        const fileKind = data.kind ?? 'mindmap'
        const payload = isRecord(data.payload) ? data.payload : {}
        const boardRaw = payload.board
        const treeRaw = payload.tree
        const draftRaw = payload.draft
        const parsed = deserializeBoard(boardRaw)
        if (parsed) {
          setBoard(parsed)
        } else if (isTreeNode(treeRaw)) {
          const initial = {
            ...emptyBoard(),
            elements: [buildMindmapRefElement(treeRaw, 40, 40)],
          }
          setBoard(initial)
        } else if (isRecord(draftRaw) && isChartKind(fileKind)) {
          const element = draftToElement(draftRaw, fileKind as BoardChartKind, null, emptyBoard())
          const initial = { ...emptyBoard(), elements: [element] }
          setBoard(initial)
        } else {
          const initial = emptyBoard()
          setBoard(initial)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '获取文件失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, fromLibrary])

  const result = useMemo<RequirementAnalysisResult | null>(() => {
    if (!file) return null
    const payload = isRecord(file.payload) ? file.payload : {}
    const tree = isTreeNode(payload.tree)
      ? payload.tree
      : { id: 'root', title: file.title, children: [] }
    const findings = Array.isArray(payload.findings) ? payload.findings : []
    const sourceText = typeof payload.sourceText === 'string' ? payload.sourceText : ''
    return {
      title: file.title,
      tree,
      findings,
      sourceText,
      truncated: false,
      warnings: [],
    }
  }, [file])

  const handleBoardChange = useCallback((next: Board) => {
    setBoard(next)
  }, [])

  const saveFn = useCallback(
    async (board: Board) => {
      if (!id) return
      const serialized = serializeBoard(board)
      if (fromLibrary) {
        await updateLibraryFileBoard(id, { board: serialized })
      } else {
        await updateSessionFileBoard(id, { board: serialized })
      }
    },
    [id, fromLibrary],
  )

  const { saveError } = useBoardPersistence(saveFn, board ?? emptyBoard())
  const mergedError = boardError || saveError

  const handleBack = useCallback(() => {
    navigate(fromLibrary ? '/requirement-analysis/library' : '/requirement-analysis')
  }, [navigate, fromLibrary])

  /** 画板文件导出（XMind/FreeMind/Markdown）。 */
  const handleExportFile = useCallback(
    async (kind: 'xmind' | 'freemind' | 'markdown') => {
      if (!result) return
      setBoardError(null)
      try {
        const title = fileTitle || result.title || '需求分析'
        if (kind === 'xmind') {
          await exportRequirementXmind({ title, tree: result.tree, findings: result.findings, chartType: 'tree' })
        } else if (kind === 'freemind') {
          downloadTextFile(buildFreeMindXml(result), `${title}.mm`, 'text/xml')
        } else if (kind === 'markdown') {
          downloadTextFile(buildMarkdownOutline(result), `${title}.md`, 'text/markdown')
        }
      } catch (err) {
        setBoardError(err instanceof Error ? err.message : '导出失败，请稍后重试。')
      }
    },
    [result, fileTitle],
  )

  /** AI 生成图表草稿：双来源下禁用，保留会话文件来源时才可用。 */
  const handleGenerateChart = useCallback(
    async (chartKind: BoardChartKind, nodeId: string) => {
      if (!id) throw new Error('缺少文件 id')
      if (fromLibrary) throw new Error('请在会话中生成新图表')
      const { generateBoardChart } = await import('../lib/requirement-analysis-api')
      const provider = loadStoredModelConfig()
      const aiConfig = provider ? getPreferredAiConfig(provider) : null
      if (!aiConfig) throw new Error('请先在模型设置中配置统一供应商，再使用 AI 生成。')
      return generateBoardChart(id, { nodeId, chartKind }, aiConfig)
    },
    [id, fromLibrary],
  )

  /** 画板内 toolbar 动作：推导判定表、重新生成正交表。 */
  const handleDerive = useCallback(
    async (action: 'derive-decision-table' | 'regenerate-array' | 'edit-factor', elementId: string) => {
      if (!result) return
      setBoardError(null)
      try {
        if (action === 'regenerate-array') {
          setBoard((prev) => {
            if (!prev) return prev
            const element = prev.elements.find((e) => e.id === elementId)
            if (!element || element.kind !== 'decision-table') return prev
            if (prev.elements.length >= BOARD_LIMITS.MAX_ELEMENTS) {
              setBoardError('白板图元数量已达上限（50）')
              return prev
            }
            const factors = element.conditions.map((name) => ({ name, levels: ['是', '否'] }))
            if (factors.length === 0) {
              setBoardError('判定表没有条件，无法生成正交表')
              return prev
            }
            const selected = selectOrthogonalArray(factors)
            if ('error' in selected) {
              setBoardError(selected.error)
              return prev
            }
            const placed: BoardElement = {
              id: crypto.randomUUID(),
              kind: 'orthogonal',
              x: element.x + element.w + 40,
              y: element.y,
              w: 400,
              h: 240,
              sourceNodeId: element.sourceNodeId,
              factors,
              arrayName: selected.name,
              rows: selected.rows,
            }
            return { ...prev, elements: [...prev.elements, placed] }
          })
        } else {
          setBoard((prev) => {
            if (!prev) return prev
            const element = prev.elements.find((e) => e.id === elementId)
            if (!element) return prev

            if (prev.elements.length >= BOARD_LIMITS.MAX_ELEMENTS) {
              setBoardError('白板图元数量已达上限（50）')
              return prev
            }

            if (action === 'derive-decision-table' && element.kind === 'cause-effect') {
              const derived = deriveDecisionTable(element)
              if ('error' in derived) {
                setBoardError(derived.error ?? '推导判定表失败')
                return prev
              }
              if (derived.rules.length === 0 || (derived.conditions.length === 0 && derived.actions.length === 0)) {
                setBoardError('因果图没有可推导的内容')
                return prev
              }
              const placed: BoardElement = { ...derived, id: crypto.randomUUID(), x: element.x + element.w + 40, y: element.y }
              return { ...prev, elements: [...prev.elements, placed] }
            }

            return prev
          })
        }
      } catch (err) {
        setBoardError(err instanceof Error ? err.message : '推导失败，请稍后重试。')
      }
    },
    [result],
  )

  /** 用例接力：收集判定表/正交表骨架，拼接 sourceText 后写入 localStorage。 */
  const handleHandoff = useCallback(() => {
    if (!result) return
    const skeletons = board?.elements
      ? board.elements.flatMap((el) => {
          if (el.kind === 'decision-table') return decisionTableToSkeleton(el)
          if (el.kind === 'orthogonal') return orthogonalToSkeleton(el)
          return []
        })
      : []
    const title = fileTitle || result.title || '需求分析'
    const requirement =
      skeletons.length > 0 ? `${result.sourceText}\n\n${serializeSkeletons(title, skeletons)}` : result.sourceText
    localStorage.setItem(
      REQUIREMENT_HANDOFF_KEY,
      JSON.stringify({
        requirement,
        name: title,
      }),
    )
    navigate('/testcase')
  }, [board, navigate, result, fileTitle])

  if (loading) {
    return (
      <div className="page-shell flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p>正在加载分析画板…</p>
      </div>
    )
  }

  if (loadError || !result || !board) {
    return (
      <div className="page-shell flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-danger" role="alert">
          {loadError ?? '未找到该文件。'}
        </p>
        <button type="button" className="secondary-action px-4 py-2.5 text-sm" onClick={handleBack}>
          返回
        </button>
      </div>
    )
  }

  return (
    <AnalysisBoard
      recordName={fileTitle}
      recordId={id ?? ''}
      result={result}
      board={board}
      onBoardChange={handleBoardChange}
      onHandoff={handleHandoff}
      onExportFile={handleExportFile}
      onExportError={setBoardError}
      error={mergedError}
      onBack={handleBack}
      onGenerateChart={fromLibrary ? undefined : handleGenerateChart}
      onDerive={handleDerive}
      libraryBadge={fromLibrary}
    />
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTreeNode(value: unknown): value is RequirementNode {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.title === 'string' && Array.isArray(value.children)
}

function isChartKind(value: string): value is BoardChartKind {
  return value === 'cause-effect' || value === 'decision-table' || value === 'orthogonal' || value === 'flowchart'
}

async function exportRequirementXmind(args: { title: string; tree: RequirementNode; findings: unknown[]; chartType: 'tree' }) {
  const { exportRequirementXmind: impl } = await import('../lib/requirement-analysis-api')
  return (impl as (args: { title: string; tree: RequirementNode; findings: unknown[]; chartType: 'tree' }) => Promise<void>)(args)
}
