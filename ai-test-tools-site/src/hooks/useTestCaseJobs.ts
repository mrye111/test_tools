import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createGenerateJob,
  exportTestCaseExcel,
  exportTestCaseXmind,
  getTestCaseExportFormats,
  loadStoredModelConfig,
  waitForGenerateJob,
  type GenerateJobStatusResponse,
  type StoredModelConfig,
  type TestCaseExportFormat,
} from '../lib/testcase-api'
import { toAiConfig } from '../shared/api-types'

// ── Types ──────────────────────────────────────────────────────────────────────

export type TestType = 'functional' | 'api'
export type Language = 'zh' | 'en'
export type CoverageMode = 'quick' | 'standard' | 'expert'
export type JobData = NonNullable<GenerateJobStatusResponse['data']>

// ── Constants ──────────────────────────────────────────────────────────────────

export const DEFAULT_HEADER = ['用例编号', '功能模块/接口名称', '功能测试点/请求方式及路径', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']
const FUNCTIONAL_HEADER = ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']
const API_HEADER = ['用例编号', '接口名称', '请求方式及路径', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']
const EN_FUNCTIONAL_HEADER = ['Case ID', 'Module', 'Test Point', 'Case Title', 'Priority', 'Preconditions', 'Test Steps', 'Expected Results']
const EN_API_HEADER = ['Case ID', 'API Name', 'Request Method & Path', 'Case Title', 'Priority', 'Preconditions', 'Test Steps', 'Expected Results']
const KNOWN_HEADERS = [FUNCTIONAL_HEADER, API_HEADER, EN_FUNCTIONAL_HEADER, EN_API_HEADER, DEFAULT_HEADER]
const JOB_STORAGE_KEY = 'ai_test_tools_testcase_jobs'

export const COVERAGE_DEFAULT_MAX: Record<CoverageMode, number> = {
  quick: 8,
  standard: 20,
  expert: 40,
}

export const COVERAGE_LABEL: Record<CoverageMode, string> = {
  quick: '快速覆盖',
  standard: '标准覆盖',
  expert: '专家覆盖',
}

export const COVERAGE_OPTIONS = [
  { value: 'quick', label: '快速覆盖（最多 8 条）' },
  { value: 'standard', label: '标准覆盖（最多 20 条）' },
  { value: 'expert', label: '专家覆盖（最多 40 条）' },
]

export const TEST_TYPE_OPTIONS = [
  { value: 'functional', label: '功能测试' },
  { value: 'api', label: 'API 测试' },
]

export const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

export const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 条/页' },
  { value: '20', label: '20 条/页' },
  { value: '30', label: '30 条/页' },
  { value: '50', label: '50 条/页' },
]

// ── Pure helpers ───────────────────────────────────────────────────────────────

export function isCaseRow(row: string[]) {
  const caseId = String(row[0] ?? '').trim()
  return /^((api[-_\s]?)?tc[-_\s]?\d+|case[-_\s]?\d+|用例[-_\s]?\d+)/i.test(caseId)
}

function sanitizeRows(rows: string[][] | undefined) {
  return (rows ?? []).filter(isCaseRow)
}

export function resultRows(job: JobData | null) {
  if (!job) return []
  const rows = sanitizeRows(job.resultRows)
  if (rows.length > 0) return rows
  return sanitizeRows(job.testSetSnapshot?.rows)
}

function resultHeader(job: JobData | null) {
  if (!job) return DEFAULT_HEADER
  const rh = normalizeDisplayHeader(job.resultHeader)
  if (rh.length > 0) return rh
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

export function jobTitle(job: JobData | null) {
  return job?.featureName?.trim() || '未命名用例生成任务'
}

export function isBusyJob(job: JobData | null) {
  return job?.status === 'queued' || job?.status === 'running'
}

function createPendingJob(
  created: { jobId: string; status: string; testSetId: string; mode: string },
  detail: { featureName: string; context: string; testType: TestType; language: Language; coverageMode: CoverageMode; maxCases: number },
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

export function jobStatusText(status?: JobData['status']) {
  if (status === 'queued') return '排队中'
  if (status === 'running') return '生成中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  return '未开始'
}

export function statusBadgeClass(status?: JobData['status']) {
  if (status === 'completed') return 'badge badge-success'
  if (status === 'failed') return 'badge badge-danger'
  if (status === 'running') return 'badge badge-accent'
  return 'badge badge-muted'
}

export function formatTime(value?: string) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function displayCellText(value: unknown) {
  return String(value ?? '').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n')
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

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useTestCaseJobs(formState: {
  featureName: string
  context: string
  testType: TestType
  language: Language
  coverageMode: CoverageMode
  maxCases: number
  setShowCreateModal: (v: boolean) => void
}) {
  const { featureName, context, testType, language, coverageMode, maxCases, setShowCreateModal } = formState

  const [modelConfig, setModelConfig] = useState<StoredModelConfig | null>(() => loadStoredModelConfig())
  const [formats, setFormats] = useState<TestCaseExportFormat[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

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

  // ── Effects ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    void refreshFormats()
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => { saveStoredJobs(jobs) }, [jobs])

  useEffect(() => {
    if (selectedJobId && !jobs.some((item) => item.jobId === selectedJobId)) {
      setSelectedJobId(jobs[0]?.jobId ?? null)
    }
  }, [jobs, selectedJobId])

  useEffect(() => {
    jobs.filter(isBusyJob).forEach((item) => { startJobPolling(item) })
  }, [])

  // ── Computed values ────────────────────────────────────────────────────────────

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

  useEffect(() => { setCurrentPage(1) }, [selectedJob?.jobId])
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages) }, [currentPage, totalPages])

  // ── Handlers ───────────────────────────────────────────────────────────────────

  async function refreshFormats() {
    setBackendError(null)
    try {
      const nextFormats = await getTestCaseExportFormats()
      setFormats(nextFormats)
      if (nextFormats.length > 0) setExportFormat((c) => (nextFormats.some((i) => i.key === c) ? c : nextFormats[0].key))
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
      return current.map((item, i) => (i === index ? mergeJob(item, nextJob) : item))
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
        upsertJob({ ...baseJob, status: 'failed', error: message, finishedAt: new Date().toISOString() })
      })
      .finally(() => { pollingJobIdsRef.current.delete(baseJob.jobId) })
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
        mode: 'create', featureName, context, testType, language, coverageMode, maxCases: safeMaxCases,
        aiConfig: toAiConfig(config),
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
      await exportTestCaseExcel({ featureName: jobTitle(selectedJob), format: exportFormat, rows, issueType, component, labels, productName })
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
        testSetSnapshot: item.testSetSnapshot ? { ...item.testSetSnapshot, rows: nextRows, updatedAt: new Date().toISOString() } : item.testSetSnapshot,
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

  return {
    modelConfig, formats, backendError, pageError, setPageError,
    jobs, selectedJobId, setSelectedJobId,
    generating, generateMessage,
    exportFormat, setExportFormat,
    issueType, setIssueType,
    component, setComponent,
    labels, setLabels,
    productName, setProductName,
    exportingExcel, exportingXmind,
    pageSize, setPageSize,
    currentPage, setCurrentPage,
    selectedJob, rows, header,
    hasJobs, hasRows, isGeneratingJob,
    totalPages, safeCurrentPage, pageStartIndex, pagedRows,
    handleGenerate, handleExportExcel, handleExportXmind, handleDeleteCase, handleDeleteJob,
  }
}
