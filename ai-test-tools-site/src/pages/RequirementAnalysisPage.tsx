import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileText,
  FolderOpen,
  ImageDown,
  ListTree,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Share2,
  Trash2,
} from 'lucide-react'
import { loadStoredModelConfig } from '../lib/model-config-store'
import { getPreferredAiConfig } from '../shared/api-types'
import {
  analyzeRequirement,
  createAnalysisRecord,
  deleteAnalysisRecord,
  exportRequirementXmind,
  getAnalysisRecord,
  listAnalysisRecords,
  updateAnalysisRecord,
  FINDING_TYPE_META,
  REQUIREMENT_HANDOFF_KEY,
  type AnalysisRecordSummary,
  type AnalysisStage,
  type AnalyzeRequirementInput,
  type Finding,
  type FindingType,
  type RequirementAnalysisResult,
  type RequirementChartType,
  type RequirementNode,
} from '../lib/requirement-analysis-api'
import {
  buildFreeMindXml,
  buildMarkdownOutline,
  downloadDataUrl,
  downloadTextFile,
  findingCountByNode,
} from '../lib/requirement-export'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { ModalShell } from '../components/ui/ModalShell'
import { Tooltip } from '../components/ui/Tooltip'
import { RequirementInput } from '../features/requirement-analysis/RequirementInput'
import { AnalysisProgress } from '../features/requirement-analysis/AnalysisProgress'
import { AnalysisProcessBlocks } from '../features/requirement-analysis/AnalysisProcessBlocks'
import { useAnalysisProcessStream } from '../features/requirement-analysis/useAnalysisProcessStream'
import { MindMapView, type ChartCanvasHandle } from '../features/requirement-analysis/MindMapView'
import { TreeChartView } from '../features/requirement-analysis/TreeChartView'
import { FindingsPanel } from '../features/requirement-analysis/FindingsPanel'
import { ChartCanvasModal } from '../features/requirement-analysis/ChartCanvasModal'
import { REQUIREMENT_CHART_TABS } from '../features/requirement-analysis/chart-tabs'

const RECORDS_PAGE_SIZE = 10

// 结论计数徽章：颜色语义与 FindingsPanel 分组标题一致（风险红 / 歧义橄榄 / 澄清主色）
const FINDING_BADGE_CLASS: Record<FindingType, string> = {
  risk: 'badge badge-danger',
  ambiguity: 'badge border-[oklch(0.48_0.12_85/0.2)] bg-[oklch(0.48_0.12_85/0.1)] text-[oklch(0.48_0.12_85)]',
  clarification: 'badge badge-accent',
}

function indexNodeTitles(tree: RequirementNode): Map<string, string> {
  const index = new Map<string, string>()
  const walk = (node: RequirementNode) => {
    index.set(node.id, node.title)
    node.children.forEach(walk)
  }
  walk(tree)
  return index
}

function buildPageItems(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 9) return Array.from({ length: total }, (_, index) => index + 1)
  const candidates = [1, 2, current - 1, current, current + 1, total - 1, total]
  const pages = [...new Set(candidates.filter((page) => page >= 1 && page <= total))].sort((a, b) => a - b)
  const items: Array<number | 'ellipsis'> = []
  let previous = 0
  for (const page of pages) {
    if (page - previous > 1) items.push('ellipsis')
    items.push(page)
    previous = page
  }
  return items
}

/** YYYY-MM-DD HH:mm；非法日期原样返回。 */
function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 记录命名规则：上传文件取文件名（去扩展名），粘贴文本取首行前 20 字。 */
function recordNameFromInput(input: AnalyzeRequirementInput): string {
  if (input.kind === 'file') {
    const base = input.file.name.replace(/\.[^.]+$/, '').trim()
    return base || input.file.name
  }
  const firstLine = input.text.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  return firstLine.slice(0, 20) || '需求分析'
}

type Phase = 'list' | 'input' | 'analyzing' | 'result'

export function RequirementAnalysisPage() {
  const navigate = useNavigate()
  const { showError } = useErrorDialog()
  // 两层结构：默认 'list'（分析记录列表），'input' 为新建分析视图（ADR 0004）
  const [phase, setPhase] = useState<Phase>('list')
  const [stage, setStage] = useState<AnalysisStage>('parsing')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RequirementAnalysisResult | null>(null)
  const [chartType, setChartType] = useState<RequirementChartType>('mindmap')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null)
  const [showSourceText, setShowSourceText] = useState(false)
  const [showProcess, setShowProcess] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  // 当前结果视图对应的分析记录 id（新建保存成功 / 打开记录后持有）
  const [recordId, setRecordId] = useState<string | null>(null)
  // ── 记录列表 ──
  const [records, setRecords] = useState<AnalysisRecordSummary[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [openingRecordId, setOpeningRecordId] = useState<string | null>(null)
  const [exportingRecordId, setExportingRecordId] = useState<string | null>(null)
  const [renamingRecord, setRenamingRecord] = useState<AnalysisRecordSummary | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deletingRecord, setDeletingRecord] = useState<AnalysisRecordSummary | null>(null)
  const chartRef = useRef<ChartCanvasHandle | null>(null)
  // 图表画布（全屏只读阅览）开关
  const [canvasOpen, setCanvasOpen] = useState(false)
  const {
    blocks: processBlocks,
    handleEvent: handleProcessEvent,
    finish: finishProcess,
    reset: resetProcess,
  } = useAnalysisProcessStream()

  const findingCounts = useMemo(
    () => (result ? findingCountByNode(result.findings) : new Map<string, number>()),
    [result],
  )
  const nodeTitles = useMemo(() => (result ? indexNodeTitles(result.tree) : new Map<string, string>()), [result])

  const recordsPageCount = Math.max(1, Math.ceil(recordsTotal / RECORDS_PAGE_SIZE))
  const safeRecordsPage = Math.min(recordsPage, recordsPageCount)

  const loadRecords = useCallback(async (page: number) => {
    setRecordsLoading(true)
    try {
      const data = await listAnalysisRecords({ page, pageSize: RECORDS_PAGE_SIZE })
      setRecords(data.records)
      setRecordsTotal(data.total)
    } catch (err) {
      showError(err, { title: '加载分析记录失败' })
    } finally {
      setRecordsLoading(false)
    }
  }, [showError])

  useEffect(() => {
    if (phase !== 'list') return
    void loadRecords(recordsPage)
  }, [phase, recordsPage, loadRecords])

  const handleAnalyze = useCallback(async (input: AnalyzeRequirementInput) => {
    const provider = loadStoredModelConfig()
    const aiConfig = provider ? getPreferredAiConfig(provider) : null
    if (!aiConfig) {
      setPhase('analyzing')
      setStage('parsing')
      setWarnings([])
      setError('请先在模型设置中配置统一供应商，再开始需求分析。')
      return
    }

    const recordName = recordNameFromInput(input)
    setPhase('analyzing')
    setStage('parsing')
    setWarnings([])
    setError(null)
    setResult(null)
    setRecordId(null)
    setSelectedNodeId(null)
    setActiveFindingId(null)
    // 新分析回到默认图表类型：chartType 可能被上一次打开的记录改过（handleOpenRecord），
    // 不重置会随 createAnalysisRecord 一起错误入库
    setChartType('mindmap')
    resetProcess()

    try {
      const analysis = await analyzeRequirement(input, aiConfig, async (event) => {
        if (event.type === 'stage') setStage(event.stage)
        if (event.type === 'warning') setWarnings((current) => [...current, ...event.warnings])
        if (event.type === 'error') setError(event.message)
        handleProcessEvent(event)
      })
      finishProcess()
      setResult(analysis)
      setPhase('result')
      // 分析完成自动入库（ADR 0004）：保存失败不阻断进入结果页
      try {
        const record = await createAnalysisRecord({
          name: recordName,
          // 新记录固定以默认图表类型入库（chartType 状态在本闭包内仍是旧值，且可能被打开过的记录污染）
          chartType: 'mindmap',
          title: analysis.title,
          tree: analysis.tree,
          findings: analysis.findings,
          sourceText: analysis.sourceText,
          truncated: analysis.truncated,
          warnings: analysis.warnings,
        })
        setRecordId(record.id)
      } catch (saveError) {
        console.warn('分析记录保存失败', saveError)
      }
    } catch (err) {
      finishProcess()
      setError(err instanceof Error ? err.message : '需求分析失败，请稍后重试。')
    }
  }, [finishProcess, handleProcessEvent, resetProcess])

  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
    setActiveFindingId(null)
  }, [])

  const handleSelectFinding = useCallback((finding: Finding) => {
    setActiveFindingId(finding.id)
    setSelectedNodeId(finding.nodeId)
  }, [])

  useEffect(() => {
    if (!selectedNodeId || activeFindingId || !result) return
    const firstLinked = result.findings.find((finding) => finding.nodeId === selectedNodeId)
    if (firstLinked) {
      document.getElementById(`finding-${firstLinked.id}`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedNodeId, activeFindingId, result])

  // 图表类型切换：已关联记录时回写 chartType（失败静默，本地视图已切换）
  const handleChartTypeChange = useCallback((type: RequirementChartType) => {
    setChartType(type)
    if (recordId) {
      void updateAnalysisRecord(recordId, { chartType: type }).catch(() => {})
    }
  }, [recordId])

  // ── 记录列表操作 ──

  const handleOpenRecord = async (summary: AnalysisRecordSummary) => {
    setOpeningRecordId(summary.id)
    try {
      const record = await getAnalysisRecord(summary.id)
      setResult({
        title: record.title,
        tree: record.tree,
        findings: record.findings,
        sourceText: record.sourceText,
        truncated: record.truncated,
        warnings: record.warnings,
      })
      setChartType(record.chartType)
      setRecordId(record.id)
      setSelectedNodeId(null)
      setActiveFindingId(null)
      setShowSourceText(false)
      setShowProcess(false)
      setError(null)
      setWarnings([])
      resetProcess()
      setPhase('result')
    } catch (err) {
      showError(err, { title: '打开分析记录失败' })
    } finally {
      setOpeningRecordId(null)
    }
  }

  const handleExportRecord = async (summary: AnalysisRecordSummary) => {
    setExportingRecordId(summary.id)
    try {
      const record = await getAnalysisRecord(summary.id)
      await exportRequirementXmind({
        title: record.name || record.title || '需求分析',
        tree: record.tree,
        findings: record.findings,
        chartType: record.chartType,
      })
    } catch (err) {
      showError(err, { title: '导出 XMind 失败' })
    } finally {
      setExportingRecordId(null)
    }
  }

  const openRenameDialog = (summary: AnalysisRecordSummary) => {
    setRenamingRecord(summary)
    setRenameName(summary.name)
  }

  const submitRename = async () => {
    if (!renamingRecord) return
    const name = renameName.trim()
    if (!name) return
    setRenaming(true)
    try {
      await updateAnalysisRecord(renamingRecord.id, { name })
      setRecords((current) => current.map((item) => (item.id === renamingRecord.id ? { ...item, name } : item)))
      setRenamingRecord(null)
    } catch (err) {
      showError(err, { title: '重命名分析记录失败' })
    } finally {
      setRenaming(false)
    }
  }

  const confirmDeleteRecord = async () => {
    if (!deletingRecord) return
    const target = deletingRecord
    try {
      await deleteAnalysisRecord(target.id)
      const remaining = records.filter((item) => item.id !== target.id)
      setDeletingRecord(null)
      if (remaining.length === 0 && recordsPage > 1) {
        // 当前页删空后回退一页，由加载副作用重新拉取
        setRecordsPage((page) => Math.max(1, page - 1))
      } else {
        setRecords(remaining)
        setRecordsTotal((total) => Math.max(0, total - 1))
      }
    } catch (err) {
      showError(err, { title: '删除分析记录失败' })
    }
  }

  const handleExport = async (kind: 'xmind' | 'freemind' | 'markdown' | 'png') => {
    if (!result) return
    setExporting(kind)
    setError(null)
    try {
      const title = result.title || '需求分析'
      if (kind === 'xmind') {
        await exportRequirementXmind({ title, tree: result.tree, findings: result.findings, chartType })
      } else if (kind === 'freemind') {
        downloadTextFile(buildFreeMindXml(result), `${title}.mm`, 'text/xml')
      } else if (kind === 'markdown') {
        downloadTextFile(buildMarkdownOutline(result), `${title}.md`, 'text/markdown')
      } else {
        const dataUrl = await chartRef.current?.getPngDataUrl()
        if (!dataUrl) throw new Error('当前图表暂不支持导出 PNG，请切换图表后重试。')
        downloadDataUrl(dataUrl, `${title}.png`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败，请稍后重试。')
    } finally {
      setExporting(null)
    }
  }

  const handleHandoff = () => {
    if (!result) return
    localStorage.setItem(REQUIREMENT_HANDOFF_KEY, JSON.stringify({
      requirement: result.sourceText,
      name: result.title,
    }))
    navigate('/testcase')
  }

  const resetToInput = () => {
    setPhase('input')
    setError(null)
    setWarnings([])
    setResult(null)
    setRecordId(null)
    setSelectedNodeId(null)
    setActiveFindingId(null)
    resetProcess()
  }

  const backToList = () => {
    // 新记录按 updatedAt 倒序在第 1 页；停留在更靠后的页码会看不到刚创建的记录
    setRecordsPage(1)
    setPhase('list')
  }

  return (
    <div className="page-shell requirement-page">
      <header className="testcase-workspace-header">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="icon-action h-10 w-10 shrink-0 rounded-xl" aria-label="返回首页">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="page-title">需求分析</h1>
            <p className="page-subtitle">上传需求文档或粘贴文本，AI 以测试视角产出需求分解树与分析结论</p>
          </div>
        </div>
        <Link to="/settings" className="secondary-action shrink-0 px-3 py-2 text-xs no-underline">
          <Settings className="h-3.5 w-3.5" />模型设置
        </Link>
      </header>

      {phase === 'list' && (
        <main className="stagger-1">
          {!recordsLoading && recordsTotal === 0 ? (
            <section className="empty-state">
              <div className="empty-state-icon"><ListTree className="h-6 w-6" /></div>
              <div className="empty-state-title">还没有分析记录</div>
              <p className="empty-state-description">上传需求文档或粘贴文本完成一次分析后，结果会自动保存为记录，随时回看与导出。</p>
              <button type="button" className="primary-action mt-6 px-5 py-2.5 text-sm" onClick={() => setPhase('input')}>
                <Plus className="h-4 w-4" />新建分析
              </button>
            </section>
          ) : (
            <section className="testcase-set-panel">
              <div className="testcase-set-toolbar">
                <div className="testcase-set-toolbar-main">
                  <button type="button" onClick={() => setPhase('input')} className="primary-action px-4 py-2.5 text-sm">
                    <Plus className="h-4 w-4" />新建分析
                  </button>
                  <div className="testcase-set-heading">
                    <div className="flex items-center gap-2">
                      <h2>分析记录</h2>
                      <span className="testcase-set-total">{recordsTotal}</span>
                    </div>
                    <p>每次分析完成自动保存，可随时回看、再次导出或删除</p>
                  </div>
                </div>
              </div>

              <div className="testcase-set-table-wrap">
                <table className="minimal-table">
                  <thead>
                    <tr>
                      <th scope="col">名称</th>
                      <th scope="col">结论统计</th>
                      <th scope="col" className="w-[150px]">创建时间</th>
                      <th scope="col" className="w-[200px] text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordsLoading
                      ? Array.from({ length: 4 }, (_, index) => (
                          <tr key={`record-skeleton-${index}`} aria-hidden="true">
                            <td><span className="skeleton skeleton-text block w-52" /></td>
                            <td><span className="skeleton skeleton-text block w-44" /></td>
                            <td><span className="skeleton skeleton-text block w-28" /></td>
                            <td><span className="skeleton skeleton-text ml-auto block w-28" /></td>
                          </tr>
                        ))
                      : records.map((record) => (
                          <tr key={record.id}>
                            <td>
                              <button
                                type="button"
                                onClick={() => void handleOpenRecord(record)}
                                disabled={openingRecordId !== null}
                                className="group flex max-w-full items-center gap-2.5 text-left"
                                aria-label={`打开记录 ${record.name}`}
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                                  <ListTree className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 truncate font-semibold text-fg transition-colors group-hover:text-accent">
                                  {record.name}
                                </span>
                                {record.truncated && <span className="badge badge-muted shrink-0">已截断</span>}
                                {openingRecordId === record.id && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
                              </button>
                            </td>
                            <td>
                              <span className="flex flex-wrap items-center gap-1.5">
                                {(Object.keys(FINDING_TYPE_META) as FindingType[]).map((type) => (
                                  <span key={type} className={FINDING_BADGE_CLASS[type]}>
                                    {FINDING_TYPE_META[type].label} {record.findingsCount[type]}
                                  </span>
                                ))}
                              </span>
                            </td>
                            <td>
                              <span className="text-xs tabular-nums text-muted">{formatDateTime(record.createdAt)}</span>
                            </td>
                            <td>
                              <div className="row-actions flex items-center justify-end gap-1.5">
                                <Tooltip content="打开记录">
                                  <button
                                    type="button"
                                    className="icon-action h-8 w-8"
                                    aria-label={`打开记录 ${record.name}`}
                                    disabled={openingRecordId !== null}
                                    onClick={() => void handleOpenRecord(record)}
                                  >
                                    <FolderOpen className="h-3.5 w-3.5" />
                                  </button>
                                </Tooltip>
                                <Tooltip content="导出 XMind">
                                  <button
                                    type="button"
                                    className="icon-action h-8 w-8"
                                    aria-label={`导出 XMind ${record.name}`}
                                    disabled={exportingRecordId !== null}
                                    onClick={() => void handleExportRecord(record)}
                                  >
                                    {exportingRecordId === record.id
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <FileDown className="h-3.5 w-3.5" />}
                                  </button>
                                </Tooltip>
                                <Tooltip content="重命名">
                                  <button
                                    type="button"
                                    className="icon-action h-8 w-8"
                                    aria-label={`重命名记录 ${record.name}`}
                                    onClick={() => openRenameDialog(record)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                </Tooltip>
                                <Tooltip content="删除记录">
                                  <button
                                    type="button"
                                    className="icon-action h-8 w-8 text-danger/75 hover:text-danger"
                                    aria-label={`删除记录 ${record.name}`}
                                    onClick={() => setDeletingRecord(record)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </Tooltip>
                              </div>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>

              {!recordsLoading && recordsTotal > 0 && (
                <div className="testcase-set-pagination">
                  <span className="testcase-page-info">
                    第 {(safeRecordsPage - 1) * RECORDS_PAGE_SIZE + 1}-{Math.min(safeRecordsPage * RECORDS_PAGE_SIZE, recordsTotal)} 条 · 共 {recordsTotal} 条
                  </span>
                  <div className="testcase-page-controls">
                    {recordsPageCount > 1 && (
                      <>
                        <button type="button" onClick={() => setRecordsPage((page) => Math.max(1, page - 1))} disabled={safeRecordsPage === 1} className="icon-action h-8 w-8" aria-label="上一页"><ChevronLeft className="h-3.5 w-3.5" /></button>
                        {buildPageItems(safeRecordsPage, recordsPageCount).map((item, index) => (
                          item === 'ellipsis'
                            ? <span key={`page-ellipsis-${index}`} className="testcase-page-ellipsis" aria-hidden="true">…</span>
                            : <button key={item} type="button" onClick={() => setRecordsPage(item)} className={`testcase-page-button${item === safeRecordsPage ? ' is-active' : ''}`} aria-label={`第 ${item} 页`} aria-current={item === safeRecordsPage ? 'page' : undefined}>{item}</button>
                        ))}
                        <button type="button" onClick={() => setRecordsPage((page) => Math.min(recordsPageCount, page + 1))} disabled={safeRecordsPage === recordsPageCount} className="icon-action h-8 w-8" aria-label="下一页"><ChevronRight className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      )}

      {(phase === 'input' || phase === 'analyzing') && (
        <main className="requirement-input-layout">
          <RequirementInput running={phase === 'analyzing' && !error} onSubmit={(input) => void handleAnalyze(input)} />
          {phase === 'analyzing' && (
            <>
              <AnalysisProgress stage={stage} warnings={warnings} error={error} processBlocks={processBlocks} />
              {error && (
                <button type="button" className="secondary-action px-4 py-2.5 text-sm" onClick={resetToInput}>
                  <RotateCcw className="h-4 w-4" />返回重新输入
                </button>
              )}
            </>
          )}
        </main>
      )}

      {phase === 'result' && result && (
        <main className="requirement-result-layout">
          <div className="surface-panel requirement-result-toolbar">
            <div className="flex items-center gap-3">
              <button type="button" className="secondary-action px-3 py-2 text-xs" onClick={backToList}>
                <ArrowLeft className="h-3.5 w-3.5" />返回列表
              </button>
              <div className="requirement-chart-tabs" role="tablist" aria-label="分析结果图表类型">
                {REQUIREMENT_CHART_TABS.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.type}
                      type="button"
                      role="tab"
                      aria-selected={chartType === tab.type}
                      className={`requirement-chart-tab${chartType === tab.type ? ' is-active' : ''}`}
                      onClick={() => handleChartTypeChange(tab.type)}
                    >
                      <Icon className="h-3.5 w-3.5" />{tab.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="requirement-toolbar-actions">
              <button type="button" className="secondary-action px-3 py-2 text-xs" disabled={exporting !== null} onClick={() => void handleExport('xmind')}>
                <FileDown className="h-3.5 w-3.5" />XMind
              </button>
              <button type="button" className="secondary-action px-3 py-2 text-xs" disabled={exporting !== null} onClick={() => void handleExport('freemind')}>
                <FileDown className="h-3.5 w-3.5" />FreeMind
              </button>
              <button type="button" className="secondary-action px-3 py-2 text-xs" disabled={exporting !== null} onClick={() => void handleExport('markdown')}>
                <FileText className="h-3.5 w-3.5" />Markdown
              </button>
              <button type="button" className="secondary-action px-3 py-2 text-xs" disabled={exporting !== null} onClick={() => void handleExport('png')}>
                <ImageDown className="h-3.5 w-3.5" />PNG
              </button>
              <button type="button" className="primary-action px-4 py-2 text-xs" onClick={handleHandoff}>
                <Share2 className="h-3.5 w-3.5" />基于此需求生成测试用例
              </button>
              <button type="button" className="secondary-action px-3 py-2 text-xs" onClick={resetToInput}>
                <RotateCcw className="h-3.5 w-3.5" />重新分析
              </button>
            </div>
          </div>

          {error && <p className="field-error">{error}</p>}
          {result.warnings.length > 0 && (
            <ul className="requirement-warning-list surface-panel">
              {result.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}

          <div className="requirement-result-grid">
            <section className="surface-panel requirement-chart-panel">
              <div className="requirement-chart-panel-head">
                <h2 className="requirement-panel-title">需求分解树<span className="requirement-title-suffix">{result.title}</span></h2>
                <button type="button" className="secondary-action px-3 py-1.5 text-xs" onClick={() => setCanvasOpen(true)}>
                  <Maximize2 className="h-3.5 w-3.5" />放大阅览
                </button>
              </div>
              {chartType === 'mindmap' && (
                <MindMapView
                  ref={chartRef}
                  tree={result.tree}
                  findingCounts={findingCounts}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                />
              )}
              {chartType === 'tree' && (
                <TreeChartView
                  ref={chartRef}
                  tree={result.tree}
                  findingCounts={findingCounts}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  orientation="TB"
                />
              )}
              {chartType === 'logic' && (
                <TreeChartView
                  ref={chartRef}
                  tree={result.tree}
                  findingCounts={findingCounts}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  orientation="LR"
                />
              )}
            </section>

            <FindingsPanel
              findings={result.findings}
              nodeTitles={nodeTitles}
              activeFindingId={activeFindingId}
              selectedNodeId={selectedNodeId}
              onSelectFinding={handleSelectFinding}
            />
          </div>

          {/* 图表画布：全屏只读阅览，共享图表类型/选中节点状态，退出后原样保留 */}
          <ChartCanvasModal
            open={canvasOpen}
            onClose={() => setCanvasOpen(false)}
            title={result.title}
            tree={result.tree}
            findings={result.findings}
            findingCounts={findingCounts}
            nodeTitles={nodeTitles}
            chartType={chartType}
            onChartTypeChange={handleChartTypeChange}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            activeFindingId={activeFindingId}
            onSelectFinding={handleSelectFinding}
            onExportError={setError}
          />

          <div className="requirement-bottom-panels">
            {processBlocks.length > 0 && (
              <section className="surface-panel requirement-source-panel">
                <button
                  type="button"
                  className="requirement-source-toggle"
                  aria-expanded={showProcess}
                  onClick={() => setShowProcess((current) => !current)}
                >
                  {showProcess ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  分析过程
                </button>
                {showProcess && (
                  <div className="requirement-process-scroll requirement-process-review-scroll">
                    <AnalysisProcessBlocks blocks={processBlocks} />
                  </div>
                )}
              </section>
            )}

            <section className="surface-panel requirement-source-panel">
              <button
                type="button"
                className="requirement-source-toggle"
                aria-expanded={showSourceText}
                onClick={() => setShowSourceText((current) => !current)}
              >
                {showSourceText ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                解析原文
                {result.truncated && <span className="requirement-source-note">（已截断）</span>}
              </button>
              {showSourceText && <pre className="requirement-source-text">{result.sourceText}</pre>}
            </section>
          </div>
        </main>
      )}

      {/* 重命名记录 */}
      <ModalShell
        open={Boolean(renamingRecord)}
        onClose={() => !renaming && setRenamingRecord(null)}
        closeOnBackdrop={!renaming}
        closeOnEscape={!renaming}
      >
        {renamingRecord && (
          <div
            className="modal-panel w-full max-w-[420px] rounded-[26px] p-6"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-record-title"
          >
            <h2 id="rename-record-title" className="font-display text-lg font-semibold tracking-[-0.03em] text-fg">
              重命名分析记录
            </h2>
            <div className="mt-5">
              <label className="field-label" htmlFor="rename-record-input">记录名称</label>
              <input
                id="rename-record-input"
                autoFocus
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void submitRename() }}
                className="field-control"
                placeholder="例如：登录需求分析"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRenamingRecord(null)}
                disabled={renaming}
                className="secondary-action px-4 py-2 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitRename()}
                disabled={renaming || !renameName.trim()}
                className="primary-action px-4 py-2 text-sm disabled:opacity-50"
              >
                {renaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                {renaming ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )}
      </ModalShell>

      {/* 删除记录确认 */}
      <ConfirmDialog
        open={Boolean(deletingRecord)}
        title="删除这条分析记录？"
        description={deletingRecord ? (
          <>将永久删除「<span className="font-semibold text-fg">{deletingRecord.name}</span>」及其需求分解树与分析结论，此操作不可撤销。</>
        ) : null}
        confirmText="确认删除"
        onCancel={() => setDeletingRecord(null)}
        onConfirm={() => void confirmDeleteRecord()}
        danger
      />
    </div>
  )
}
