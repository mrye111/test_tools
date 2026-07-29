import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  generateBoardChart,
  getAnalysisRecord,
  exportRequirementXmind,
  REQUIREMENT_HANDOFF_KEY,
  type AnalysisRecord,
  type BoardChartKind,
} from '../lib/requirement-analysis-api'
import { loadStoredModelConfig } from '../lib/model-config-store'
import { getPreferredAiConfig } from '../shared/api-types'
import {
  buildFreeMindXml,
  buildMarkdownOutline,
  downloadTextFile,
} from '../lib/requirement-export'
import { AnalysisBoard } from '../features/requirement-analysis/AnalysisBoard'
import { useBoardPersistence } from '../features/requirement-analysis/board/useBoardPersistence'
import { deserializeBoard, emptyBoard } from '../features/requirement-analysis/board/persistence'
import { buildMindmapRefElement } from '../features/requirement-analysis/board/ai'
import { deriveDecisionTable, decisionTableToSkeleton, orthogonalToSkeleton, serializeSkeletons } from '../features/requirement-analysis/board/derive'
import type { Board, BoardElement } from '../features/requirement-analysis/board/types'
import { BOARD_LIMITS } from '../features/requirement-analysis/board/types'

/**
 * 分析画板页（ADR 0006）：/requirement-analysis/board/:id 独立路由，
 * 按 id 自行拉取分析记录，刷新与 URL 直达均有效。
 * 负责 board 反序列化、空白板自动放入需求树参考图元、持久化、AI 生成调用、导出与用例接力。
 */
export function AnalysisBoardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [record, setRecord] = useState<AnalysisRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [boardError, setBoardError] = useState<string | null>(null)
  const lastBoardRef = useRef<Board | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getAnalysisRecord(id)
      .then((data) => {
        if (cancelled) return
        setRecord(data)
        const parsed = deserializeBoard(data.board)
        if (parsed) {
          setBoard(parsed)
          lastBoardRef.current = parsed
        } else {
          const initial = {
            ...emptyBoard(),
            elements: [buildMindmapRefElement(data.tree, 40, 40)],
          }
          setBoard(initial)
          lastBoardRef.current = initial
        }
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '获取分析记录失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const result = useMemo(
    () =>
      record
        ? {
            title: record.title,
            tree: record.tree,
            findings: record.findings,
            sourceText: record.sourceText,
            truncated: record.truncated,
            warnings: record.warnings,
          }
        : null,
    [record],
  )

  // 将内部 board 变化同步给持久化 hook（board 引用变化触发防抖保存）。
  const handleBoardChange = useCallback((next: Board) => {
    setBoard(next)
  }, [])

  // hook 内部已拦截空 recordId，id 缺失时直接短路不触发保存。
  const { saveError } = useBoardPersistence(id ?? '', board ?? emptyBoard())

  // 持久化失败时作为普通画板错误提示用户，但不再通过额外 effect 设置，避免同步 setState 告警。
  const mergedError = boardError || saveError

  const handleBack = useCallback(() => {
    navigate('/requirement-analysis')
  }, [navigate])

  /** 画板文件导出（XMind/FreeMind/Markdown）。 */
  const handleExportFile = useCallback(async (kind: 'xmind' | 'freemind' | 'markdown') => {
    if (!result || !record) return
    setBoardError(null)
    try {
      const title = record.name || result.title || '需求分析'
      if (kind === 'xmind') {
        await exportRequirementXmind({ title, tree: result.tree, findings: result.findings, chartType: record.chartType })
      } else if (kind === 'freemind') {
        downloadTextFile(buildFreeMindXml(result), `${title}.mm`, 'text/xml')
      } else if (kind === 'markdown') {
        downloadTextFile(buildMarkdownOutline(result), `${title}.md`, 'text/markdown')
      }
    } catch (err) {
      setBoardError(err instanceof Error ? err.message : '导出失败，请稍后重试。')
    }
  }, [record, result])

  /** AI 生成图表草稿。 */
  const handleGenerateChart = useCallback(async (chartKind: BoardChartKind, nodeId: string) => {
    if (!id) throw new Error('缺少记录 id')
    const provider = loadStoredModelConfig()
    const aiConfig = provider ? getPreferredAiConfig(provider) : null
    if (!aiConfig) throw new Error('请先在模型设置中配置统一供应商，再使用 AI 生成。')
    return generateBoardChart(id, { nodeId, chartKind }, aiConfig)
  }, [id])

  /** 画板内 toolbar 动作：推导判定表、重新生成正交表。 */
  const handleDerive = useCallback(async (action: 'derive-decision-table' | 'regenerate-array' | 'edit-factor', elementId: string) => {
    if (!id || !result) return
    setBoardError(null)
    try {
      if (action === 'regenerate-array') {
        const { selectOrthogonalArray } = await import('../features/requirement-analysis/board/derive')
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
            // 创建新图元，置于因果图右侧；持久化由 useBoardPersistence 统一处理
            const placed: BoardElement = { ...derived, id: crypto.randomUUID(), x: element.x + element.w + 40, y: element.y }
            return { ...prev, elements: [...prev.elements, placed] }
          }

          return prev
        })
      }
      // edit-factor 本期暂不处理
    } catch (err) {
      setBoardError(err instanceof Error ? err.message : '推导失败，请稍后重试。')
    }
  }, [id, result])

  /** 用例接力：收集判定表/正交表骨架，拼接 sourceText 后写入 localStorage。 */
  const handleHandoff = useCallback(() => {
    if (!result || !record) return
    const skeletons = board?.elements
      ? board.elements.flatMap((el) => {
          if (el.kind === 'decision-table') return decisionTableToSkeleton(el)
          if (el.kind === 'orthogonal') return orthogonalToSkeleton(el)
          return []
        })
      : []
    const title = record.name || result.title || '需求分析'
    const requirement = skeletons.length > 0
      ? `${result.sourceText}\n\n${serializeSkeletons(title, skeletons)}`
      : result.sourceText
    localStorage.setItem(
      REQUIREMENT_HANDOFF_KEY,
      JSON.stringify({
        requirement,
        name: title,
      }),
    )
    navigate('/testcase')
  }, [board, navigate, record, result])

  if (loading) {
    return (
      <div className="page-shell flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p>正在加载分析画板…</p>
      </div>
    )
  }

  if (loadError || !result || !record || !board) {
    return (
      <div className="page-shell flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-danger" role="alert">{loadError ?? '未找到该分析记录。'}</p>
        <button type="button" className="secondary-action px-4 py-2.5 text-sm" onClick={handleBack}>
          返回分析记录列表
        </button>
      </div>
    )
  }

  return (
    <AnalysisBoard
      recordName={record.name}
      recordId={record.id}
      result={result}
      board={board}
      onBoardChange={handleBoardChange}
      onHandoff={handleHandoff}
      onExportFile={handleExportFile}
      onExportError={setBoardError}
      error={mergedError}
      onBack={handleBack}
      onGenerateChart={handleGenerateChart}
      onDerive={handleDerive}
    />
  )
}
