import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, FileSpreadsheet, Loader2, Settings, Sparkles, Trash2, X } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { CustomSelect } from '../components/ui/CustomSelect'
import {
  useTestCaseJobs,
  COVERAGE_DEFAULT_MAX,
  COVERAGE_LABEL,
  COVERAGE_OPTIONS,
  TEST_TYPE_OPTIONS,
  LANGUAGE_OPTIONS,
  PAGE_SIZE_OPTIONS,
  jobTitle,
  isBusyJob,
  jobStatusText,
  statusBadgeClass,
  formatTime,
  displayCellText,
  resultRows,
  type TestType,
  type Language,
  type CoverageMode,
  type JobData,
} from '../hooks/useTestCaseJobs'

const inputCls = 'field-control'
const labelCls = 'field-label'

function jobStatusIcon(job: JobData) {
  if (job.status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (job.status === 'failed') return <AlertCircle className="h-4 w-4 text-rose-500" />
  if (isBusyJob(job)) return <Loader2 className="h-4 w-4 animate-spin text-accent" />
  return <Clock3 className="h-4 w-4 text-muted" />
}

export function TestCasePage() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [featureName, setFeatureName] = useState('登录功能')
  const [context, setContext] = useState('用户名必填，密码必填，登录成功后跳转首页，失败时展示错误提示。')
  const [testType, setTestType] = useState<TestType>('functional')
  const [language, setLanguage] = useState<Language>('zh')
  const [coverageMode, setCoverageMode] = useState<CoverageMode>('standard')
  const [maxCases, setMaxCases] = useState(COVERAGE_DEFAULT_MAX.standard)

  const {
    modelConfig, formats, backendError, pageError,
    jobs, setSelectedJobId,
    generating, generateMessage,
    exportFormat, setExportFormat,
    issueType, setIssueType,
    component, setComponent,
    labels, setLabels,
    productName, setProductName,
    exportingExcel, exportingXmind,
    pageSize, setPageSize,
    setCurrentPage,
    selectedJob, rows, header,
    hasJobs, hasRows, isGeneratingJob,
    totalPages, safeCurrentPage, pageStartIndex, pagedRows,
    handleGenerate, handleExportExcel, handleExportXmind, handleDeleteCase, handleDeleteJob,
  } = useTestCaseJobs({
    featureName, context, testType, language, coverageMode, maxCases,
    setShowCreateModal,
  })

  return (
    <div className="page-shell testcase-page-shell">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Tooltip content="返回首页">
            <Link
              to="/"
              className="icon-action h-10 w-10 rounded-xl"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Tooltip>
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
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[oklch(0.62_0.18_265/0.06)] text-accent">
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
              <p className="mt-4 text-xs text-danger">
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
                    className={`group flex w-full items-stretch gap-2 rounded-2xl border p-2 text-left transition-all duration-250 ${
                      active
                        ? 'border-[oklch(0.62_0.18_265/0.4)] bg-[oklch(0.95_0.02_260/0.72)] shadow-[0_18px_42px_-30px_oklch(0.62_0.18_265/0.45)]'
                        : 'border-[oklch(0.92_0.008_260/0.7)] bg-white/68 hover:border-[oklch(0.62_0.18_265/0.22)] hover:bg-white/92 hover:shadow-[0_4px_14px_-8px_oklch(0.18_0.02_262/0.08)]'
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
                      <span className={`shrink-0 ${statusBadgeClass(item.status)}`}>
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
        <div className="modal-backdrop" onClick={() => !generating && setShowCreateModal(false)}>
          <div
            className="modal-panel max-h-[90vh] w-full max-w-[720px] overflow-auto rounded-[28px] p-6 max-sm:p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">新建用例生成</h2>
                <p className="mt-1.5 text-sm text-muted">填写最少信息即可创建生成任务，任务会立即出现在列表中。</p>
              </div>
              <Tooltip content="关闭">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={generating}
                  className="icon-action h-8 w-8 rounded-xl disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </Tooltip>
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

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                disabled={generating}
                className="secondary-action px-5 py-2.5 text-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="primary-action px-5 py-2.5 text-sm disabled:opacity-50"
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
