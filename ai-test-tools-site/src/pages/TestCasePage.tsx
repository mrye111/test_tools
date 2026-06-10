import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, FileSpreadsheet, Loader2, Settings, Sparkles, Trash2, X } from 'lucide-react'
import { CustomSelect } from '../components/ui/CustomSelect'
import {
  createGenerateJob,
  exportTestCaseExcel,
  exportTestCaseXmind,
  getTestCaseExportFormats,
  loadStoredModelConfig,
  toTestCaseAiConfig,
  waitForGenerateJob,
  type GenerateJobStatusResponse,
  type StoredModelConfig,
  type TestCaseExportFormat,
} from '../lib/testcase-api'

const DEFAULT_HEADER = ['用例编号', '功能模块/接口名称', '功能测试点/请求方式及路径', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']
const FUNCTIONAL_HEADER = ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']
const API_HEADER = ['用例编号', '接口名称', '请求方式及路径', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']
const EN_FUNCTIONAL_HEADER = ['Case ID', 'Module', 'Test Point', 'Case Title', 'Priority', 'Preconditions', 'Test Steps', 'Expected Results']
const EN_API_HEADER = ['Case ID', 'API Name', 'Request Method & Path', 'Case Title', 'Priority', 'Preconditions', 'Test Steps', 'Expected Results']
const KNOWN_HEADERS = [FUNCTIONAL_HEADER, API_HEADER, EN_FUNCTIONAL_HEADER, EN_API_HEADER, DEFAULT_HEADER]
const JOB_STORAGE_KEY = 'ai_test_tools_testcase_jobs'
const inputCls = 'field-control'
const labelCls = 'field-label'

type TestType = 'functional' | 'api'
type Language = 'zh' | 'en'
type CoverageMode = 'quick' | 'standard' | 'expert'
type JobData = NonNullable<GenerateJobStatusResponse['data']>

const COVERAGE_DEFAULT_MAX: Record<CoverageMode, number> = {
  quick: 8,
  standard: 20,
  expert: 40,
}

const COVERAGE_LABEL: Record<CoverageMode, string> = {
  quick: '快速覆盖',
  standard: '标准覆盖',
  expert: '专家覆盖',
}

const COVERAGE_OPTIONS = [
  { value: 'quick', label: '快速覆盖（最多 8 条）' },
  { value: 'standard', label: '标准覆盖（最多 20 条）' },
  { value: 'expert', label: '专家覆盖（最多 40 条）' },
]

const TEST_TYPE_OPTIONS = [
  { value: 'functional', label: '功能测试' },
  { value: 'api', label: 'API 测试' },
]

const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 条/页' },
  { value: '20', label: '20 条/页' },
  { value: '30', label: '30 条/页' },
  { value: '50', label: '50 条/页' },
]

function isCaseRow(row: string[]) {
  const caseId = String(row[0] ?? '').trim()
  return /^((api[-_\s]?)?tc[-_\s]?\d+|case[-_\s]?\d+|用例[-_\s]?\d+)/i.test(caseId)
}

function sanitizeRows(rows: string[][] | undefined) {
  return (rows ?? []).filter(isCaseRow)
}

function resultRows(job: JobData | null) {
  if (!job) return []
  const rows = sanitizeRows(job.resultRows)
  if (rows.length > 0) return rows
  return sanitizeRows(job.testSetSnapshot?.rows)
}

function resultHeader(job: JobData | null) {
  if (!job) return DEFAULT_HEADER
  const resultHeader = normalizeDisplayHeader(job.resultHeader)
  if (resultHeader.length > 0) return resultHeader
  const snapshotHeader = normalizeDisplayHeader(job.testSetSnapshot?.header ?? [])
  if (snapshotHeader.length > 0) return snapshotHeader
  return DEFAULT_HEADER
}

function normalizeDisplayHeader(header: string[]) {
  if (!header.length) return []
  const normalized = header.map((item) => item.trim().toLowerCase())
  for (const candidate of KNOWN_HEADERS) {
    const expected = candidate.map((item) => item.trim().toLowerCase())
    for (let start = 0; start < normalized.length; start += 1) {
      const matches = expected.filter((item, index) => normalized[start + index] === item).length
      if (matches >= 4) return candidate
    }
  }
  return header.map((item) => item.trim())
}

function jobTitle(job: JobData | null) {
  return job?.featureName?.trim() || '未命名用例生成任务'
}

function isBusyJob(job: JobData | null) {
  return job?.status === 'queued' || job?.status === 'running'
}

function createPendingJob(
  created: {
    jobId: string
    status: string
    testSetId: string
    mode: string
  },
  detail: {
    featureName: string
    context: string
    testType: TestType
    language: Language
    coverageMode: CoverageMode
    maxCases: number
  },
): JobData {
  return {
    jobId: created.jobId,
    status: created.status as JobData['status'],
    mode: created.mode,
    testSetId: created.testSetId,
    projectId: '',
    featureName: detail.featureName,
    context: detail.context,
    testType: detail.testType,
    language: detail.language,
    coverageMode: detail.coverageMode,
    maxCases: detail.maxCases,
    generatedCount: 0,
    error: '',
    streamText: '',
    createdAt: new Date().toISOString(),
    resultHeader: DEFAULT_HEADER,
    resultRows: [],
  }
}

function jobStatusText(status?: JobData['status']) {
  if (status === 'queued') return '排队中'
  if (status === 'running') return '生成中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  return '未开始'
}

function jobStatusIcon(job: JobData) {
  if (job.status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (job.status === 'failed') return <AlertCircle className="h-4 w-4 text-rose-500" />
  if (isBusyJob(job)) return <Loader2 className="h-4 w-4 animate-spin text-accent" />
  return <Clock3 className="h-4 w-4 text-muted" />
}

function statusBadgeClass(status?: JobData['status']) {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700 ring-emerald-100'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 ring-rose-100'
  if (status === 'running') return 'bg-blue-50 text-blue-700 ring-blue-100'
  return 'bg-slate-50 text-slate-600 ring-slate-100'
}

function formatTime(value?: string) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function displayCellText(value: unknown) {
  return String(value ?? '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
}

function mergeJob(previous: JobData, next: JobData): JobData {
  return {
    ...previous,
    ...next,
    featureName: next.featureName || previous.featureName,
    context: next.context || previous.context,
    testType: next.testType || previous.testType,
    language: next.language || previous.language,
    coverageMode: next.coverageMode || previous.coverageMode,
    maxCases: next.maxCases ?? previous.maxCases,
    streamText: next.streamText ?? previous.streamText ?? '',
    resultHeader: next.resultHeader.length > 0 ? next.resultHeader : previous.resultHeader,
    resultRows: next.resultRows.length > 0 ? sanitizeRows(next.resultRows) : sanitizeRows(previous.resultRows),
    testSetSnapshot: next.testSetSnapshot ?? previous.testSetSnapshot,
  }
}

function normalizeStoredJob(value: unknown): JobData | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<JobData>
  if (!item.jobId || !item.status || !item.testSetId || !item.mode || !item.createdAt) return null
  return {
    jobId: String(item.jobId),
    status: item.status,
    mode: String(item.mode),
    testSetId: String(item.testSetId),
    projectId: String(item.projectId ?? ''),
    featureName: item.featureName ? String(item.featureName) : undefined,
    context: item.context ? String(item.context) : undefined,
    testType: item.testType ? String(item.testType) : undefined,
    language: item.language ? String(item.language) : undefined,
    coverageMode: item.coverageMode && ['quick', 'standard', 'expert'].includes(item.coverageMode) ? item.coverageMode : undefined,
    maxCases: typeof item.maxCases === 'number' ? item.maxCases : undefined,
    generatedCount: Number(item.generatedCount ?? 0),
    error: String(item.error ?? ''),
    streamText: String(item.streamText ?? ''),
    createdAt: String(item.createdAt),
    startedAt: item.startedAt ? String(item.startedAt) : undefined,
    finishedAt: item.finishedAt ? String(item.finishedAt) : undefined,
    resultHeader: Array.isArray(item.resultHeader) ? item.resultHeader.map(String) : [],
    resultRows: Array.isArray(item.resultRows) ? item.resultRows.filter(Array.isArray).map((row) => row.map(String)).filter(isCaseRow) : [],
    testSetSnapshot: item.testSetSnapshot && typeof item.testSetSnapshot === 'object'
      ? {
          status: String(item.testSetSnapshot.status ?? ''),
          header: Array.isArray(item.testSetSnapshot.header) ? item.testSetSnapshot.header.map(String) : [],
          rows: Array.isArray(item.testSetSnapshot.rows) ? item.testSetSnapshot.rows.filter(Array.isArray).map((row) => row.map(String)).filter(isCaseRow) : [],
          updatedAt: String(item.testSetSnapshot.updatedAt ?? ''),
        }
      : undefined,
  }
}

function loadStoredJobs(): JobData[] {
  try {
    const raw = window.localStorage.getItem(JOB_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeStoredJob).filter((item): item is JobData => Boolean(item))
  } catch {
    return []
  }
}

function saveStoredJobs(jobs: JobData[]) {
  try {
    window.localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(jobs.slice(0, 50)))
  } catch {
    // 本地存储不可用时不阻断生成流程。
  }
}

export function TestCasePage() {
  const [modelConfig, setModelConfig] = useState<StoredModelConfig | null>(() => loadStoredModelConfig())
  const [formats, setFormats] = useState<TestCaseExportFormat[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [featureName, setFeatureName] = useState('登录功能')
  const [context, setContext] = useState('用户名必填，密码必填，登录成功后跳转首页，失败时展示错误提示。')
  const [testType, setTestType] = useState<TestType>('functional')
  const [language, setLanguage] = useState<Language>('zh')
  const [coverageMode, setCoverageMode] = useState<CoverageMode>('standard')
  const [maxCases, setMaxCases] = useState(COVERAGE_DEFAULT_MAX.standard)

  const [jobs, setJobs] = useState<JobData[]>(() => loadStoredJobs())
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const pollingJobIdsRef = useRef(new Set<string>())
  const deletedJobIdsRef = useRef(new Set<string>())
  const [generating, setGenerating] = useState(false)
  const [generateMessage, setGenerateMessage] = useState<string | null>(null)

  const [exportFormat, setExportFormat] = useState('default')
  const [issueType, setIssueType] = useState('Test')
  const [component, setComponent] = useState('')
  const [labels, setLabels] = useState('')
  const [productName, setProductName] = useState('')
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingXmind, setExportingXmind] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    void refreshFormats()
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    saveStoredJobs(jobs)
  }, [jobs])

  useEffect(() => {
    if (selectedJobId && !jobs.some((item) => item.jobId === selectedJobId)) {
      setSelectedJobId(jobs[0]?.jobId ?? null)
    }
  }, [jobs, selectedJobId])

  useEffect(() => {
    jobs.filter(isBusyJob).forEach((item) => {
      startJobPolling(item)
    })
  }, [])

  const selectedJob = useMemo(() => jobs.find((item) => item.jobId === selectedJobId) ?? jobs[0] ?? null, [jobs, selectedJobId])
  const rows = useMemo(() => resultRows(selectedJob), [selectedJob])
  const header = useMemo(() => resultHeader(selectedJob), [selectedJob])
  const hasJobs = jobs.length > 0
  const hasRows = rows.length > 0
  const isGeneratingJob = isBusyJob(selectedJob)
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const pageStartIndex = (safeCurrentPage - 1) * pageSize
  const pagedRows = useMemo(() => rows.slice(pageStartIndex, pageStartIndex + pageSize), [rows, pageStartIndex, pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedJob?.jobId])

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  async function refreshFormats() {
    setBackendError(null)
    try {
      const nextFormats = await getTestCaseExportFormats()
      setFormats(nextFormats)
      if (nextFormats.length > 0) setExportFormat((current) => (nextFormats.some((item) => item.key === current) ? current : nextFormats[0].key))
    } catch (error) {
      setFormats([])
      setBackendError(error instanceof Error ? error.message : '用例生成服务不可用')
    }
  }

  function upsertJob(nextJob: JobData) {
    if (deletedJobIdsRef.current.has(nextJob.jobId)) return
    setJobs((current) => {
      const index = current.findIndex((item) => item.jobId === nextJob.jobId)
      if (index < 0) return [nextJob, ...current]
      return current.map((item, itemIndex) => (itemIndex === index ? mergeJob(item, nextJob) : item))
    })
  }

  function startJobPolling(baseJob: JobData) {
    if (pollingJobIdsRef.current.has(baseJob.jobId)) return
    pollingJobIdsRef.current.add(baseJob.jobId)
    void waitForGenerateJob(baseJob.jobId, (snapshot) => {
      if (!mountedRef.current) return
      upsertJob(snapshot)
      if (snapshot.status === 'running') setGenerateMessage(`${jobTitle(snapshot)} 正在生成，已解析 ${resultRows(snapshot).length} 条用例`)
    })
      .then((finalJob) => {
        if (!mountedRef.current) return
        upsertJob(finalJob)
        if (finalJob.status === 'failed') {
          setPageError(finalJob.error || '生成任务失败')
          setGenerateMessage(null)
          return
        }
        setGenerateMessage(`${jobTitle(finalJob)} 生成完成，共 ${resultRows(finalJob).length} 条用例`)
      })
      .catch((error) => {
        if (!mountedRef.current) return
        const message = error instanceof Error ? error.message : '生成任务轮询失败'
        setPageError(message)
        upsertJob({
          ...baseJob,
          status: 'failed',
          error: message,
          finishedAt: new Date().toISOString(),
        })
      })
      .finally(() => {
        pollingJobIdsRef.current.delete(baseJob.jobId)
      })
  }

  function requireModelConfig() {
    const config = loadStoredModelConfig()
    setModelConfig(config)
    if (!config) throw new Error('请先在模型设置中配置 Base URL、API Key 和模型 ID')
    return config
  }

  async function handleGenerate() {
    setGenerating(true)
    setPageError(null)
    setGenerateMessage(null)
    try {
      const config = requireModelConfig()
      const safeMaxCases = Number.isFinite(maxCases) && maxCases > 0 ? Math.min(100, Math.floor(maxCases)) : COVERAGE_DEFAULT_MAX[coverageMode]
      const requestDetail = { featureName, context, testType, language, coverageMode, maxCases: safeMaxCases }
      const created = await createGenerateJob({
        mode: 'create',
        featureName,
        context,
        testType,
        language,
        coverageMode,
        maxCases: safeMaxCases,
        aiConfig: toTestCaseAiConfig(config),
      })

      const pendingJob = createPendingJob(created, requestDetail)
      deletedJobIdsRef.current.delete(created.jobId)
      upsertJob(pendingJob)
      setSelectedJobId(created.jobId)
      setShowCreateModal(false)
      setGenerateMessage('任务已创建，正在生成用例...')
      startJobPolling(pendingJob)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  async function handleExportExcel() {
    if (!hasRows || !selectedJob) return
    setExportingExcel(true)
    setPageError(null)
    try {
      await exportTestCaseExcel({
        featureName: jobTitle(selectedJob),
        format: exportFormat,
        rows,
        issueType,
        component,
        labels,
        productName,
      })
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '导出 Excel 失败')
    } finally {
      setExportingExcel(false)
    }
  }

  async function handleExportXmind() {
    if (!hasRows || !selectedJob) return
    setExportingXmind(true)
    setPageError(null)
    try {
      await exportTestCaseXmind({ featureName: jobTitle(selectedJob), rows })
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '导出 XMind 失败')
    } finally {
      setExportingXmind(false)
    }
  }

  function handleDeleteCase(rowIndex: number) {
    if (!selectedJob || isBusyJob(selectedJob)) return
    const absoluteRowIndex = pageStartIndex + rowIndex
    setJobs((current) => current.map((item) => {
      if (item.jobId !== selectedJob.jobId) return item
      const currentRows = resultRows(item)
      const nextRows = currentRows.filter((_, index) => index !== absoluteRowIndex)
      return {
        ...item,
        generatedCount: nextRows.length,
        resultRows: nextRows,
        testSetSnapshot: item.testSetSnapshot
          ? {
              ...item.testSetSnapshot,
              rows: nextRows,
              updatedAt: new Date().toISOString(),
            }
          : item.testSetSnapshot,
      }
    }))
  }

  function handleDeleteJob(jobId: string) {
    deletedJobIdsRef.current.add(jobId)
    pollingJobIdsRef.current.delete(jobId)
    if (selectedJob?.jobId === jobId) {
      setSelectedJobId(null)
      setGenerateMessage(null)
      setPageError(null)
    }
    setJobs((current) => current.filter((item) => item.jobId !== jobId))
  }

  return (
    <div className="page-shell testcase-page-shell">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="icon-action h-10 w-10"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="page-title">用例生成</h1>
            <p className="page-subtitle">点击新建后先创建生成任务，再在详情中实时查看有效用例结果</p>
          </div>
        </div>

        <Link
          to="/settings"
          className="secondary-action px-3 py-2 text-xs no-underline"
        >
          <Settings className="h-3.5 w-3.5" />
          模型设置
        </Link>
      </div>

      {(backendError || pageError || generateMessage) && (
        <div className={`mb-5 px-4 py-3 text-sm ${pageError || backendError ? 'status-panel danger-panel text-[#b91c1c]' : 'status-panel text-[#1d4ed8]'}`}>
          <div className="relative z-[1] flex items-start gap-2">
            {pageError || backendError ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{pageError || backendError || generateMessage}</span>
          </div>
        </div>
      )}

      {!hasJobs ? (
        <section className="surface-panel motion-card stagger-1 flex min-h-[520px] items-center justify-center rounded-[30px] px-6 py-12 max-sm:min-h-[420px]">
          <div className="relative z-[1] max-w-[560px] text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(37,99,235,0.08)] text-accent">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="font-display text-[28px] font-semibold tracking-[-0.05em] text-fg">还没有生成用例</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              点击新建后，页面会先出现一个生成任务。进入任务详情即可看到实时解析出的有效用例。
            </p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="primary-action mt-8 px-6 py-2.5 text-sm"
            >
              <Sparkles className="h-4 w-4" />
              新建用例
            </button>
            {!modelConfig && (
              <p className="mt-4 text-xs text-[#92400e]">
                检测到还没有模型配置，请先进入模型设置填写后再生成。
              </p>
            )}
          </div>
        </section>
      ) : (
        <section className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="surface-panel motion-card stagger-1 rounded-[28px] p-4">
            <div className="relative z-[1] mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-[-0.04em] text-fg">任务列表</h2>
                <p className="mt-1 text-xs text-muted">共 {jobs.length} 个生成任务</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="primary-action px-3 py-2 text-xs"
              >
                <Sparkles className="h-3.5 w-3.5" />
                新建
              </button>
            </div>

            <div className="relative z-[1] space-y-3">
              {jobs.map((item, itemIndex) => {
                const active = item.jobId === selectedJob?.jobId
                const countText = resultRows(item).length || item.generatedCount || 0
                return (
                  <div
                    key={item.jobId}
                    className={`group flex w-full items-stretch gap-2 rounded-2xl border p-2 text-left transition-all ${
                      active
                        ? 'border-[rgba(37,99,235,0.45)] bg-[rgba(239,246,255,0.78)] shadow-[0_18px_42px_-30px_rgba(37,99,235,0.65)]'
                        : 'border-slate-200 bg-white/72 hover:-translate-y-0.5 hover:border-[rgba(37,99,235,0.28)] hover:bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedJobId(item.jobId)}
                      className="flex min-w-0 flex-1 items-start justify-between gap-3 rounded-xl px-2 py-2 text-left"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(37,99,235,0.08)]">
                          {jobStatusIcon(item)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-fg">{jobTitle(item)}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                            <span>{formatTime(item.createdAt)}</span>
                            <span>{countText} 条用例</span>
                          </div>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${statusBadgeClass(item.status)}`}>
                        {jobStatusText(item.status)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteJob(item.jobId)}
                      className="icon-action mt-1 h-8 w-8 shrink-0 text-rose-500 opacity-70 hover:text-rose-600 group-hover:opacity-100"
                      aria-label={`删除任务 ${itemIndex + 1}`}
                      title="删除任务"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </aside>

          <section className="surface-panel motion-card stagger-2 rounded-[28px] p-5 max-sm:p-3.5">
            <div className="relative z-[1] mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">{jobTitle(selectedJob)}</h2>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                  {isGeneratingJob && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
                  <span>共 {rows.length} 条，任务状态：{jobStatusText(selectedJob?.status)}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <CustomSelect
                  value={exportFormat}
                  onChange={setExportFormat}
                  options={formats.map((item) => ({ value: item.key, label: item.name }))}
                  placeholder="导出格式"
                  className="min-w-[190px] text-xs"
                />
                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={!hasRows || exportingExcel}
                  className="primary-action px-4 py-2 text-xs disabled:opacity-50"
                >
                  {exportingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  导出 Excel
                </button>
                <button
                  type="button"
                  onClick={handleExportXmind}
                  disabled={!hasRows || exportingXmind}
                  className="secondary-action px-4 py-2 text-xs disabled:opacity-50"
                >
                  {exportingXmind ? '导出中...' : '导出 XMind'}
                </button>
              </div>
            </div>

            {(exportFormat === 'jira' || exportFormat === 'zentao') && (
              <div className="relative z-[1] mb-5 grid gap-3 rounded-2xl border border-[rgba(37,99,235,0.16)] bg-[rgba(239,246,255,0.55)] p-4 md:grid-cols-3">
                {exportFormat === 'jira' ? (
                  <>
                    <div>
                      <label className={labelCls}>Issue Type</label>
                      <input value={issueType} onChange={(event) => setIssueType(event.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Component</label>
                      <input value={component} onChange={(event) => setComponent(event.target.value)} className={inputCls} placeholder="账号中心" />
                    </div>
                    <div>
                      <label className={labelCls}>Labels</label>
                      <input value={labels} onChange={(event) => setLabels(event.target.value)} className={inputCls} placeholder="login,smoke" />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className={labelCls}>产品名称</label>
                    <input value={productName} onChange={(event) => setProductName(event.target.value)} className={inputCls} placeholder="用户中心" />
                  </div>
                )}
              </div>
            )}

            <div className="table-shell testcase-table-shell relative z-[1]">
              <table className="testcase-result-table border-collapse text-left text-[12px]">
                <colgroup>
                  <col className="w-[96px]" />
                  <col className="w-[130px]" />
                  <col className="w-[180px]" />
                  <col className="w-[220px]" />
                  <col className="w-[86px]" />
                  <col className="w-[260px]" />
                  <col className="w-[360px]" />
                  <col className="w-[360px]" />
                  <col className="w-[92px]" />
                </colgroup>
                <thead>
                  <tr>
                    {header.map((cell) => (
                      <th key={cell} className="border-b border-slate-200 px-4 py-3 font-semibold whitespace-nowrap">{cell}</th>
                    ))}
                    <th className="border-b border-slate-200 px-4 py-3 text-center font-semibold whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {hasRows ? (
                    pagedRows.map((row, rowIndex) => (
                      <tr key={`case-row-${rowIndex}`} className="align-top odd:bg-white even:bg-slate-50/70">
                        {header.map((_, cellIndex) => (
                          <td key={`case-cell-${rowIndex}-${cellIndex}`} className="testcase-cell border-b border-slate-100 px-4 py-3 text-[#334155]">
                            {displayCellText(row[cellIndex])}
                          </td>
                        ))}
                        <td className="border-b border-slate-100 px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteCase(rowIndex)}
                            disabled={isGeneratingJob}
                            className="icon-action h-8 w-8 text-rose-500 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-40"
                            aria-label={`删除用例 ${row[0] ?? rowIndex + 1}`}
                            title={isGeneratingJob ? '生成中不可删除' : '删除用例'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="bg-white">
                      <td colSpan={header.length + 1} className="border-b border-slate-100 px-4 py-10 text-center text-sm text-muted">
                        <div className="inline-flex items-center gap-2">
                          {isGeneratingJob && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
                          <span>
                            {selectedJob?.status === 'failed'
                              ? (selectedJob.error || '生成任务失败，请调整需求或模型配置后重试。')
                              : isGeneratingJob
                                ? 'AI 正在生成用例，解析到有效用例后会实时显示在这里...'
                                : '暂无有效用例结果'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {hasRows && (
              <div className="relative z-[1] mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/72 px-4 py-3">
                <div className="text-xs text-muted">
                  显示第 {pageStartIndex + 1}-{Math.min(pageStartIndex + pagedRows.length, rows.length)} 条，共 {rows.length} 条
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CustomSelect
                    value={String(pageSize)}
                    onChange={(value) => {
                      setPageSize(Math.min(50, Math.max(10, Number(value) || 10)))
                      setCurrentPage(1)
                    }}
                    options={PAGE_SIZE_OPTIONS}
                    className="w-[118px] text-xs"
                    placement="top"
                  />
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={safeCurrentPage <= 1}
                    className="secondary-action px-3 py-2 text-xs disabled:pointer-events-none disabled:opacity-45"
                  >
                    上一页
                  </button>
                  <span className="min-w-[72px] text-center text-xs font-semibold text-fg">
                    {safeCurrentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={safeCurrentPage >= totalPages}
                    className="secondary-action px-3 py-2 text-xs disabled:pointer-events-none disabled:opacity-45"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </section>
        </section>
      )}

      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-panel max-h-[90vh] w-full max-w-[720px] overflow-auto rounded-[26px] p-6 max-sm:p-4">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">新建用例生成</h2>
                <p className="mt-1 text-sm text-muted">填写最少信息即可创建生成任务，任务会立即出现在列表中。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                disabled={generating}
                className="icon-action h-8 w-8 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelCls}>功能名称</label>
                <input value={featureName} onChange={(event) => setFeatureName(event.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>覆盖模式</label>
                <CustomSelect
                  value={coverageMode}
                  onChange={(value) => {
                    const nextMode = value as CoverageMode
                    setCoverageMode(nextMode)
                    setMaxCases(COVERAGE_DEFAULT_MAX[nextMode])
                  }}
                  options={COVERAGE_OPTIONS}
                />
              </div>
              <div>
                <label className={labelCls}>测试类型</label>
                <CustomSelect value={testType} onChange={(value) => setTestType(value as TestType)} options={TEST_TYPE_OPTIONS} />
              </div>
              <div>
                <label className={labelCls}>最大条数上限</label>
                <input type="number" min={1} max={100} value={maxCases} onChange={(event) => setMaxCases(Number(event.target.value))} className={inputCls} />
                <p className="helper-text">硬上限，不要求 AI 凑满；当前为{COVERAGE_LABEL[coverageMode]}。</p>
              </div>
              <div>
                <label className={labelCls}>输出语言</label>
                <CustomSelect value={language} onChange={(value) => setLanguage(value as Language)} options={LANGUAGE_OPTIONS} />
              </div>
            </div>

            <div className="mt-4">
              <label className={labelCls}>需求描述</label>
              <textarea
                value={context}
                onChange={(event) => setContext(event.target.value)}
                rows={8}
                className={inputCls}
                placeholder="描述业务规则、输入输出、异常场景、边界条件等。"
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                disabled={generating}
                className="secondary-action px-4 py-2 text-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="primary-action px-5 py-2 text-sm disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? '创建中...' : '开始生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
