import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  buildFreeMindXml,
  buildMarkdownOutline,
  downloadTextFile,
} from '../lib/requirement-export'
import type { RequirementAnalysisResult, RequirementNode } from '../lib/requirement-analysis-api'
import { AnalysisBoard } from '../features/requirement-analysis/AnalysisBoard'
import { useBoardPersistence } from '../features/requirement-analysis/board/useBoardPersistence'
import { useGraphHistory } from '../features/requirement-analysis/board/rf/useGraphHistory'
import { deserializeRfBoard, serializeRfBoard } from '../features/requirement-analysis/board/rf/rf-persistence'
import type { BoardGraph, BoardViewport } from '../features/requirement-analysis/board/rf/rf-types'

const EMPTY_GRAPH: BoardGraph = { nodes: [], edges: [] }

/**
 * 分析画板页（纯白板形态，ADR 0010）：
 * - /requirement-analysis/board/:id?from=library 打开文件库文件
 * - /requirement-analysis/board/:id 默认打开会话文件
 * 画板为 React Flow 通用白板，持久化版本 3；旧版本数据读为空画板（不做迁移）。
 */
export function AnalysisBoardPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const fromLibrary = searchParams.get('from') === 'library'
  const navigate = useNavigate()
  const [file, setFile] = useState<SessionFile | LibraryFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [graph, setGraph] = useState<BoardGraph | null>(null)
  const [viewport, setViewport] = useState<BoardViewport | undefined>(undefined)
  const [boardError, setBoardError] = useState<string | null>(null)
  const history = useGraphHistory()
  const { reset: resetHistory } = history
  // 图镜像 ref：record/undo 需要同步读取最新图，避开 setState 异步
  const graphRef = useRef<BoardGraph | null>(null)
  useEffect(() => {
    graphRef.current = graph
  }, [graph])

  const fileTitle = file?.title ?? ''

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const loader = fromLibrary ? getLibraryFile(id) : getSessionFile(id)
    loader
      .then((data) => {
        if (cancelled) return
        resetHistory()
        setFile(data)
        const payload = isRecord(data.payload) ? data.payload : {}
        const parsed = deserializeRfBoard(payload.board)
        if (parsed) {
          setGraph({ nodes: parsed.nodes, edges: parsed.edges })
          setViewport(parsed.viewport)
        } else {
          // 旧版本/无画板数据：空白板
          setGraph(EMPTY_GRAPH)
          setViewport(undefined)
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
  }, [id, fromLibrary, resetHistory])

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

  const handleGraphChange = useCallback(
    (next: BoardGraph, meta?: { history?: 'commit' | 'transient' | 'silent' }) => {
      const prev = graphRef.current
      if (prev) history.record(prev, meta?.history ?? 'commit')
      setGraph(next)
    },
    [history],
  )

  const handleUndo = useCallback(() => {
    const current = graphRef.current
    if (!current) return
    const snapshot = history.undo(current)
    if (snapshot) setGraph(snapshot)
  }, [history])

  const handleRedo = useCallback(() => {
    const current = graphRef.current
    if (!current) return
    const snapshot = history.redo(current)
    if (snapshot) setGraph(snapshot)
  }, [history])

  const handleViewportChange = useCallback((vp: BoardViewport) => {
    setViewport(vp)
  }, [])

  // moveEnd 才更新 viewport，频率低；与 graph 一起参与防抖保存
  const serialized = useMemo(
    () => (graph ? serializeRfBoard(graph, viewport) : null),
    [graph, viewport],
  )

  const saveFn = useCallback(
    async (snapshot: string) => {
      if (!id) return
      if (fromLibrary) {
        await updateLibraryFileBoard(id, { board: snapshot })
      } else {
        await updateSessionFileBoard(id, { board: snapshot })
      }
    },
    [id, fromLibrary],
  )

  const { saveError } = useBoardPersistence(saveFn, serialized ?? '')
  const mergedError = boardError || saveError

  const handleBack = useCallback(() => {
    navigate(fromLibrary ? '/requirement-analysis/library' : '/requirement-analysis')
  }, [navigate, fromLibrary])

  /** 分析结果文件导出（XMind/FreeMind/Markdown）。 */
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
        } else {
          downloadTextFile(buildMarkdownOutline(result), `${title}.md`, 'text/markdown')
        }
      } catch (err) {
        setBoardError(err instanceof Error ? err.message : '导出失败，请稍后重试。')
      }
    },
    [result, fileTitle],
  )

  if (loading) {
    return (
      <div className="page-shell flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p>正在加载分析画板…</p>
      </div>
    )
  }

  if (loadError || !result || !graph) {
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
      graph={graph}
      onGraphChange={handleGraphChange}
      viewport={viewport}
      onViewportChange={handleViewportChange}
      onExportFile={handleExportFile}
      onExportError={setBoardError}
      error={mergedError}
      onBack={handleBack}
      onUndo={handleUndo}
      onRedo={handleRedo}
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

async function exportRequirementXmind(args: { title: string; tree: RequirementNode; findings: unknown[]; chartType: 'tree' }) {
  const { exportRequirementXmind: impl } = await import('../lib/requirement-analysis-api')
  return (impl as (args: { title: string; tree: RequirementNode; findings: unknown[]; chartType: 'tree' }) => Promise<void>)(args)
}
