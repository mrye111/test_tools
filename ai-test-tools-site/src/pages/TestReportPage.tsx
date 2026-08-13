import { useCallback, useEffect, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, FileSpreadsheet, Bug, Sparkles, Trash2, Pencil, FileText, AlertTriangle } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { useGoBack } from '../hooks/useGoBack'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { parseZentaoReport } from '../lib/zentao-csv-parser'
import { generateDemoReportData } from '../lib/test-report-demo'
import { loadStoredModelConfig } from '../lib/model-config-store'
import { toAiConfig } from '../shared/api-types'
import {
  deleteReport,
  generateReportStream,
  getReportStorageStatus,
  listReports,
  renameReport,
  type ReportSummary,
  type ReportType,
} from '../features/test-report/report-api'

/** 报告类型 chips：一期预设三类 + 自由生成 */
const REPORT_TYPE_OPTIONS: { value: ReportType; label: string; hint: string }[] = [
  { value: 'summary', label: '测试总结报告', hint: '用例 + BUG CSV' },
  { value: 'brief', label: '快速简报', hint: '几句话描述' },
  { value: 'defect', label: '缺陷分析报告', hint: '仅 BUG CSV' },
  { value: 'free', label: '自由生成', hint: 'AI 判断结构' },
]

const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  summary: '测试总结',
  brief: '快速简报',
  defect: '缺陷分析',
  free: '自由',
}

/** 将时间差格式化为相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）。 */
function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return '很久以前'
}

export function TestReportPage() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const { showError } = useErrorDialog()

  const [reportType, setReportType] = useState<ReportType>('summary')
  const [caseFile, setCaseFile] = useState<File | null>(null)
  const [bugFile, setBugFile] = useState<File | null>(null)
  const [briefText, setBriefText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [progressMessage, setProgressMessage] = useState('')
  const [fieldError, setFieldError] = useState('')

  const [storageMode, setStorageMode] = useState<'mysql' | 'memory' | null>(null)
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [listLoading, setListLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<ReportSummary | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState('')

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const loadList = useCallback(async (targetPage: number) => {
    setListLoading(true)
    try {
      const data = await listReports(targetPage, pageSize)
      setReports(data.reports)
      setTotal(data.total)
      setPage(data.page)
    } catch {
      setReports([])
      setTotal(0)
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList(1)
    getReportStorageStatus()
      .then(setStorageMode)
      .catch(() => setStorageMode(null))
  }, [loadList])

  const needsCaseFile = reportType === 'summary'
  const needsBugFile = reportType === 'summary' || reportType === 'defect'
  const needsText = reportType === 'brief' || reportType === 'free'

  /** 校验输入并构造生成请求素材。 */
  const buildSource = async (): Promise<{ sourceType: 'text' | 'csv'; sourceText?: string; csvData?: unknown } | null> => {
    if (needsText) {
      const trimmed = briefText.trim()
      if (!trimmed) {
        setFieldError('请输入测试描述（几句话即可）')
        return null
      }
      return { sourceType: 'text', sourceText: trimmed }
    }
    if (needsCaseFile && !caseFile) {
      setFieldError('请上传测试用例执行结果文件')
      return null
    }
    if (needsBugFile && !bugFile) {
      setFieldError('请上传 BUG 清单文件')
      return null
    }
    const data = await parseZentaoReport(needsCaseFile ? caseFile : null, needsBugFile ? bugFile : null)
    return { sourceType: 'csv', csvData: data }
  }

  const handleGenerate = async () => {
    setFieldError('')
    let source
    try {
      source = await buildSource()
    } catch (error) {
      showError(error, { title: 'CSV 解析失败', fallbackMessage: '文件解析失败，请检查文件格式是否正确。' })
      return
    }
    if (!source) return

    const stored = loadStoredModelConfig()
    if (!stored) {
      showError(new Error('请先在模型设置中配置统一供应商'), { title: '未配置模型' })
      return
    }

    setGenerating(true)
    setProgressMessage('正在连接模型…')
    try {
      const report = await generateReportStream(
        { reportType, ...source },
        toAiConfig(stored),
        (event) => {
          if (event.type === 'progress') setProgressMessage(event.message)
        },
      )
      if (report) {
        navigate(`/testreport/reports/${report.id}`)
      }
    } catch (error) {
      showError(error, { title: '生成测试报告失败' })
    } finally {
      setGenerating(false)
      setProgressMessage('')
    }
  }

  /** 演示：内置演示数据走真实 AI 管线生成一份测试总结报告。 */
  const handleDemo = () => {
    const data = generateDemoReportData()
    setReportType('summary')
    setFieldError('')
    const stored = loadStoredModelConfig()
    if (!stored) {
      showError(new Error('请先在模型设置中配置统一供应商'), { title: '未配置模型' })
      return
    }
    setGenerating(true)
    setProgressMessage('正在连接模型…')
    generateReportStream({ reportType: 'summary', sourceType: 'csv', csvData: data }, toAiConfig(stored), (event) => {
      if (event.type === 'progress') setProgressMessage(event.message)
    })
      .then((report) => {
        if (report) navigate(`/testreport/reports/${report.id}`)
      })
      .catch((error) => showError(error, { title: '生成演示报告失败' }))
      .finally(() => {
        setGenerating(false)
        setProgressMessage('')
      })
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    const target = pendingDelete
    try {
      await deleteReport(target.id)
      setPendingDelete(null)
      void loadList(page)
    } catch (error) {
      showError(error, { title: '删除报告失败' })
    }
  }

  const handleRenameSubmit = async (id: string) => {
    const title = renamingTitle.trim()
    setRenamingId(null)
    if (!title) return
    try {
      await renameReport(id, title)
      void loadList(page)
    } catch (error) {
      showError(error, { title: '重命名失败' })
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Tooltip content="返回">
            <button type="button" onClick={goBack} className="icon-action h-10 w-10 rounded-xl" aria-label="返回">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Tooltip>
          <div>
            <h1 className="page-title">测试报告</h1>
            <p className="page-subtitle">AI 生成单文件 HTML 报告，可回看、追改、导出 HTML 与 PDF</p>
          </div>
        </div>
      </div>

      {storageMode === 'memory' && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[oklch(0.75_0.15_80/0.4)] bg-[oklch(0.97_0.03_90)] px-4 py-2.5 text-sm text-[oklch(0.45_0.1_70)]" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          数据库不可用，本次生成的报告不会持久保存
        </div>
      )}

      {/* 新建报告 */}
      <div className="surface-panel motion-card stagger-1 rounded-[26px] p-6 max-sm:p-4">
        <div className="relative z-[1] space-y-5">
          <div>
            <label className="field-label">报告类型</label>
            <div className="flex flex-wrap gap-2">
              {REPORT_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setReportType(option.value)
                    setFieldError('')
                  }}
                  className={`rounded-2xl border px-4 py-2 text-sm transition-all duration-200 ${
                    reportType === option.value
                      ? 'border-accent bg-accent/10 font-semibold text-accent'
                      : 'border-[oklch(0.9_0.012_264)] bg-white/60 text-muted hover:border-accent/40 hover:text-fg'
                  }`}
                >
                  {option.label}
                  <span className="ml-1.5 text-[11px] font-normal opacity-70">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {needsText ? (
            <div>
              <label className="field-label">测试描述</label>
              <textarea
                value={briefText}
                onChange={(event) => {
                  setBriefText(event.target.value)
                  setFieldError('')
                }}
                rows={5}
                placeholder={'用几句话描述本轮测试，例如：\n测试重点：\n1. 程序是否能正常启动并按配置间隔执行\n2. 调用次数达到上限时只停用指定账户…'}
                className="field-control w-full rounded-2xl px-4 py-3 text-sm leading-6"
              />
            </div>
          ) : (
            <div className={`grid gap-5 ${needsCaseFile ? 'md:grid-cols-2' : ''}`}>
              {needsCaseFile && (
                <div>
                  <label className="field-label">
                    测试用例执行结果 <span className="text-danger">*</span>
                  </label>
                  <FileDropZone
                    file={caseFile}
                    onFile={(file) => {
                      setCaseFile(file)
                      setFieldError('')
                    }}
                    icon={<FileSpreadsheet className="h-6 w-6 text-accent" />}
                    accept=".csv,.xlsx,.xls,.json"
                    label="上传用例执行结果文件"
                    hint="支持 CSV、Excel、JSON"
                    accent="accent"
                  />
                </div>
              )}
              <div>
                <label className="field-label">
                  BUG 清单 <span className="text-danger">*</span>
                </label>
                <FileDropZone
                  file={bugFile}
                  onFile={(file) => {
                    setBugFile(file)
                    setFieldError('')
                  }}
                  icon={<Bug className="h-6 w-6 text-danger" />}
                  accept=".csv,.xlsx,.xls,.json"
                  label="上传 BUG 清单文件"
                  hint="支持 CSV、Excel、JSON"
                  accent="danger"
                />
              </div>
            </div>
          )}

          {fieldError && <p className="field-error">{fieldError}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="primary-action px-5 py-2.5 text-sm disabled:opacity-50"
            >
              {generating ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generating ? '生成中…' : 'AI 生成报告'}
            </button>
            <button
              type="button"
              onClick={handleDemo}
              disabled={generating}
              className="secondary-action px-5 py-2.5 text-sm disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              用演示数据生成
            </button>
            {generating && progressMessage && (
              <span className="text-sm text-muted" role="status">{progressMessage}</span>
            )}
          </div>
        </div>
      </div>

      {/* 报告记录列表 */}
      <div className="surface-panel motion-card stagger-2 mt-5 rounded-[26px] p-6 max-sm:p-4">
        <div className="relative z-[1]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">报告记录</h2>
            <span className="text-xs text-muted">共 {total} 份</span>
          </div>

          {listLoading ? (
            <div className="py-8 text-center text-sm text-muted">加载中…</div>
          ) : reports.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">还没有报告，生成第一份吧</div>
          ) : (
            <ul className="divide-y divide-[oklch(0.93_0.008_264/0.6)]">
              {reports.map((report) => (
                <li key={report.id} className="group flex items-center gap-3 py-3">
                  {renamingId === report.id ? (
                    <input
                      autoFocus
                      value={renamingTitle}
                      onChange={(event) => setRenamingTitle(event.target.value)}
                      onBlur={() => void handleRenameSubmit(report.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleRenameSubmit(report.id)
                        if (event.key === 'Escape') setRenamingId(null)
                      }}
                      className="field-control min-w-0 flex-1 rounded-xl px-3 py-1.5 text-sm"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate(`/testreport/reports/${report.id}`)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium text-fg group-hover:text-accent">{report.title}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {REPORT_TYPE_LABEL[report.reportType]} · {report.sourceType === 'csv' ? 'CSV 数据' : '文本描述'} · {formatRelativeTime(report.updatedAt)}
                      </span>
                    </button>
                  )}
                  <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Tooltip content="重命名">
                      <button
                        type="button"
                        aria-label={`重命名 ${report.title}`}
                        onClick={() => {
                          setRenamingId(report.id)
                          setRenamingTitle(report.title)
                        }}
                        className="icon-action h-8 w-8 rounded-lg"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip content="删除报告">
                      <button
                        type="button"
                        aria-label={`删除报告 ${report.title}`}
                        onClick={() => setPendingDelete(report)}
                        className="icon-action h-8 w-8 rounded-lg hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => void loadList(page - 1)}
                className="secondary-action px-3 py-1.5 text-xs disabled:opacity-40"
              >
                上一页
              </button>
              <span className="text-xs text-muted">{page} / {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => void loadList(page + 1)}
                className="secondary-action px-3 py-1.5 text-xs disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除报告"
        danger
        confirmText="确认删除"
        description={pendingDelete ? `将删除报告「${pendingDelete.title}」，删除后不可恢复。` : ''}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  )
}

interface FileDropZoneProps {
  file: File | null
  onFile: (f: File | null) => void
  icon: ReactNode
  accept: string
  label: string
  hint: string
  accent: 'accent' | 'danger'
}

function FileDropZone({ file, onFile, icon, accept, label, hint, accent }: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false)

  const palette = {
    accent: {
      border: 'oklch(0.58 0.17 262 / 0.28)',
      background: 'oklch(0.58 0.17 262 / 0.05)',
      strong: 'oklch(0.58 0.17 262)',
    },
    danger: {
      border: 'oklch(0.72 0.15 20 / 0.28)',
      background: 'oklch(0.72 0.15 20 / 0.05)',
      strong: 'oklch(0.55 0.2 25)',
    },
  }[accent]

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onFile(f)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="relative flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed px-5 py-6 text-center transition-all duration-200"
      style={{
        borderColor: dragOver || file ? palette.border : 'oklch(0.88 0.01 264)',
        background: dragOver || file
          ? `linear-gradient(180deg, oklch(1 0 0 / 0.86), ${palette.background})`
          : 'oklch(0.995 0.002 264 / 0.72)',
      }}
    >
      <input
        type="file"
        accept={accept}
        onChange={handleChange}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
      {file ? (
        <>
          <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/90 shadow-[0_12px_32px_-20px_oklch(0.2_0.03_262/0.2)]" style={{ color: palette.strong }}>
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="max-w-[240px] truncate text-[13px] font-semibold text-fg">{file.name}</div>
          <div className="text-[11px] text-muted">{(file.size / 1024).toFixed(1)} KB</div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onFile(null) }}
            className="mt-1 text-[11px] font-medium text-muted hover:text-fg"
          >
            移除文件
          </button>
        </>
      ) : (
        <>
          <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/90 shadow-[0_12px_32px_-20px_oklch(0.2_0.03_262/0.2)]">
            {icon}
          </div>
          <div className="text-[13px] font-semibold text-fg">{label}</div>
          <div className="text-[11px] text-muted">{hint}</div>
          <div className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: palette.strong }}>
            <Upload className="h-3 w-3" />
            点击选择或拖拽文件到此处
          </div>
        </>
      )}
    </div>
  )
}
