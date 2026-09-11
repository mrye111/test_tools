import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSearch, FileText, Loader2, Pencil, Trash2, Upload } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
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

/** 需求分析 v2 列表页：记录列表 + 新建分析（上传/粘贴 → SSE → 落库跳转详情） */
export function RequirementAnalysisPage() {
  const navigate = useNavigate()
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

  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
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

  const handleDelete = async () => {
    if (!pendingDelete) return
    try {
      await deleteAnalysisRecord(pendingDelete.id)
      setPendingDelete(null)
      void loadList(page)
    } catch (err) {
      showError(err, { title: '删除失败', fallbackMessage: '删除分析记录失败，请稍后重试。' })
    }
  }

  const handleRename = async (id: string) => {
    const title = renamingTitle.trim()
    if (!title) return
    try {
      await renameAnalysisRecord(id, title)
      setRenamingId(null)
      void loadList(page)
    } catch (err) {
      showError(err, { title: '重命名失败', fallbackMessage: '重命名失败，请稍后重试。' })
    }
  }

  return (
    <div className="page-shell ra2-page">
      <header className="ra2-header">
        <div>
          <h1>
            <FileSearch className="h-5 w-5" /> 需求分析
          </h1>
          <p className="text-muted">
            上传需求文档，AI 产出可测试化分析：问题日志、验收准则、测试条件与追溯矩阵
            {storageMode === 'memory' && <span className="ra2-memory-badge">（内存模式：重启后记录不保留）</span>}
          </p>
        </div>
      </header>

      <section className="ra2-create" aria-label="新建分析">
        <div className="ra2-create-input">
          <div className="ra2-create-toolbar">
            <button
              type="button"
              className="secondary-action"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing || analyzing}
            >
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {parsing ? '解析中…' : '上传文档'}
            </button>
            <span className="text-muted ra2-accept-hint">{FILE_ACCEPT.split(',').join(' / ')}</span>
            {fileName && (
              <span className="ra2-file-chip">
                <FileText className="h-3.5 w-3.5" /> {fileName}
                <button type="button" aria-label="移除文件" onClick={() => { setFileName(null); setSourceText(''); setParseWarnings([]) }}>×</button>
              </span>
            )}
          </div>
          <textarea
            className="ra2-textarea"
            placeholder="粘贴需求文本，或上传需求文档…"
            value={sourceText}
            onChange={(e) => { setSourceText(e.target.value); setFileName(null) }}
            rows={6}
            disabled={analyzing}
          />
          {parseWarnings.map((w, i) => (
            <p key={i} className="ra2-warning" role="note">{w}</p>
          ))}
          {fieldError && <p className="ra2-field-error" role="alert">{fieldError}</p>}
          <div className="ra2-create-actions">
            <button type="button" className="primary-action" onClick={() => void handleAnalyze()} disabled={analyzing || parsing}>
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
              {analyzing ? progressMessage || '分析中…' : '开始分析'}
            </button>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept={FILE_ACCEPT} hidden onChange={(e) => void handleFile(e)} />
      </section>

      <section className="ra2-list" aria-label="分析记录">
        {listLoading ? (
          <p className="text-muted">正在加载分析记录…</p>
        ) : records.length === 0 ? (
          <p className="text-muted">暂无分析记录，从上方开始一次分析。</p>
        ) : (
          <ul className="ra2-record-list">
            {records.map((record) => (
              <li key={record.id} className="ra2-record-card">
                {renamingId === record.id ? (
                  <input
                    className="ra2-rename-input"
                    value={renamingTitle}
                    autoFocus
                    aria-label="重命名记录"
                    onChange={(e) => setRenamingTitle(e.target.value)}
                    onBlur={() => void handleRename(record.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename(record.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <button type="button" className="ra2-record-open" onClick={() => navigate(`/requirement-analysis/records/${record.id}`)}>
                    {record.title}
                  </button>
                )}
                <div className="ra2-record-meta">
                  <span>{formatRelativeTime(record.updatedAt)}</span>
                  <span>问题 {record.issueCount}（待澄清 {record.openIssueCount}）</span>
                  <span>条件 {record.conditionCount} · 覆盖 {record.coveredConditionCount}</span>
                </div>
                <div className="ra2-record-ops">
                  <Tooltip content="重命名">
                    <button type="button" aria-label={`重命名 ${record.title}`} onClick={() => { setRenamingId(record.id); setRenamingTitle(record.title) }}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  </Tooltip>
                  <Tooltip content="删除">
                    <button type="button" aria-label={`删除 ${record.title}`} onClick={() => setPendingDelete(record)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        )}
        {totalPages > 1 && (
          <div className="ra2-pagination">
            <button type="button" disabled={page <= 1} onClick={() => void loadList(page - 1)}>上一页</button>
            <span>{page} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => void loadList(page + 1)}>下一页</button>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除分析记录"
        description={`将删除「${pendingDelete?.title ?? ''}」及其全部问题、准则与测试条件，操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
