import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, FileText, Loader2, Pencil, Sparkles, Trash2, Upload } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { useGoBack } from '../hooks/useGoBack'
import { loadStoredModelConfig } from '../lib/model-config-store'
import { toAiConfig } from '../shared/api-types'
import {
  analyzeRequirementStream,
  deleteAnalysisRecord,
  getAnalysisStorageStatus,
  listAnalysisRecords,
  parseRequirementDocument,
  renameAnalysisRecord,
  type AnalysisRecordSummary,
} from '../features/requirement-analysis-v2/analysis-api'

/** 相对时间格式化（刚刚 / N 分钟前 / N 小时前 / N 天前） */
function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days} 天前` : '很久以前'
}

const FILE_ACCEPT = '.md,.txt,.docx,.xlsx,.xls,.csv,.pdf'

/** 需求文档上传区（对齐报告页 FileDropZone 的虚线玻璃质感，上传即解析为文本） */
function DocDropZone({ fileName, parsing, onFile }: { fileName: string | null; parsing: boolean; onFile: (f: File) => void }) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="relative flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed px-5 py-6 text-center transition-all duration-200"
      style={{
        borderColor: dragOver || fileName ? 'oklch(0.58 0.17 262 / 0.4)' : 'oklch(0.88 0.01 264)',
        background: dragOver || fileName
          ? 'linear-gradient(180deg, oklch(1 0 0 / 0.86), oklch(0.58 0.17 262 / 0.05))'
          : 'oklch(0.995 0.002 264 / 0.72)',
      }}
    >
      <input
        type="file"
        accept={FILE_ACCEPT}
        aria-label="上传需求文档"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onFile(f)
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/90 shadow-[0_12px_32px_-20px_oklch(0.2_0.03_262/0.25)] text-accent">
        {parsing ? <Loader2 className="h-5 w-5 animate-spin" /> : fileName ? <FileText className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
      </div>
      {fileName ? (
        <>
          <div className="max-w-[240px] truncate text-[13px] font-semibold text-fg">{fileName}</div>
          <div className="text-[11px] text-muted">已解析为文本，可直接编辑下方内容</div>
        </>
      ) : (
        <>
          <div className="text-[13px] font-medium text-fg">{parsing ? '正在解析文档…' : '拖拽或点击上传需求文档'}</div>
          <div className="text-[11px] text-muted">支持 {FILE_ACCEPT.split(',').join(' / ')}，不超过 10MB</div>
        </>
      )}
    </div>
  )
}

/** 需求分析 v2 列表页：头部与输入区对齐报告页模式（page-header + surface-panel + field-control） */
export function RequirementAnalysisPage() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const { showError } = useErrorDialog()

  const [records, setRecords] = useState<AnalysisRecordSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [listLoading, setListLoading] = useState(true)
  const [storageMode, setStorageMode] = useState<'mysql' | 'memory' | null>(null)

  const [sourceText, setSourceText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [progressMessage, setProgressMessage] = useState('')
  const [fieldError, setFieldError] = useState('')

  const [pendingDelete, setPendingDelete] = useState<AnalysisRecordSummary | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState('')

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const loadList = useCallback(async (targetPage: number) => {
    setListLoading(true)
    try {
      const data = await listAnalysisRecords(targetPage, pageSize)
      setRecords(data.records)
      setTotal(data.total)
      setPage(targetPage)
    } catch (err) {
      showError(err, { title: '加载失败', fallbackMessage: '获取分析记录失败，请稍后重试。' })
    } finally {
      setListLoading(false)
    }
  }, [showError])

  useEffect(() => {
    // 数据加载属外部系统同步：推迟到微任务，避免 effect 体内同步 setState
    queueMicrotask(() => {
      void loadList(1)
      getAnalysisStorageStatus().then(setStorageMode).catch(() => setStorageMode(null))
    })
  }, [loadList])

  /** 上传文档 → 服务端解析为纯文本填入输入框 */
  const handleFile = async (file: File) => {
    setParsing(true)
    setFieldError('')
    try {
      const parsed = await parseRequirementDocument(file)
      setSourceText(parsed.text)
      setFileName(file.name)
      setParseWarnings(parsed.warnings)
    } catch (err) {
      showError(err, { title: '文档解析失败', fallbackMessage: '文档解析失败，请换格式或粘贴文本。' })
    } finally {
      setParsing(false)
    }
  }

  const handleAnalyze = async () => {
    const trimmed = sourceText.trim()
    if (!trimmed) {
      setFieldError('请上传需求文档或粘贴需求文本')
      return
    }
    const stored = loadStoredModelConfig()
    if (!stored) {
      setFieldError('请先在「设置」中配置模型，再开始分析')
      return
    }
    setAnalyzing(true)
    setFieldError('')
    setProgressMessage('正在连接模型…')
    try {
      const record = await analyzeRequirementStream(
        { sourceText: trimmed, sourceFileName: fileName ?? undefined },
        toAiConfig(stored),
        (event) => {
          if (event.type === 'progress') setProgressMessage(event.message)
        },
      )
      if (record) {
        navigate(`/requirement-analysis/records/${record.id}`)
        return
      }
      setFieldError('分析未完成，请重试')
    } catch (err) {
      showError(err, { title: '分析失败', fallbackMessage: 'AI 分析失败，请稍后重试。' })
    } finally {
      setAnalyzing(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await deleteAnalysisRecord(pendingDelete.id)
      setPendingDelete(null)
      void loadList(page)
    } catch (err) {
      showError(err, { title: '删除失败', fallbackMessage: '删除分析记录失败，请稍后重试。' })
    }
  }

  const handleRenameSubmit = async (id: string) => {
    const title = renamingTitle.trim()
    if (!title) {
      setRenamingId(null)
      return
    }
    try {
      await renameAnalysisRecord(id, title)
      setRenamingId(null)
      void loadList(page)
    } catch (err) {
      showError(err, { title: '重命名失败', fallbackMessage: '重命名失败，请稍后重试。' })
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
            <h1 className="page-title">需求分析</h1>
            <p className="page-subtitle">AI 产出可测试化分析：问题日志、验收准则、测试条件与追溯矩阵</p>
          </div>
        </div>
      </div>

      {storageMode === 'memory' && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[oklch(0.75_0.15_80/0.4)] bg-[oklch(0.97_0.03_90)] px-4 py-2.5 text-sm text-[oklch(0.45_0.1_70)]" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          数据库不可用，本次分析记录不会持久保存
        </div>
      )}

      {/* 新建分析 */}
      <div className="surface-panel motion-card stagger-1 rounded-[26px] p-6 max-sm:p-4">
        <div className="relative z-[1] space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="field-label">需求文档</label>
              <DocDropZone fileName={fileName} parsing={parsing} onFile={(f) => void handleFile(f)} />
            </div>
            <div>
              <label className="field-label">或直接粘贴文本</label>
              <textarea
                value={sourceText}
                onChange={(event) => {
                  setSourceText(event.target.value)
                  setFieldError('')
                }}
                rows={6}
                disabled={analyzing}
                placeholder={'粘贴需求文本，例如：\n1. 用户可通过手机号+密码登录\n2. 连续输错密码 5 次锁定账号 30 分钟\n3. 登录失败时给出明确提示…'}
                className="field-control w-full min-h-[150px] rounded-[22px] px-4 py-3 text-sm leading-6"
              />
            </div>
          </div>

          {parseWarnings.map((warning, index) => (
            <p key={index} className="flex items-center gap-1.5 text-xs text-[oklch(0.55_0.12_70)]" role="note">
              <AlertTriangle className="h-3.5 w-3.5" /> {warning}
            </p>
          ))}
          {fieldError && <p className="field-error" role="alert">{fieldError}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={analyzing || parsing}
              className="primary-action px-5 py-2.5 text-sm disabled:opacity-50"
            >
              {analyzing ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {analyzing ? '分析中…' : 'AI 开始分析'}
            </button>
            {analyzing && progressMessage && (
              <span className="text-sm text-muted" role="status">{progressMessage}</span>
            )}
          </div>
        </div>
      </div>

      {/* 分析记录列表 */}
      <div className="surface-panel motion-card stagger-2 mt-5 rounded-[26px] p-6 max-sm:p-4">
        <div className="relative z-[1]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">分析记录</h2>
            <span className="text-xs text-muted">共 {total} 份</span>
          </div>

          {listLoading ? (
            <div className="py-8 text-center text-sm text-muted">加载中…</div>
          ) : records.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">还没有分析记录，从上方开始一次分析</div>
          ) : (
            <ul className="divide-y divide-[oklch(0.93_0.008_264/0.6)]">
              {records.map((record) => (
                <li key={record.id} className="group flex items-center gap-3 py-3">
                  {renamingId === record.id ? (
                    <input
                      autoFocus
                      value={renamingTitle}
                      aria-label="重命名记录"
                      onChange={(event) => setRenamingTitle(event.target.value)}
                      onBlur={() => void handleRenameSubmit(record.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleRenameSubmit(record.id)
                        if (event.key === 'Escape') setRenamingId(null)
                      }}
                      className="field-control min-w-0 flex-1 rounded-xl px-3 py-1.5 text-sm"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate(`/requirement-analysis/records/${record.id}`)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium text-fg group-hover:text-accent">{record.title}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        问题 {record.issueCount}（待澄清 {record.openIssueCount}） · 条件 {record.conditionCount} · 覆盖 {record.coveredConditionCount} · {formatRelativeTime(record.updatedAt)}
                      </span>
                    </button>
                  )}
                  <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Tooltip content="重命名">
                      <button
                        type="button"
                        aria-label={`重命名 ${record.title}`}
                        onClick={() => {
                          setRenamingId(record.id)
                          setRenamingTitle(record.title)
                        }}
                        className="icon-action h-8 w-8 rounded-lg"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip content="删除">
                      <button
                        type="button"
                        aria-label={`删除 ${record.title}`}
                        onClick={() => setPendingDelete(record)}
                        className="icon-action h-8 w-8 rounded-lg hover:!text-[oklch(0.55_0.2_25)]"
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
            <div className="mt-4 flex items-center justify-center gap-3 text-xs text-muted">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => void loadList(page - 1)}
                className="secondary-action px-3 py-1.5 text-xs disabled:opacity-40"
              >
                上一页
              </button>
              <span>{page} / {totalPages}</span>
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
        title="删除分析记录"
        danger
        confirmText="确认删除"
        description={pendingDelete ? `将删除「${pendingDelete.title}」及其全部问题、准则与测试条件，删除后不可恢复。` : ''}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  )
}
