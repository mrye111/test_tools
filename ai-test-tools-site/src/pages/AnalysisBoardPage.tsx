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
import { useGraphHistory } from '../features/requirement-analysis/board/rf/useGraphHistory'
import { deserializeRfBoard, serializeRfBoard } from '../features/requirement-analysis/board/rf/rf-persistence'
import {
  buildMindmapRefNode,
  draftToRfGraph,
  elementToRf,
  emptyGraph,
  nodeToDecisionTableElement,
  nodeToOrthogonalElement,
  reconstructCauseEffectElement,
} from '../features/requirement-analysis/board/rf/rf-graph'
import type { BoardGraph, BoardViewport } from '../features/requirement-analysis/board/rf/rf-types'
import { countElements } from '../features/requirement-analysis/board/rf/rf-graph'
import { deriveDecisionTable, decisionTableToSkeleton, orthogonalToSkeleton, serializeSkeletons, selectOrthogonalArray } from '../features/requirement-analysis/board/derive'
import { emptyBoard } from '../features/requirement-analysis/board/persistence'
import { BOARD_LIMITS } from '../features/requirement-analysis/board/types'

/**
 * 分析画板页（双来源 + React Flow 引擎，地图 #13）：
 * - /requirement-analysis/board/:id?from=library 打开文件库文件
 * - /requirement-analysis/board/:id 默认打开会话文件
 * 画板状态为 RF 图（nodes/edges + viewport），持久化版本 2；旧 version 1 数据读为空画板。
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
        const fileKind = data.kind ?? 'mindmap'
        const payload = isRecord(data.payload) ? data.payload : {}
        const boardRaw = payload.board
        const treeRaw = payload.tree
        const draftRaw = payload.draft
        const parsed = deserializeRfBoard(boardRaw)
        if (parsed) {
          setGraph({ nodes: parsed.nodes, edges: parsed.edges })
          setViewport(parsed.viewport)
        } else if (isTreeNode(treeRaw)) {
          setGraph({ nodes: [buildMindmapRefNode(treeRaw, 40, 40)], edges: [] })
        } else if (isRecord(draftRaw) && isChartKind(fileKind)) {
          setGraph(draftToRfGraph(draftRaw, fileKind, null, emptyBoard()))
        } else {
          setGraph(emptyGraph())
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
        } else {
          downloadTextFile(buildMarkdownOutline(result), `${title}.md`, 'text/markdown')
        }
      } catch (err) {
        setBoardError(err instanceof Error ? err.message : '导出失败，请稍后重试。')
      }
    },
    [result, fileTitle],
  )

  /** AI 生成图表草稿：文件库来源禁用，会话文件来源可用。 */
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

  /** 画板内 toolbar 动作：推导判定表 / 重新生成正交表（derive 逻辑不动，输入从 RF 图重建；变更入历史栈）。 */
  const handleDerive = useCallback(
    (action: 'derive-decision-table' | 'regenerate-array', elementId: string) => {
      const prev = graphRef.current
      if (!prev) return
      if (countElements(prev) >= BOARD_LIMITS.MAX_ELEMENTS) {
        setBoardError('白板图元数量已达上限（50）')
        return
      }

      if (action === 'derive-decision-table') {
        const ce = reconstructCauseEffectElement(prev, elementId)
        if (!ce) return
        const derived = deriveDecisionTable(ce)
        if ('error' in derived) {
          setBoardError(derived.error ?? '推导判定表失败')
          return
        }
        if (derived.rules.length === 0 || (derived.conditions.length === 0 && derived.actions.length === 0)) {
          setBoardError('因果图没有可推导的内容')
          return
        }
        const placed = elementToRf({ ...derived, id: crypto.randomUUID(), x: ce.x + ce.w + 40, y: ce.y })
        handleGraphChange({ nodes: [...prev.nodes, ...placed.nodes], edges: [...prev.edges, ...placed.edges] })
        return
      }

      // regenerate-array：判定表 → 正交表
      const dtNode = prev.nodes.find((n) => n.id === elementId)
      const dt = dtNode ? nodeToDecisionTableElement(dtNode) : null
      if (!dt) return
      const factors = dt.conditions.map((name) => ({ name, levels: ['是', '否'] }))
      if (factors.length === 0) {
        setBoardError('判定表没有条件，无法生成正交表')
        return
      }
      const selected = selectOrthogonalArray(factors)
      if ('error' in selected) {
        setBoardError(selected.error)
        return
      }
      const placed = elementToRf({
        id: crypto.randomUUID(),
        kind: 'orthogonal',
        x: dt.x + 440,
        y: dt.y,
        w: 400,
        h: 240,
        sourceNodeId: dt.sourceNodeId,
        factors,
        arrayName: selected.name,
        rows: selected.rows,
      })
      handleGraphChange({ nodes: [...prev.nodes, ...placed.nodes], edges: [...prev.edges, ...placed.edges] })
    },
    [handleGraphChange],
  )

  /** 用例接力：从 RF 图收集判定表/正交表骨架，拼接 sourceText 后写入 localStorage。 */
  const handleHandoff = useCallback(() => {
    if (!result || !graph) return
    const skeletons = graph.nodes.flatMap((node) => {
      if (node.data.kind === 'decision-table') {
        const el = nodeToDecisionTableElement(node)
        return el ? decisionTableToSkeleton(el) : []
      }
      if (node.data.kind === 'orthogonal') {
        const el = nodeToOrthogonalElement(node)
        return el ? orthogonalToSkeleton(el) : []
      }
      return []
    })
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
  }, [graph, navigate, result, fileTitle])

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
      onHandoff={handleHandoff}
      onExportFile={handleExportFile}
      onExportError={setBoardError}
      error={mergedError}
      onBack={handleBack}
      onGenerateChart={fromLibrary ? undefined : handleGenerateChart}
      onDerive={handleDerive}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
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

function isChartKind(value: string): value is BoardChartKind {
  return value === 'cause-effect' || value === 'decision-table' || value === 'orthogonal' || value === 'flowchart'
}

async function exportRequirementXmind(args: { title: string; tree: RequirementNode; findings: unknown[]; chartType: 'tree' }) {
  const { exportRequirementXmind: impl } = await import('../lib/requirement-analysis-api')
  return (impl as (args: { title: string; tree: RequirementNode; findings: unknown[]; chartType: 'tree' }) => Promise<void>)(args)
}
