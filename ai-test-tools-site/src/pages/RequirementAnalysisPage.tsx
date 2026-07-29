import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FolderOpen,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
  X,
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
  type AnalysisRecordSummary,
  type AnalysisStage,
  type AnalyzeRequirementInput,
  type FindingType,
} from '../lib/requirement-analysis-api'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { ModalShell } from '../components/ui/ModalShell'
import { Tooltip } from '../components/ui/Tooltip'
import { useGoBack } from '../hooks/useGoBack'
import { RequirementInput } from '../features/requirement-analysis/RequirementInput'
import { AnalysisProgress } from '../features/requirement-analysis/AnalysisProgress'
import { useAnalysisProcessStream } from '../features/requirement-analysis/useAnalysisProcessStream'

const RECORDS_PAGE_SIZE = 10

// 结论计数徽章：颜色语义与 FindingsPanel 分组标题一致（风险红 / 歧义橄榄 / 澄清主色）
const FINDING_BADGE_CLASS: Record<FindingType, string> = {
  risk: 'badge badge-danger',
  ambiguity: 'badge border-[oklch(0.48_0.12_85/0.2)] bg-[oklch(0.48_0.12_85/0.1)] text-[oklch(0.48_0.12_85)]',
  clarification: 'badge badge-accent',
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

type Phase = 'list' | 'input' | 'analyzing'

export function RequirementAnalysisPage() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const { showError } = useErrorDialog()
  // 两层结构：默认 'list'（分析记录列表），'input'/'analyzing' 以弹窗承载（ADR 0004）；
  // 分析完成或打开记录后跳转独立画板路由 /requirement-analysis/board/:id（ADR 0006）
  const [phase, setPhase] = useState<Phase>('list')
  const [stage, setStage] = useState<AnalysisStage>('parsing')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  // ── 记录列表 ──
  const [records, setRecords] = useState<AnalysisRecordSummary[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [exportingRecordId, setExportingRecordId] = useState<string | null>(null)
  const [renamingRecord, setRenamingRecord] = useState<AnalysisRecordSummary | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deletingRecord, setDeletingRecord] = useState<AnalysisRecordSummary | null>(null)
  const {
    blocks: processBlocks,
    handleEvent: handleProcessEvent,
    finish: finishProcess,
    reset: resetProcess,
  } = useAnalysisProcessStream()

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
    resetProcess()

    try {
      const analysis = await analyzeRequirement(input, aiConfig, async (event) => {
        if (event.type === 'stage') setStage(event.stage)
        if (event.type === 'warning') setWarnings((current) => [...current, ...event.warnings])
        if (event.type === 'error') setError(event.message)
        handleProcessEvent(event)
      })
      // 先存后跳（ADR 0006）：拿到记录 id 再导航到独立画板路由，
      // 画板页按 id 自行拉取数据，刷新/直达均有效
      try {
        const record = await createAnalysisRecord({
          name: recordName,
          // 新记录固定以默认图表类型入库；图表类型切换是画板内行为，由画板页回写
          chartType: 'mindmap',
          title: analysis.title,
          tree: analysis.tree,
          findings: analysis.findings,
          sourceText: analysis.sourceText,
          truncated: analysis.truncated,
          warnings: analysis.warnings,
        })
        finishProcess()
        navigate(`/requirement-analysis/board/${record.id}`)
      } catch (saveError) {
        // 保存失败不跳转：留在分析进度页并提示，避免直达路由拿不到数据
        finishProcess()
        console.warn('分析记录保存失败', saveError)
        setError('分析已完成，但保存分析记录失败，请稍后重试。')
      }
    } catch (err) {
      finishProcess()
      setError(err instanceof Error ? err.message : '需求分析失败，请稍后重试。')
    }
  }, [finishProcess, handleProcessEvent, navigate, resetProcess])

  // ── 记录列表操作 ──

  // 打开记录 = 跳转画板路由，数据由画板页按 id 拉取（ADR 0006）
  const handleOpenRecord = (summary: AnalysisRecordSummary) => {
    navigate(`/requirement-analysis/board/${summary.id}`)
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

  // 画板文件导出逻辑已迁至画板页（ADR 0006）；接力生成用例入口也在画板内

  // 分析运行中禁止关闭弹窗；待输入或已出错时关闭即回列表
  const inputModalRunning = phase === 'analyzing' && !error
  const closeInputModal = () => {
    if (inputModalRunning) return
    setError(null)
    setWarnings([])
    resetProcess()
    setPhase('list')
  }

  // 分析出错后的"返回重新输入"：回到输入态，清空错误与过程块
  const backToInput = () => {
    setPhase('input')
    setError(null)
    setWarnings([])
    resetProcess()
  }

  return (
    <div className="page-shell requirement-page">
      <header className="testcase-workspace-header">
        <div className="flex min-w-0 items-center gap-3">
          <Tooltip content="返回">
            <button type="button" onClick={goBack} className="icon-action h-10 w-10 shrink-0 rounded-xl" aria-label="返回">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Tooltip>
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
                  <div className="testcase-set-heading">
                    <div className="flex items-center gap-2">
                      <h2>分析记录</h2>
                      <span className="testcase-set-total">{recordsTotal}</span>
                    </div>
                    <p>每次分析完成自动保存，可随时回看、再次导出或删除</p>
                  </div>
                  <button type="button" onClick={() => setPhase('input')} className="primary-action shrink-0 px-4 py-2.5 text-sm">
                    <Plus className="h-4 w-4" />新建分析
                  </button>
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
                                onClick={() => handleOpenRecord(record)}
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
                                    onClick={() => handleOpenRecord(record)}
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

      {/* 新建分析：输入与进度以弹窗承载，不离开记录列表（ADR 0004） */}
      <ModalShell
        open={phase === 'input' || phase === 'analyzing'}
        onClose={closeInputModal}
        closeOnBackdrop={!inputModalRunning}
        closeOnEscape={!inputModalRunning}
      >
        {(phase === 'input' || phase === 'analyzing') && (
          <div
            className="modal-panel requirement-input-modal max-h-[90vh] w-full max-w-[760px] overflow-auto rounded-[28px] p-6 max-sm:p-4"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="requirement-input-modal-title"
          >
            <div className="modal-heading-row">
              <div>
                <p className="modal-kicker">需求分析</p>
                <h2 id="requirement-input-modal-title">新建分析</h2>
                <span>{phase === 'analyzing' ? 'AI 正在分析，完成后自动打开结果视图。' : '上传需求文档或粘贴文本，提交后立即开始分析。'}</span>
              </div>
              <button type="button" onClick={closeInputModal} disabled={inputModalRunning} className="icon-action h-9 w-9" aria-label="关闭新建分析窗口"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 flex flex-col gap-4">
              <RequirementInput running={inputModalRunning} onSubmit={(input) => void handleAnalyze(input)} />
              {phase === 'analyzing' && (
                <>
                  <AnalysisProgress stage={stage} warnings={warnings} error={error} processBlocks={processBlocks} />
                  {error && (
                    <div className="flex justify-end">
                      <button type="button" className="secondary-action px-4 py-2.5 text-sm" onClick={backToInput}>
                        <RotateCcw className="h-4 w-4" />返回重新输入
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </ModalShell>

      {/* 分析画板已独立为 /requirement-analysis/board/:id 路由（ADR 0006），
          打开记录 / 分析完成即导航离开本页 */}

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
