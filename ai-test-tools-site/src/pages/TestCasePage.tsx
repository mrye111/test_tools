import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileSpreadsheet,
  FolderKanban,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { CustomSelect } from '../components/ui/CustomSelect'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { ModalPortal } from '../components/ui/ModalPortal'
import { Tooltip } from '../components/ui/Tooltip'
import {
  LANGUAGE_OPTIONS,
  TEST_TYPE_OPTIONS,
  type Language,
  type TestType,
} from '../hooks/testcase-constants'
import { displayCellText, normalizeDisplayHeader } from '../hooks/testcase-helpers'
import { useTestCaseWorkspace } from '../hooks/useTestCaseWorkspace'
import { normalizeErrorMessage } from '../lib/app-error'
import { REQUIREMENT_HANDOFF_KEY } from '../lib/requirement-analysis-api'
import type { TestCaseProject, TestCaseSet } from '../lib/testcase-api'

const inputCls = 'field-control'
const labelCls = 'field-label'
const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 条/页' },
  { value: '20', label: '20 条/页' },
  { value: '50', label: '50 条/页' },
]
const emptyCaseForm = {
  module: '',
  testPoint: '',
  title: '',
  priority: '中',
  precondition: '',
  steps: '',
  expectedResult: '',
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
const PRIORITY_OPTIONS = [
  { value: '高', label: '高' },
  { value: '中', label: '中' },
  { value: '低', label: '低' },
]
const SWAGGER_CHAR_LIMIT = 80_000
const SWAGGER_CONTEXT_MARKER = '【Swagger/OpenAPI 文档】'
const HTTP_METHOD_PATH_PATTERN = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(.+)$/i

function isMethodPathHeader(header: string) {
  const normalized = header.trim().toLowerCase()
  return normalized === '请求方式及路径' || normalized === 'request method & path'
}

function MethodPathCell({ value }: { value: string }) {
  const match = HTTP_METHOD_PATH_PATTERN.exec(value.trim())
  if (!match) return <>{value}</>
  const method = match[1].toUpperCase()
  return (
    <span className="testcase-method-path">
      <span className={`testcase-method-badge is-${method.toLowerCase()}`}>{method}</span>
      <span className="testcase-method-path-text">{match[2]}</span>
    </span>
  )
}

function formatDate(value?: string) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function statusMeta(testSet: TestCaseSet) {
  if (testSet.status === 'completed') return { label: '生成完成', className: 'testset-status is-complete', icon: CheckCircle2, iconClassName: 'h-3.5 w-3.5' }
  if (testSet.status === 'failed') return { label: '生成失败', className: 'testset-status is-failed', icon: AlertCircle, iconClassName: 'h-3.5 w-3.5' }
  if (testSet.status === 'running' && testSet.rows.length === 0) {
    return { label: 'AI 分析中', className: 'testset-status is-thinking', icon: Sparkles, iconClassName: 'h-3.5 w-3.5 animate-pulse' }
  }
  if (testSet.status === 'running') return { label: '生成中', className: 'testset-status is-running', icon: Loader2, iconClassName: 'h-3.5 w-3.5 animate-spin' }
  return { label: '等待生成', className: 'testset-status is-queued', icon: Loader2, iconClassName: 'h-3.5 w-3.5 animate-spin' }
}

function ExportButtons({
  onExcel,
  onXmind,
  excelBusy,
  xmindBusy,
  disabled,
  compact = false,
}: {
  onExcel: () => void
  onXmind: () => void
  excelBusy: boolean
  xmindBusy: boolean
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onXmind}
        disabled={disabled || xmindBusy}
        className={compact
          ? 'testcase-row-export-button is-xmind disabled:pointer-events-none disabled:opacity-40'
          : 'secondary-action px-4 py-2 text-xs disabled:pointer-events-none disabled:opacity-45'}
      >
        {xmindBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        XMind
      </button>
      <button
        type="button"
        onClick={onExcel}
        disabled={disabled || excelBusy}
        className={compact
          ? 'testcase-row-export-button is-excel disabled:pointer-events-none disabled:opacity-40'
          : 'primary-action px-4 py-2 text-xs disabled:pointer-events-none disabled:opacity-45'}
      >
        {excelBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
        Excel
      </button>
    </div>
  )
}

export function TestCasePage() {
  const { showError } = useErrorDialog()
  const workspace = useTestCaseWorkspace()
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [editingProject, setEditingProject] = useState<TestCaseProject | null>(null)
  const [deletingProject, setDeletingProject] = useState<TestCaseProject | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectNameError, setProjectNameError] = useState('')
  const [showTestSetModal, setShowTestSetModal] = useState(false)
  const [testSetName, setTestSetName] = useState('')
  const [context, setContext] = useState('')
  const [swaggerText, setSwaggerText] = useState('')
  const [testType, setTestType] = useState<TestType>('functional')
  const [language, setLanguage] = useState<Language>('zh')
  const [formErrors, setFormErrors] = useState<{ name?: string; context?: string; swagger?: string }>({})
  const [showSupplementModal, setShowSupplementModal] = useState(false)
  const [supplementContext, setSupplementContext] = useState('')
  const [supplementError, setSupplementError] = useState('')
  const [showCaseModal, setShowCaseModal] = useState(false)
  const [caseForm, setCaseForm] = useState(emptyCaseForm)
  const [caseErrors, setCaseErrors] = useState<Partial<Record<keyof typeof emptyCaseForm, string>>>({})
  const [deletingCase, setDeletingCase] = useState<{ testSet: TestCaseSet; row: string[] } | null>(null)
  const [deletingTestSet, setDeletingTestSet] = useState<TestCaseSet | null>(null)
  const [previewPage, setPreviewPage] = useState(1)
  const [previewPageSize, setPreviewPageSize] = useState(10)
  const [setListPage, setSetListPage] = useState(1)
  const [setListPageSize, setSetListPageSize] = useState(10)

  const completedSets = useMemo(
    () => workspace.testSets.filter((item) => item.status === 'completed' && item.rows.length > 0),
    [workspace.testSets],
  )
  const allCompletedSelected = completedSets.length > 0 && workspace.selectedSetIds.size === completedSets.length

  useEffect(() => {
    if (!workspace.pageError) return
    showError(workspace.pageError, { title: '操作失败', fallbackMessage: '当前操作失败，请稍后重试。' })
    workspace.setPageError(null)
  }, [showError, workspace])

  // 需求分析工具的一键接力：读取需求原文，自动打开新建用例集弹窗并预填需求描述。
  const [requirementHandoff, setRequirementHandoff] = useState<{ requirement: string; name?: string } | null>(null)
  const handoffProjectPromptedRef = useRef(false)

  useEffect(() => {
    const raw = localStorage.getItem(REQUIREMENT_HANDOFF_KEY)
    if (!raw) return
    localStorage.removeItem(REQUIREMENT_HANDOFF_KEY)
    let handoff: { requirement: string; name?: string } | null = null
    try {
      const parsed = JSON.parse(raw) as { requirement?: unknown; name?: unknown }
      if (parsed && typeof parsed.requirement === 'string' && parsed.requirement.trim()) {
        handoff = {
          requirement: parsed.requirement,
          name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : undefined,
        }
      }
    } catch {
      if (raw.trim()) handoff = { requirement: raw }
    }
    if (!handoff) return
    // 与外部系统（localStorage）同步：推迟到任务队列，避免在 effect 体内同步 setState
    queueMicrotask(() => setRequirementHandoff(handoff))
  }, [])

  useEffect(() => {
    if (!requirementHandoff || workspace.loading) return
    const timer = window.setTimeout(() => {
      if (!workspace.selectedProject) {
        if (workspace.projects.length > 0) {
          workspace.setSelectedProjectId(workspace.projects[0].id)
        } else if (!handoffProjectPromptedRef.current) {
          // 没有项目时先引导创建项目，创建完成后接力继续
          handoffProjectPromptedRef.current = true
          openCreateProjectModal()
        }
        return
      }
      setTestSetName(requirementHandoff.name ?? '')
      setContext(requirementHandoff.requirement)
      setFormErrors({})
      setShowTestSetModal(true)
      setRequirementHandoff(null)
    }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementHandoff, workspace.loading, workspace.projects, workspace.selectedProject])

  function openCreateProjectModal() {
    setEditingProject(null)
    setProjectName('')
    setProjectNameError('')
    setShowProjectModal(true)
  }

  function openEditProjectModal(project: TestCaseProject) {
    setEditingProject(project)
    setProjectName(project.name)
    setProjectNameError('')
    setShowProjectModal(true)
  }

  function closeProjectModal() {
    setShowProjectModal(false)
    setEditingProject(null)
    setProjectName('')
    setProjectNameError('')
  }

  async function submitProject() {
    if (!projectName.trim()) {
      setProjectNameError('请输入项目名称')
      return
    }
    const saved = editingProject
      ? await workspace.renameProject(editingProject.id, projectName)
      : await workspace.createProject(projectName)
    if (saved) closeProjectModal()
  }

  async function confirmDeleteProject() {
    if (!deletingProject) return
    await workspace.removeProject(deletingProject.id)
    setDeletingProject(null)
  }

  function resetTestSetForm() {
    setTestSetName('')
    setContext('')
    setSwaggerText('')
    setTestType('functional')
    setLanguage('zh')
    setFormErrors({})
  }

  async function submitTestSet() {
    const isApi = testType === 'api'
    const swagger = swaggerText.trim()
    const nextErrors: typeof formErrors = {}
    if (!testSetName.trim()) nextErrors.name = '请输入用例集名称'
    if (!context.trim() && !(isApi && swagger)) nextErrors.context = isApi ? '请输入需求描述，或提供 Swagger/OpenAPI 文档' : '请输入需求描述'
    if (isApi && swagger.length > SWAGGER_CHAR_LIMIT) {
      try {
        JSON.parse(swagger)
      } catch {
        nextErrors.swagger = `文档已达 ${swagger.length.toLocaleString()} 字符且不是可解析的 JSON，无法自动拆分，请转为 JSON 或按模块精简后分批生成`
      }
    }
    setFormErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    const finalContext = isApi && swagger
      ? `${context.trim()}\n\n${SWAGGER_CONTEXT_MARKER}\n${swagger}`
      : context
    const created = await workspace.createTestSet({ name: testSetName, context: finalContext, testType, language })
    if (created) {
      setShowTestSetModal(false)
      resetTestSetForm()
    }
  }

  async function submitSupplement() {
    if (!workspace.previewSet) return
    if (!supplementContext.trim()) {
      setSupplementError('请输入补充需求')
      return
    }
    const submitted = await workspace.supplementTestSet(workspace.previewSet, supplementContext)
    if (submitted) {
      setSupplementContext('')
      setSupplementError('')
      setShowSupplementModal(false)
    }
  }

  async function handleSwaggerFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const content = await file.text()
    setSwaggerText(content)
    setFormErrors((current) => ({ ...current, swagger: undefined }))
  }

  function updateCaseForm(field: keyof typeof emptyCaseForm, value: string) {
    setCaseForm((current) => ({ ...current, [field]: value }))
    setCaseErrors((current) => ({ ...current, [field]: undefined }))
  }

  function validateCaseForm() {
    const nextErrors: typeof caseErrors = {}
    if (!caseForm.module.trim()) nextErrors.module = '请输入功能模块'
    if (!caseForm.testPoint.trim()) nextErrors.testPoint = '请输入功能测试点'
    if (!caseForm.title.trim()) nextErrors.title = '请输入用例标题'
    if (!caseForm.steps.trim()) nextErrors.steps = '请输入测试步骤'
    if (!caseForm.expectedResult.trim()) nextErrors.expectedResult = '请输入预期结果'
    setCaseErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function submitCase() {
    if (!workspace.previewSet || !validateCaseForm()) return
    const row = [
      '',
      caseForm.module.trim(),
      caseForm.testPoint.trim(),
      caseForm.title.trim(),
      caseForm.priority,
      caseForm.precondition.trim(),
      caseForm.steps.trim(),
      caseForm.expectedResult.trim(),
    ]
    const created = await workspace.addTestCase(workspace.previewSet, row)
    if (created) {
      setCaseForm(emptyCaseForm)
      setCaseErrors({})
      setShowCaseModal(false)
    }
  }

  async function confirmDeleteCase() {
    if (!deletingCase) return
    const removed = await workspace.removeTestCase(deletingCase.testSet, deletingCase.row)
    if (removed) setDeletingCase(null)
  }

  async function confirmDeleteTestSet() {
    if (!deletingTestSet) return
    await workspace.removeTestSet(deletingTestSet)
    setDeletingTestSet(null)
  }

  const previewHeader = normalizeDisplayHeader(workspace.previewSet?.header ?? [])
  const previewBusy = workspace.previewSet?.status === 'queued' || workspace.previewSet?.status === 'running' || workspace.generating
  const previewRows = workspace.previewSet?.rows ?? []
  const previewPageCount = Math.max(1, Math.ceil(previewRows.length / previewPageSize))
  const safePreviewPage = Math.min(previewPage, previewPageCount)
  const pagedPreviewRows = previewRows.slice((safePreviewPage - 1) * previewPageSize, safePreviewPage * previewPageSize)
  const setListPageCount = Math.max(1, Math.ceil(workspace.testSets.length / setListPageSize))
  const safeSetListPage = Math.min(setListPage, setListPageCount)
  const pagedTestSets = workspace.testSets.slice((safeSetListPage - 1) * setListPageSize, safeSetListPage * setListPageSize)

  return (
    <div className="page-shell testcase-page-shell testcase-workspace">
      <header className="testcase-workspace-header">
        <div className="flex min-w-0 items-center gap-3">
          {workspace.selectedProject ? (
            <Tooltip content="返回项目管理">
              <button
                type="button"
                onClick={() => { setSetListPage(1); workspace.setSelectedProjectId(null) }}
                className="icon-action h-10 w-10 shrink-0 rounded-xl"
                aria-label="返回项目管理"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="返回首页">
              <Link to="/" className="icon-action h-10 w-10 shrink-0 rounded-xl" aria-label="返回首页">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Tooltip>
          )}
          <div className="min-w-0">
            {workspace.selectedProject && (
              <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted">
                <span>项目管理</span><ChevronRight className="h-3 w-3" /><span className="truncate">{workspace.selectedProject.name}</span>
              </div>
            )}
            <h1 className="page-title">{workspace.selectedProject ? workspace.selectedProject.name : '测试用例项目'}</h1>
            <p className="page-subtitle">
              {workspace.selectedProject
                ? '组织用例集、跟踪 AI 生成状态，并将结果导出为团队可用的测试资产'
                : '按业务项目管理测试用例，让生成结果拥有清晰、稳定的归属'}
            </p>
          </div>
        </div>
        <Link to="/settings" className="secondary-action shrink-0 px-3 py-2 text-xs no-underline">
          <Settings className="h-3.5 w-3.5" />模型设置
        </Link>
      </header>

      {!workspace.selectedProject ? (
        <main>
          {workspace.loading ? (
            <section className="testcase-empty-state surface-panel">
              <Loader2 className="h-6 w-6 animate-spin text-accent" /><span>正在读取项目...</span>
            </section>
          ) : workspace.projects.length === 0 ? (
            <section className="testcase-empty-state surface-panel motion-card stagger-1">
              <div className="empty-state-mark"><FolderKanban className="h-7 w-7" /></div>
              <p className="empty-state-kicker">从一个项目开始</p>
              <h2>还没有测试用例项目</h2>
              <p>创建项目后，用例集、生成状态与导出结果都会集中归档在这里。</p>
              <button type="button" onClick={openCreateProjectModal} className="primary-action mt-7 px-5 py-2.5 text-sm">
                <Plus className="h-4 w-4" />添加项目
              </button>
            </section>
          ) : (
            <section className="project-index-section">
              <div className="testcase-section-toolbar is-left">
                <button type="button" onClick={openCreateProjectModal} className="primary-action px-4 py-2.5 text-sm">
                  <Plus className="h-4 w-4" />添加项目
                </button>
                <div className="project-list-summary">
                  <strong>全部项目</strong>
                  <span>{workspace.projects.length} 个</span>
                </div>
              </div>
              <div className="project-card-grid">
                {workspace.projects.map((project, index) => (
                  <div
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    aria-label={project.name}
                    onClick={() => { setSetListPage(1); workspace.setSelectedProjectId(project.id) }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setSetListPage(1)
                      workspace.setSelectedProjectId(project.id)
                    }}
                    className="project-management-card"
                    style={{ '--project-index': index } as React.CSSProperties}
                  >
                    <div className="project-card-topline">
                      <div className="project-card-icon"><FolderKanban className="h-[18px] w-[18px]" /></div>
                      <div className="project-card-actions">
                        <Tooltip content="重命名项目">
                          <button
                            type="button"
                            className="project-card-action icon-action h-7 w-7"
                            aria-label={`重命名项目 ${project.name}`}
                            onClick={(event) => { event.stopPropagation(); openEditProjectModal(project) }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip content="删除项目">
                          <button
                            type="button"
                            className="project-card-action icon-action h-7 w-7 text-rose-500 hover:text-rose-600"
                            aria-label={`删除项目 ${project.name}`}
                            onClick={(event) => { event.stopPropagation(); setDeletingProject(project) }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                        <span className="project-card-open"><ArrowUpRight className="h-4 w-4" /></span>
                      </div>
                    </div>
                    <div className="project-card-body">
                      <h2>{project.name}</h2>
                    </div>
                    <footer className="project-card-footer">
                      <span><Layers3 className="h-3.5 w-3.5" />{project.testSetCount || 0} 个用例集</span>
                      <span><FileSpreadsheet className="h-3.5 w-3.5" />{project.testCaseCount || 0} 条用例</span>
                    </footer>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      ) : (
        <main className="testcase-set-panel stagger-1">
          <div className="testcase-set-toolbar">
            <div className="testcase-set-toolbar-main">
              <button type="button" onClick={() => setShowTestSetModal(true)} className="primary-action px-4 py-2.5 text-sm">
                <Plus className="h-4 w-4" />添加用例集
              </button>
              <div className="testcase-set-heading">
                <div className="flex items-center gap-2">
                  <h2>测试用例集</h2>
                  <span className="testcase-set-total">{workspace.testSets.length}</span>
                </div>
                <p>管理 AI 生成任务与测试资产，累计 {workspace.testSets.reduce((total, item) => total + item.rows.length, 0)} 条测试用例</p>
              </div>
            </div>
            <div className="testcase-export-zone">
              <ExportButtons
                onExcel={() => void workspace.exportMerged('excel')}
                onXmind={() => void workspace.exportMerged('xmind')}
                excelBusy={workspace.exporting === 'excel:merged'}
                xmindBusy={workspace.exporting === 'xmind:merged'}
                disabled={completedSets.length === 0}
              />
              <span className="testcase-export-note">
                {workspace.selectedSetIds.size ? `已选择 ${workspace.selectedSetIds.size} 个，将合并导出` : '未选择时导出全部已完成用例集'}
              </span>
            </div>
          </div>

          <div className="testcase-set-table-wrap">
            <table className="testcase-set-table">
              <thead>
                <tr>
                  <th className="testcase-select-column text-center">
                    <input
                      type="checkbox"
                      checked={allCompletedSelected}
                      onChange={workspace.toggleAllCompleted}
                      disabled={completedSets.length === 0}
                      aria-label="选择全部已完成用例集"
                    />
                  </th>
                  <th scope="col">用例集名称</th>
                  <th scope="col">生成状态</th>
                  <th scope="col">用例数量</th>
                  <th scope="col">创建时间</th>
                  <th scope="col" className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {workspace.loadingSets ? (
                  Array.from({ length: 3 }, (_, index) => (
                    <tr key={`testset-skeleton-${index}`} className="testcase-skeleton-row" aria-hidden="true">
                      <td><span className="testcase-skeleton-check" /></td>
                      <td><span className="testcase-skeleton-name"><i /><b /></span></td>
                      <td><span className="testcase-skeleton-pill" /></td>
                      <td><span className="testcase-skeleton-short" /></td>
                      <td><span className="testcase-skeleton-date" /></td>
                      <td><span className="testcase-skeleton-actions" /></td>
                    </tr>
                  ))
                ) : workspace.testSets.length === 0 ? (
                  <tr className="testcase-empty-row">
                    <td colSpan={6}>
                      <div className="testcase-table-empty">
                        <div className="testcase-table-empty-icon"><Layers3 className="h-5 w-5" /></div>
                        <div className="testcase-table-empty-copy">
                          <h3>这个项目还没有用例集</h3>
                          <p>创建用例集后，生成进度、用例数量和导出操作都会在这里集中展示。</p>
                        </div>
                        <button type="button" onClick={() => setShowTestSetModal(true)} className="secondary-action px-4 py-2.5 text-sm">
                          <Plus className="h-4 w-4" />创建第一个用例集
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pagedTestSets.map((testSet, rowIndex) => {
                    const meta = statusMeta(testSet)
                    const StatusIcon = meta.icon
                    const canOpen = testSet.status === 'completed'
                    return (
                      <tr
                        key={testSet.id}
                        className={[canOpen ? 'is-clickable' : '', workspace.selectedSetIds.has(testSet.id) ? 'is-selected' : ''].filter(Boolean).join(' ')}
                        style={{ '--row-index': rowIndex } as React.CSSProperties}
                      >
                        <td className="text-center">
                          <input
                            type="checkbox"
                            checked={workspace.selectedSetIds.has(testSet.id)}
                            onChange={() => workspace.toggleSetSelection(testSet)}
                            disabled={!canOpen || testSet.rows.length === 0}
                            aria-label={`选择用例集 ${testSet.name}`}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => { if (canOpen) { setPreviewPage(1); workspace.setSupplementNotice(null); workspace.setPreviewSetId(testSet.id) } }}
                            disabled={!canOpen}
                            className="testset-name-button"
                          >
                            <span className="testset-name-icon"><Layers3 className="h-4 w-4" /></span>
                            <span className="testset-name-copy">
                              <span className="testset-title-line">
                                <strong>{testSet.name}</strong>
                                {canOpen && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                              </span>
                              <span className="testset-meta">
                                <span>{testSet.testType === 'api' ? 'API 测试' : '功能测试'}</span>
                                <i aria-hidden="true" />
                                <span>{testSet.language === 'en' ? 'English' : '中文'}</span>
                              </span>
                              {testSet.status === 'failed' && <em>{normalizeErrorMessage(testSet.error, { fallbackMessage: 'AI 生成失败' })}</em>}
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className={meta.className}>
                            <StatusIcon className={meta.iconClassName} />
                            {meta.label}
                          </span>
                        </td>
                        <td>
                          <span className="testset-count-cell"><strong>{testSet.rows.length}</strong><span>条用例</span></span>
                        </td>
                        <td><span className="testset-date">{formatDate(testSet.createdAt)}</span></td>
                        <td className="testset-actions-cell">
                          <div className="testset-row-actions">
                            <ExportButtons
                              onExcel={() => void workspace.exportSingle(testSet, 'excel')}
                              onXmind={() => void workspace.exportSingle(testSet, 'xmind')}
                              excelBusy={workspace.exporting === `excel:${testSet.id}`}
                              xmindBusy={workspace.exporting === `xmind:${testSet.id}`}
                              disabled={!canOpen || testSet.rows.length === 0}
                              compact
                            />
                            <Tooltip content="删除用例集">
                              <button
                                type="button"
                                onClick={() => setDeletingTestSet(testSet)}
                                className="icon-action h-8 w-8 text-rose-500 hover:text-rose-600"
                                aria-label={`删除用例集 ${testSet.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {!workspace.loadingSets && workspace.testSets.length > 0 && (
            <div className="testcase-set-pagination">
              <span className="testcase-page-info">第 {(safeSetListPage - 1) * setListPageSize + 1}-{Math.min(safeSetListPage * setListPageSize, workspace.testSets.length)} 条 · 共 {workspace.testSets.length} 条</span>
              <div className="testcase-page-controls">
                <CustomSelect value={String(setListPageSize)} onChange={(value) => { setSetListPageSize(Number(value)); setSetListPage(1) }} options={PAGE_SIZE_OPTIONS} className="testcase-page-size" />
                {setListPageCount > 1 && (
                  <>
                    <button type="button" onClick={() => setSetListPage((page) => Math.max(1, page - 1))} disabled={safeSetListPage === 1} className="icon-action h-8 w-8" aria-label="上一页"><ChevronLeft className="h-3.5 w-3.5" /></button>
                    {buildPageItems(safeSetListPage, setListPageCount).map((item, index) => (
                      item === 'ellipsis'
                        ? <span key={`page-ellipsis-${index}`} className="testcase-page-ellipsis" aria-hidden="true">…</span>
                        : <button key={item} type="button" onClick={() => setSetListPage(item)} className={`testcase-page-button${item === safeSetListPage ? ' is-active' : ''}`} aria-label={`第 ${item} 页`} aria-current={item === safeSetListPage ? 'page' : undefined}>{item}</button>
                    ))}
                    <button type="button" onClick={() => setSetListPage((page) => Math.min(setListPageCount, page + 1))} disabled={safeSetListPage === setListPageCount} className="icon-action h-8 w-8" aria-label="下一页"><ChevronRight className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      )}

      {showProjectModal && (
        <ModalPortal onClose={() => !workspace.creatingProject && closeProjectModal()} closeOnBackdrop={!workspace.creatingProject} closeOnEscape={!workspace.creatingProject}>
          <div className="modal-panel w-full max-w-[480px] rounded-[26px] p-6" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-project-title">
            <div className="modal-heading-row">
              <div>
                <p className="modal-kicker">项目管理</p>
                <h2 id="add-project-title">{editingProject ? '编辑项目' : '添加项目'}</h2>
                <span>{editingProject ? `重命名「${editingProject.name}」。` : '为测试用例建立一个清晰的业务归属。'}</span>
              </div>
              <button type="button" onClick={closeProjectModal} className="icon-action h-9 w-9" aria-label="关闭项目窗口"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-6">
              <label className={labelCls} htmlFor="testcase-project-name">项目名称</label>
              <input
                id="testcase-project-name"
                autoFocus
                value={projectName}
                onChange={(event) => { setProjectName(event.target.value); setProjectNameError('') }}
                onKeyDown={(event) => { if (event.key === 'Enter') void submitProject() }}
                className={`${inputCls} ${projectNameError ? 'field-control-error' : ''}`}
                placeholder="例如：订单中心"
              />
              {projectNameError && <p className="field-error">{projectNameError}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={closeProjectModal} disabled={workspace.creatingProject} className="secondary-action px-5 py-2.5 text-sm">取消</button>
              <button type="button" onClick={() => void submitProject()} disabled={workspace.creatingProject} className="primary-action px-5 py-2.5 text-sm disabled:opacity-50">
                {workspace.creatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : editingProject ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {workspace.creatingProject ? '保存中...' : editingProject ? '保存修改' : '添加项目'}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {showTestSetModal && (
        <ModalPortal onClose={() => !workspace.generating && setShowTestSetModal(false)} closeOnBackdrop={!workspace.generating} closeOnEscape={!workspace.generating}>
          <div className="modal-panel max-h-[90vh] w-full max-w-[720px] overflow-auto rounded-[28px] p-6 max-sm:p-4" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-testset-title">
            <div className="modal-heading-row">
              <div><p className="modal-kicker">{workspace.selectedProject?.name}</p><h2 id="add-testset-title">添加测试用例集</h2><span>提交后窗口会关闭，生成进度将在用例集列表中持续更新。</span></div>
              <button type="button" onClick={() => setShowTestSetModal(false)} disabled={workspace.generating} className="icon-action h-9 w-9" aria-label="关闭添加用例集窗口"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="testcase-set-name">用例集名称</label>
                <input id="testcase-set-name" value={testSetName} onChange={(event) => { setTestSetName(event.target.value); setFormErrors((current) => ({ ...current, name: undefined })) }} className={`${inputCls} ${formErrors.name ? 'field-control-error' : ''}`} placeholder="例如：登录与会话管理" />
                {formErrors.name && <p className="field-error">{formErrors.name}</p>}
              </div>
              <div><label className={labelCls}>测试类型</label><CustomSelect value={testType} onChange={(value) => setTestType(value as TestType)} options={TEST_TYPE_OPTIONS} /></div>
              <div><label className={labelCls}>输出语言</label><CustomSelect value={language} onChange={(value) => setLanguage(value as Language)} options={LANGUAGE_OPTIONS} /></div>
            </div>
            <div className="mt-4">
              <label className={labelCls} htmlFor="testcase-set-context">需求描述</label>
              <textarea id="testcase-set-context" value={context} onChange={(event) => { setContext(event.target.value); setFormErrors((current) => ({ ...current, context: undefined })) }} rows={8} className={`${inputCls} ${formErrors.context ? 'field-control-error' : ''}`} placeholder="描述业务规则、输入输出、异常场景、边界条件等。" />
              {formErrors.context && <p className="field-error">{formErrors.context}</p>}
            </div>
            {testType === 'api' && (
              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <label className={labelCls} htmlFor="testcase-set-swagger">Swagger/OpenAPI 文档</label>
                  <span className="field-hint">可选，与需求描述一起作为生成依据</span>
                </div>
                <textarea
                  id="testcase-set-swagger"
                  value={swaggerText}
                  onChange={(event) => { setSwaggerText(event.target.value); setFormErrors((current) => ({ ...current, swagger: undefined })) }}
                  rows={5}
                  className={`${inputCls} ${formErrors.swagger ? 'field-control-error' : ''}`}
                  placeholder="粘贴 Swagger/OpenAPI JSON 或 YAML 全文。"
                />
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className={swaggerText.length > SWAGGER_CHAR_LIMIT ? 'field-error' : 'field-hint'}>
                    {swaggerText.length.toLocaleString()} / {SWAGGER_CHAR_LIMIT.toLocaleString()} 字符
                    {swaggerText.length > SWAGGER_CHAR_LIMIT && '，JSON 格式将自动按接口分组生成'}
                  </span>
                  <label className="secondary-action shrink-0 cursor-pointer px-3 py-1.5 text-xs">
                    上传文件
                    <input type="file" accept=".json,.yaml,.yml,.txt" className="hidden" onChange={(event) => void handleSwaggerFile(event)} />
                  </label>
                </div>
                {formErrors.swagger && <p className="field-error">{formErrors.swagger}</p>}
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button type="button" onClick={() => setShowTestSetModal(false)} disabled={workspace.generating} className="secondary-action px-5 py-2.5 text-sm">取消</button>
              <button type="button" onClick={() => void submitTestSet()} disabled={workspace.generating} className="primary-action px-5 py-2.5 text-sm disabled:opacity-50">
                {workspace.generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {workspace.generating ? '正在创建...' : '开始 AI 生成'}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {workspace.previewSet && (
        <ModalPortal onClose={() => workspace.setPreviewSetId(null)}>
          <div className="modal-panel testcase-preview-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="testcase-preview-title">
            <div className="testcase-preview-header">
              <div className="min-w-0">
                <p className="modal-kicker">测试用例维护</p>
                <h2 id="testcase-preview-title" className="truncate">{workspace.previewSet.name}</h2>
                <div className="testcase-preview-meta">
                  <span className="testcase-meta-chip"><Layers3 className="h-3 w-3" />共 {workspace.previewSet.rows.length} 条用例</span>
                  <span className="testcase-meta-chip"><Clock3 className="h-3 w-3" />生成于 {formatDate(workspace.previewSet.updatedAt)}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={() => setShowSupplementModal(true)} disabled={previewBusy} className="secondary-action px-4 py-2 text-xs disabled:pointer-events-none disabled:opacity-45">
                  {workspace.generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  补充需求
                </button>
                <button type="button" onClick={() => setShowCaseModal(true)} disabled={previewBusy} className="primary-action px-4 py-2 text-xs disabled:pointer-events-none disabled:opacity-45">
                  <Plus className="h-3.5 w-3.5" />
                  新增用例
                </button>
                <ExportButtons
                  onExcel={() => void workspace.exportSingle(workspace.previewSet!, 'excel')}
                  onXmind={() => void workspace.exportSingle(workspace.previewSet!, 'xmind')}
                  excelBusy={workspace.exporting === `excel:${workspace.previewSet.id}`}
                  xmindBusy={workspace.exporting === `xmind:${workspace.previewSet.id}`}
                />
                <button type="button" onClick={() => workspace.setPreviewSetId(null)} className="icon-action h-9 w-9" aria-label="关闭阅览窗口"><X className="h-4 w-4" /></button>
              </div>
            </div>
            {workspace.supplementNotice && (
              <div className="testcase-supplement-notice" role="status">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{workspace.supplementNotice}</span>
                <button type="button" onClick={() => workspace.setSupplementNotice(null)} className="testcase-supplement-notice-close" aria-label="关闭提示"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
            <div className="testcase-preview-table-wrap">
              <table className="testcase-result-table border-collapse text-left text-[12px]">
                <thead><tr>{previewHeader.map((cell) => <th key={cell}>{cell}</th>)}<th className="testcase-maintain-action-col">操作</th></tr></thead>
                <tbody>
                  {pagedPreviewRows.map((row, rowIndex) => (
                    <tr key={`${row[0] ?? 'case'}-${(safePreviewPage - 1) * previewPageSize + rowIndex}`}>
                      {previewHeader.map((header, cellIndex) => {
                        const cellText = displayCellText(row[cellIndex])
                        return (
                          <td key={`${rowIndex}-${cellIndex}`} className="testcase-cell">
                            {isMethodPathHeader(header) ? <MethodPathCell value={cellText} /> : cellText}
                          </td>
                        )
                      })}
                      <td className="testcase-maintain-action-cell">
                        <Tooltip content={`删除用例 ${row[0] ?? ''}`}>
                          <button
                            type="button"
                            onClick={() => setDeletingCase({ testSet: workspace.previewSet!, row })}
                            disabled={previewBusy}
                            className="icon-action h-8 w-8 text-rose-500 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-35"
                            aria-label={`删除用例 ${row[0] ?? rowIndex + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewRows.length > 0 && (
              <div className="testcase-preview-pagination">
                <span className="testcase-page-info">第 {(safePreviewPage - 1) * previewPageSize + 1}-{Math.min(safePreviewPage * previewPageSize, previewRows.length)} 条 · 共 {previewRows.length} 条</span>
                <div className="testcase-page-controls">
                  <CustomSelect value={String(previewPageSize)} onChange={(value) => { setPreviewPageSize(Number(value)); setPreviewPage(1) }} options={PAGE_SIZE_OPTIONS} className="testcase-page-size" />
                  {previewPageCount > 1 && (
                    <>
                      <button type="button" onClick={() => setPreviewPage((page) => Math.max(1, page - 1))} disabled={safePreviewPage === 1} className="icon-action h-8 w-8" aria-label="上一页"><ChevronLeft className="h-3.5 w-3.5" /></button>
                      {buildPageItems(safePreviewPage, previewPageCount).map((item, index) => (
                        item === 'ellipsis'
                          ? <span key={`page-ellipsis-${index}`} className="testcase-page-ellipsis" aria-hidden="true">…</span>
                          : <button key={item} type="button" onClick={() => setPreviewPage(item)} className={`testcase-page-button${item === safePreviewPage ? ' is-active' : ''}`} aria-label={`第 ${item} 页`} aria-current={item === safePreviewPage ? 'page' : undefined}>{item}</button>
                      ))}
                      <button type="button" onClick={() => setPreviewPage((page) => Math.min(previewPageCount, page + 1))} disabled={safePreviewPage === previewPageCount} className="icon-action h-8 w-8" aria-label="下一页"><ChevronRight className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </ModalPortal>
      )}

      {showSupplementModal && workspace.previewSet && (
        <ModalPortal onClose={() => !workspace.generating && setShowSupplementModal(false)} closeOnBackdrop={!workspace.generating} closeOnEscape={!workspace.generating}>
          <div className="modal-panel w-full max-w-[640px] rounded-[28px] p-6 max-sm:p-4" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="supplement-testcase-title">
            <div className="modal-heading-row">
              <div>
                <p className="modal-kicker">{workspace.previewSet.name}</p>
                <h2 id="supplement-testcase-title">补充需求</h2>
                <span>AI 将参考完整需求和已有 {workspace.previewSet.rows.length} 条用例，只补充缺失的用例，并直接追加到当前用例集。</span>
              </div>
              <button type="button" onClick={() => setShowSupplementModal(false)} disabled={workspace.generating} className="icon-action h-9 w-9" aria-label="关闭补充需求窗口"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-6">
              <label className={labelCls} htmlFor="testcase-supplement-context">本次补充说明</label>
              <textarea
                id="testcase-supplement-context"
                value={supplementContext}
                onChange={(event) => { setSupplementContext(event.target.value); setSupplementError('') }}
                rows={7}
                className={`${inputCls} ${supplementError ? 'field-control-error' : ''}`}
                placeholder="例如：补充手机号格式边界、重复联系人、无权限查看组织成员、批量导入异常场景。"
              />
              {supplementError && <p className="field-error">{supplementError}</p>}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button type="button" onClick={() => setShowSupplementModal(false)} disabled={workspace.generating} className="secondary-action px-5 py-2.5 text-sm">取消</button>
              <button type="button" onClick={() => void submitSupplement()} disabled={workspace.generating} className="primary-action px-5 py-2.5 text-sm disabled:opacity-50">
                {workspace.generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {workspace.generating ? '正在补充...' : '开始补充'}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {showCaseModal && workspace.previewSet && (
        <ModalPortal onClose={() => setShowCaseModal(false)}>
          <div className="modal-panel max-h-[90vh] w-full max-w-[760px] overflow-auto rounded-[28px] p-6 max-sm:p-4" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-testcase-title">
            <div className="modal-heading-row">
              <div>
                <p className="modal-kicker">{workspace.previewSet.name}</p>
                <h2 id="add-testcase-title">新增用例</h2>
                <span>手动新增一条用例，保存后会自动重排用例编号并参与导出。</span>
              </div>
              <button type="button" onClick={() => setShowCaseModal(false)} className="icon-action h-9 w-9" aria-label="关闭新增用例窗口"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="manual-case-module">功能模块</label>
                <input id="manual-case-module" value={caseForm.module} onChange={(event) => updateCaseForm('module', event.target.value)} className={`${inputCls} ${caseErrors.module ? 'field-control-error' : ''}`} placeholder="例如：通讯录" />
                {caseErrors.module && <p className="field-error">{caseErrors.module}</p>}
              </div>
              <div>
                <label className={labelCls} htmlFor="manual-case-point">功能测试点</label>
                <input id="manual-case-point" value={caseForm.testPoint} onChange={(event) => updateCaseForm('testPoint', event.target.value)} className={`${inputCls} ${caseErrors.testPoint ? 'field-control-error' : ''}`} placeholder="例如：成员搜索" />
                {caseErrors.testPoint && <p className="field-error">{caseErrors.testPoint}</p>}
              </div>
              <div className="md:col-span-2">
                <label className={labelCls} htmlFor="manual-case-title">用例标题</label>
                <input id="manual-case-title" value={caseForm.title} onChange={(event) => updateCaseForm('title', event.target.value)} className={`${inputCls} ${caseErrors.title ? 'field-control-error' : ''}`} placeholder="例如：按姓名搜索成员并展示匹配结果" />
                {caseErrors.title && <p className="field-error">{caseErrors.title}</p>}
              </div>
              <div>
                <label className={labelCls}>优先级</label>
                <CustomSelect value={caseForm.priority} onChange={(value) => updateCaseForm('priority', value)} options={PRIORITY_OPTIONS} />
              </div>
              <div>
                <label className={labelCls} htmlFor="manual-case-precondition">前置条件</label>
                <input id="manual-case-precondition" value={caseForm.precondition} onChange={(event) => updateCaseForm('precondition', event.target.value)} className={inputCls} placeholder="例如：用户已登录且通讯录有成员" />
              </div>
              <div>
                <label className={labelCls} htmlFor="manual-case-steps">测试步骤</label>
                <textarea id="manual-case-steps" value={caseForm.steps} onChange={(event) => updateCaseForm('steps', event.target.value)} rows={6} className={`${inputCls} ${caseErrors.steps ? 'field-control-error' : ''}`} placeholder={'1. 打开通讯录\n2. 输入姓名关键字\n3. 点击搜索'} />
                {caseErrors.steps && <p className="field-error">{caseErrors.steps}</p>}
              </div>
              <div>
                <label className={labelCls} htmlFor="manual-case-expected">预期结果</label>
                <textarea id="manual-case-expected" value={caseForm.expectedResult} onChange={(event) => updateCaseForm('expectedResult', event.target.value)} rows={6} className={`${inputCls} ${caseErrors.expectedResult ? 'field-control-error' : ''}`} placeholder={'1. 通讯录页面正常显示\n2. 搜索条件被正确提交\n3. 列表展示匹配成员'} />
                {caseErrors.expectedResult && <p className="field-error">{caseErrors.expectedResult}</p>}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button type="button" onClick={() => setShowCaseModal(false)} className="secondary-action px-5 py-2.5 text-sm">取消</button>
              <button type="button" onClick={() => void submitCase()} className="primary-action px-5 py-2.5 text-sm">
                <Plus className="h-4 w-4" />
                保存用例
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {deletingCase && (
        <ConfirmDialog
          title="删除这条用例？"
          description={<>将从「<span className="font-semibold text-fg">{deletingCase.testSet.name}</span>」中删除 <span className="font-semibold text-fg">{deletingCase.row[0]}</span>，删除后用例编号会自动重排。</>}
          confirmText="确认删除"
          onCancel={() => setDeletingCase(null)}
          onConfirm={() => void confirmDeleteCase()}
          danger
        />
      )}

      {deletingProject && (
        <ConfirmDialog
          title="删除这个项目？"
          description={<>将永久删除「<span className="font-semibold text-fg">{deletingProject.name}</span>」及其 <span className="font-semibold text-fg">{deletingProject.testSetCount || 0}</span> 个用例集、<span className="font-semibold text-fg">{deletingProject.testCaseCount || 0}</span> 条用例，此操作不可撤销。</>}
          confirmText="确认删除"
          onCancel={() => setDeletingProject(null)}
          onConfirm={() => void confirmDeleteProject()}
          danger
        />
      )}

      {deletingTestSet && (
        <ConfirmDialog
          title="删除这个用例集？"
          description={<>将永久删除「<span className="font-semibold text-fg">{deletingTestSet.name}</span>」及其 <span className="font-semibold text-fg">{deletingTestSet.rows.length}</span> 条用例，此操作不可撤销。</>}
          confirmText="确认删除"
          onCancel={() => setDeletingTestSet(null)}
          onConfirm={() => void confirmDeleteTestSet()}
          danger
        />
      )}
    </div>
  )
}
