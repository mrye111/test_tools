import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Loader2, Pencil, Plus, RefreshCw, Share2, Trash2 } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { downloadAnalysisMarkdown } from '../features/requirement-analysis-v2/markdown-export'
import { loadStoredModelConfig } from '../lib/model-config-store'
import { toAiConfig } from '../shared/api-types'
import {
  bulkPatchIssues,
  createCondition,
  deleteCondition,
  getAnalysisRecord,
  getAnalysisRtm,
  patchAnalysisIssue,
  patchCriterion,
  reanalyzeRecordStream,
  relayConditions,
  updateCondition,
  type AcceptanceCriterion,
  type AnalysisIssue,
  type AnalysisRecordDetail,
  type ConditionKind,
  type IssueStatus,
  type RtmView,
  type TestCondition,
} from '../features/requirement-analysis-v2/analysis-api'
import { REQUIREMENT_CONDITIONS_HANDOFF_KEY, type ConditionsHandoffPayload } from '../features/requirement-analysis-v2/handoff'

const ISSUE_TYPE_LABEL: Record<AnalysisIssue['type'], string> = {
  ambiguity: '歧义',
  missing: '缺失',
  conflict: '冲突',
  untestable: '不可测',
}

const SEVERITY_LABEL: Record<AnalysisIssue['severity'], string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  open: '待澄清',
  resolved: '已澄清',
  accepted: '已接受',
}

const CONDITION_KIND_LABEL: Record<ConditionKind, string> = {
  normal: '正常',
  boundary: '边界',
  exception: '异常',
}

const ISSUE_STATUS_CYCLE: IssueStatus[] = ['open', 'resolved', 'accepted']

function nextIssueStatus(current: IssueStatus): IssueStatus {
  return ISSUE_STATUS_CYCLE[(ISSUE_STATUS_CYCLE.indexOf(current) + 1) % ISSUE_STATUS_CYCLE.length]
}

/**
 * 需求分析详情页：四分区（问题日志/验收准则/测试条件/追溯矩阵）。
 * 形态对齐评审通过的原型 docs/prototypes/req-analysis-v2.html（wayfinder #23）。
 */
export function RequirementAnalysisViewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showError } = useErrorDialog()

  const [record, setRecord] = useState<AnalysisRecordDetail | null>(null)
  const [rtm, setRtm] = useState<RtmView | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [relaying, setRelaying] = useState(false)
  const [activeTab, setActiveTab] = useState<'issues' | 'criteria' | 'conditions' | 'uncovered' | 'rtm'>('issues')
  const [editingCriterionId, setEditingCriterionId] = useState<string | null>(null)
  const [criterionDraft, setCriterionDraft] = useState('')

  // 问题筛选与批量操作
  const [issueTypeFilter, setIssueTypeFilter] = useState<'all' | AnalysisIssue['type']>('all')
  const [issueSeverityFilter, setIssueSeverityFilter] = useState<'all' | AnalysisIssue['severity']>('all')
  const [issueStatusFilter, setIssueStatusFilter] = useState<'all' | IssueStatus>('all')
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set())
  const [pendingBulk, setPendingBulk] = useState<IssueStatus | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  // 条件增删改
  const [addingForReq, setAddingForReq] = useState<string | null>(null)
  const [newConditionText, setNewConditionText] = useState('')
  const [newConditionKind, setNewConditionKind] = useState<ConditionKind>('normal')
  const [editingConditionId, setEditingConditionId] = useState<string | null>(null)
  const [conditionDraftText, setConditionDraftText] = useState('')
  const [conditionDraftKind, setConditionDraftKind] = useState<ConditionKind>('normal')
  const [pendingDeleteCondition, setPendingDeleteCondition] = useState<TestCondition | null>(null)

  // 重新分析（新记录 + 保守继承已处理问题状态）
  const [reanalyzeConfirm, setReanalyzeConfirm] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeProgress, setReanalyzeProgress] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [detail, rtmView] = await Promise.all([getAnalysisRecord(id), getAnalysisRtm(id)])
      setRecord(detail)
      setRtm(rtmView)
      setChecked(new Set(detail.conditions.filter((c) => c.relay !== 'none').map((c) => c.id)))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '获取分析记录失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    // 数据加载属外部系统同步：推迟到微任务，避免 effect 体内同步 setState
    queueMicrotask(() => void load())
  }, [load])

  const reqTextById = useMemo(() => {
    const map = new Map<string, string>()
    for (const req of record?.requirements ?? []) map.set(req.id, req.text)
    return map
  }, [record])

  /** 问题状态流转（点选循环） */
  const handleCycleIssueStatus = async (issue: AnalysisIssue) => {
    const next = nextIssueStatus(issue.status)
    setRecord((prev) =>
      prev ? { ...prev, issues: prev.issues.map((i) => (i.id === issue.id ? { ...i, status: next } : i)) } : prev,
    )
    try {
      await patchAnalysisIssue(issue.id, { status: next })
    } catch (err) {
      showError(err, { title: '状态更新失败', fallbackMessage: '问题状态更新失败，请重试。' })
      void load()
    }
  }

  /** 准则确认/驳回（驳回由后端闭环生成不可测问题） */
  const handleCriterionStatus = async (criterion: AcceptanceCriterion, status: 'confirmed' | 'rejected') => {
    try {
      const result = await patchCriterion(criterion.id, { status })
      setRecord((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          criteria: prev.criteria.map((c) => (c.id === criterion.id ? result.criterion : c)),
          issues: result.issue ? [...prev.issues, result.issue] : prev.issues,
        }
      })
    } catch (err) {
      showError(err, { title: '操作失败', fallbackMessage: '准则状态更新失败，请重试。' })
    }
  }

  /** 准则文案编辑提交 */
  const handleCriterionEdit = async (criterion: AcceptanceCriterion) => {
    const text = criterionDraft.trim()
    if (!text) return
    try {
      const result = await patchCriterion(criterion.id, { rewrittenText: text })
      setRecord((prev) =>
        prev ? { ...prev, criteria: prev.criteria.map((c) => (c.id === criterion.id ? result.criterion : c)) } : prev,
      )
      setEditingCriterionId(null)
    } catch (err) {
      showError(err, { title: '保存失败', fallbackMessage: '准则编辑保存失败，请重试。' })
    }
  }

  const toggleCondition = (conditionId: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(conditionId)) next.delete(conditionId)
      else next.add(conditionId)
      return next
    })
  }

  /** 接力：勾选条件标记 relayed → 载荷存 localStorage → 跳转用例生成（仅接力 none 态条件） */
  const handleRelay = async () => {
    if (!record || checked.size === 0) return
    const selected = record.conditions.filter((c) => checked.has(c.id) && c.relay === 'none')
    if (selected.length === 0) return
    setRelaying(true)
    try {
      const conditionIds = selected.map((c) => c.id)
      await relayConditions(record.id, conditionIds)
      const requirementText = [
        `【需求分析接力】${record.title}`,
        '',
        '需求原文摘要：',
        record.sourceText.slice(0, 2000),
        '',
        '测试条件（需逐条覆盖）：',
        ...selected.map((c) => `- [${CONDITION_KIND_LABEL[c.kind]}] ${c.text}`),
      ].join('\n')
      const payload: ConditionsHandoffPayload = {
        requirement: requirementText,
        name: record.title,
        recordId: record.id,
        conditions: selected.map((c) => ({ id: c.id, text: c.text, kind: c.kind, reqId: c.reqId })),
      }
      localStorage.setItem(REQUIREMENT_CONDITIONS_HANDOFF_KEY, JSON.stringify(payload))
      navigate('/testcase')
    } catch (err) {
      showError(err, { title: '接力失败', fallbackMessage: '测试条件接力失败，请重试。' })
    } finally {
      setRelaying(false)
    }
  }

  const conditionsByReq = useMemo(() => {
    const groups = new Map<string, TestCondition[]>()
    for (const condition of record?.conditions ?? []) {
      const key = condition.reqId ?? '__none__'
      const list = groups.get(key) ?? []
      list.push(condition)
      groups.set(key, list)
    }
    return groups
  }, [record])

  /** 筛选后的可见问题（筛选状态仅作用于展示） */
  const filteredIssues = useMemo(() => {
    if (!record) return []
    return record.issues.filter((issue) => {
      if (issueTypeFilter !== 'all' && issue.type !== issueTypeFilter) return false
      if (issueSeverityFilter !== 'all' && issue.severity !== issueSeverityFilter) return false
      if (issueStatusFilter !== 'all' && issue.status !== issueStatusFilter) return false
      return true
    })
  }, [record, issueTypeFilter, issueSeverityFilter, issueStatusFilter])

  const toggleIssueSelected = (id: string) => {
    setSelectedIssueIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 全选/清空当前筛选结果 */
  const toggleSelectAllFiltered = () => {
    setSelectedIssueIds((prev) => {
      const visibleIds = filteredIssues.map((i) => i.id)
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id))
      if (allSelected) return new Set()
      return new Set(visibleIds)
    })
  }

  /** 批量状态更新：确认后调用原子接口，失败重载；进行中防重复提交 */
  const handleBulkConfirm = async () => {
    if (!record || !pendingBulk || selectedIssueIds.size === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const updated = await bulkPatchIssues(record.id, [...selectedIssueIds], pendingBulk)
      const byId = new Map(updated.map((i) => [i.id, i]))
      setRecord((prev) =>
        prev ? { ...prev, issues: prev.issues.map((i) => byId.get(i.id) ?? i) } : prev,
      )
      setSelectedIssueIds(new Set())
      setPendingBulk(null)
    } catch (err) {
      showError(err, { title: '批量更新失败', fallbackMessage: '批量更新问题状态失败，请重试。' })
      void load()
    } finally {
      setBulkBusy(false)
    }
  }

  /** 新增条件 */
  const handleAddCondition = async (reqId: string) => {
    if (!record || !newConditionText.trim()) return
    try {
      const created = await createCondition(record.id, { reqId, text: newConditionText.trim(), kind: newConditionKind })
      setRecord((prev) => (prev ? { ...prev, conditions: [...prev.conditions, created] } : prev))
      setAddingForReq(null)
      setNewConditionText('')
      setNewConditionKind('normal')
    } catch (err) {
      showError(err, { title: '新增失败', fallbackMessage: '新增测试条件失败，请重试。' })
    }
  }

  /** 编辑条件提交 */
  const handleEditCondition = async (condition: TestCondition) => {
    if (!record || !conditionDraftText.trim()) return
    try {
      const updated = await updateCondition(record.id, condition.id, { text: conditionDraftText.trim(), kind: conditionDraftKind })
      setRecord((prev) =>
        prev ? { ...prev, conditions: prev.conditions.map((c) => (c.id === condition.id ? updated : c)) } : prev,
      )
      setEditingConditionId(null)
    } catch (err) {
      showError(err, { title: '编辑失败', fallbackMessage: '编辑测试条件失败，请重试。' })
    }
  }

  /** 删除条件确认 */
  const handleDeleteCondition = async () => {
    if (!record || !pendingDeleteCondition) return
    try {
      await deleteCondition(record.id, pendingDeleteCondition.id)
      setRecord((prev) =>
        prev ? { ...prev, conditions: prev.conditions.filter((c) => c.id !== pendingDeleteCondition.id) } : prev,
      )
      setPendingDeleteCondition(null)
    } catch (err) {
      showError(err, { title: '删除失败', fallbackMessage: '删除测试条件失败，请重试。' })
      setPendingDeleteCondition(null)
    }
  }

  /** 重新分析：确认 → SSE 生成新记录 → 跳转新详情页（旧记录保留） */
  const handleReanalyze = async () => {
    if (!record || reanalyzing) return
    const stored = loadStoredModelConfig()
    if (!stored) {
      showError(new Error('请先在「设置」中配置模型'), { title: '无法重新分析' })
      return
    }
    setReanalyzeConfirm(false)
    setReanalyzing(true)
    setReanalyzeProgress('正在连接模型…')
    try {
      const next = await reanalyzeRecordStream(record.id, toAiConfig(stored), (event) => {
        if (event.type === 'progress') setReanalyzeProgress(event.message)
      })
      if (next) {
        navigate(`/requirement-analysis/records/${next.id}`)
        return
      }
      showError(new Error('重新分析未完成'), { title: '重新分析失败' })
    } catch (err) {
      showError(err, { title: '重新分析失败', fallbackMessage: '重新分析失败，请稍后重试。' })
    } finally {
      setReanalyzing(false)
    }
  }

  /** 未覆盖需求：没有任何条件的条目（#31 覆盖导向——未覆盖显式陈述，不静默缺席） */
  const uncovered = useMemo(() => {
    if (!record) return []
    const coveredReqIds = new Set(record.conditions.map((c) => c.reqId).filter(Boolean))
    return record.requirements
      .filter((req) => !coveredReqIds.has(req.id))
      .map((req) => {
        const untestableIssue = record.issues.find((i) => i.reqId === req.id && i.type === 'untestable')
        return {
          req,
          reason: untestableIssue
            ? `不可测：${untestableIssue.description}`
            : '未涉及（AI 判断为低风险或无独立验证点）',
        }
      })
  }, [record])

  if (loading) {
    return (
      <div className="page-shell flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p>正在加载分析记录…</p>
      </div>
    )
  }

  if (loadError || !record) {
    return (
      <div className="page-shell flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-danger" role="alert">{loadError ?? '未找到该分析记录。'}</p>
        <button type="button" className="secondary-action px-4 py-2.5 text-sm" onClick={() => navigate('/requirement-analysis')}>
          返回列表
        </button>
      </div>
    )
  }

  const relayableCount = record.conditions.filter((c) => c.relay === 'none').length

  return (
    <div className="page-shell ra2-view">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Tooltip content="返回列表">
            <button
              type="button"
              onClick={() => navigate('/requirement-analysis')}
              className="icon-action h-10 w-10 rounded-xl"
              aria-label="返回列表"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Tooltip>
          <div>
            <h1 className="page-title">{record.title}</h1>
            <p className="page-subtitle">
              {record.sourceFileName ? `${record.sourceFileName} · ` : ''}
              问题 {record.issues.length} · 准则 {record.criteria.length} · 条件 {record.conditions.length}
            </p>
          </div>
        </div>
        <Tooltip content="重新分析（生成新记录，已处理的问题状态将继承；旧记录保留）">
          <button
            type="button"
            className="icon-action h-10 w-10 rounded-xl"
            aria-label="重新分析"
            disabled={reanalyzing}
            onClick={() => setReanalyzeConfirm(true)}
          >
            {reanalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </Tooltip>
        <Tooltip content="导出 Markdown（包含全部结果，不受筛选影响）">
          <button
            type="button"
            className="icon-action h-10 w-10 rounded-xl"
            aria-label="导出 Markdown"
            onClick={() => downloadAnalysisMarkdown(record, rtm)}
          >
            <Download className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {record.previousRecordId && (
        <p className="ra2-inherited-note" role="note">
          🔁 本记录由上一版重新分析生成{record.inheritedIssueCount > 0 ? `，已继承 ${record.inheritedIssueCount} 条已处理问题的状态` : ''}；旧记录保留在列表中。
        </p>
      )}
      {reanalyzing && (
        <p className="ra2-inherited-note" role="status">⏳ {reanalyzeProgress}</p>
      )}

      <div className="ra2-view-tabs">
        <nav className="ra2-tabs" role="tablist" aria-label="分析结果分区">
          <button type="button" role="tab" aria-selected={activeTab === 'issues'} className={activeTab === 'issues' ? 'is-active' : ''} onClick={() => setActiveTab('issues')}>
            问题日志 <span className="ra2-count">{record.issues.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'criteria'} className={activeTab === 'criteria' ? 'is-active' : ''} onClick={() => setActiveTab('criteria')}>
            验收准则 <span className="ra2-count">{record.criteria.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'conditions'} className={activeTab === 'conditions' ? 'is-active' : ''} onClick={() => setActiveTab('conditions')}>
            测试条件 <span className="ra2-count">{record.conditions.length}</span>
          </button>
          {uncovered.length > 0 && (
            <button type="button" role="tab" aria-selected={activeTab === 'uncovered'} className={activeTab === 'uncovered' ? 'is-active' : ''} onClick={() => setActiveTab('uncovered')}>
              未覆盖 <span className="ra2-count">{uncovered.length}</span>
            </button>
          )}
          <button type="button" role="tab" aria-selected={activeTab === 'rtm'} className={activeTab === 'rtm' ? 'is-active' : ''} onClick={() => setActiveTab('rtm')}>
            追溯矩阵
          </button>
        </nav>

        <main className="ra2-zones">
          {activeTab === 'issues' && <section className="ra2-zone" id="ra2-issues">
            <h2>⚠️ 问题日志</h2>
            <p className="ra2-zone-hint">AI 发现的歧义/缺失/冲突/不可测项。点状态可流转：待澄清 → 已澄清 → 已接受；勾选后可批量处理。</p>
            {record.issues.length > 0 && (
              <div className="ra2-filter-bar">
                <select className="ra2-filter-select" aria-label="按类型筛选" value={issueTypeFilter} onChange={(e) => { setIssueTypeFilter(e.target.value as typeof issueTypeFilter); setSelectedIssueIds(new Set()) }}>
                  <option value="all">全部类型</option>
                  <option value="ambiguity">歧义</option>
                  <option value="missing">缺失</option>
                  <option value="conflict">冲突</option>
                  <option value="untestable">不可测</option>
                </select>
                <select className="ra2-filter-select" aria-label="按严重度筛选" value={issueSeverityFilter} onChange={(e) => { setIssueSeverityFilter(e.target.value as typeof issueSeverityFilter); setSelectedIssueIds(new Set()) }}>
                  <option value="all">全部严重度</option>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
                <select className="ra2-filter-select" aria-label="按状态筛选" value={issueStatusFilter} onChange={(e) => { setIssueStatusFilter(e.target.value as typeof issueStatusFilter); setSelectedIssueIds(new Set()) }}>
                  <option value="all">全部状态</option>
                  <option value="open">待澄清</option>
                  <option value="resolved">已澄清</option>
                  <option value="accepted">已接受</option>
                </select>
                <span className="text-muted ra2-filter-count">{filteredIssues.length} / {record.issues.length} 条</span>
                <button type="button" className="ra2-filter-link" onClick={toggleSelectAllFiltered}>
                  {filteredIssues.length > 0 && filteredIssues.every((i) => selectedIssueIds.has(i.id)) ? '取消全选' : '全选当前结果'}
                </button>
              </div>
            )}
            {selectedIssueIds.size > 0 && (
              <div className="ra2-bulk-bar" role="toolbar" aria-label="批量操作" aria-busy={bulkBusy}>
                <span>已选 {selectedIssueIds.size} 条</span>
                <button type="button" onClick={() => setPendingBulk('resolved')}>批量标记已澄清</button>
                <button type="button" onClick={() => setPendingBulk('accepted')}>批量标记已接受</button>
                <button type="button" onClick={() => setSelectedIssueIds(new Set())}>清空选择</button>
              </div>
            )}
            {filteredIssues.length === 0 && <p className="text-muted">当前筛选下没有问题。</p>}
            {filteredIssues.map((issue) => (
              <article key={issue.id} className="ra2-issue">
                <div className="ra2-issue-head">
                  <input
                    type="checkbox"
                    aria-label={`选择问题：${issue.description.slice(0, 20)}`}
                    checked={selectedIssueIds.has(issue.id)}
                    onChange={() => toggleIssueSelected(issue.id)}
                  />
                  <span className={`ra2-badge ra2-badge-${issue.type}`}>{ISSUE_TYPE_LABEL[issue.type]}</span>
                  <span className="ra2-issue-sev">严重度 {SEVERITY_LABEL[issue.severity]}{issue.reqId ? ` · ${reqTextById.get(issue.reqId) ?? ''}` : ''}</span>
                  <button
                    type="button"
                    className={`ra2-status ra2-status-${issue.status}`}
                    onClick={() => void handleCycleIssueStatus(issue)}
                    title="点击流转状态"
                  >
                    {ISSUE_STATUS_LABEL[issue.status]}
                  </button>
                </div>
                <blockquote className="ra2-issue-quote">{issue.quote}</blockquote>
                <p className="ra2-issue-desc">{issue.description}</p>
                {issue.example && <p className="ra2-issue-example">💡 比如：{issue.example}</p>}
                {issue.suggestedQuestion && <p className="ra2-issue-ask">💬 建议澄清：{issue.suggestedQuestion}</p>}
              </article>
            ))}
          </section>}

          {activeTab === 'criteria' && <section className="ra2-zone" id="ra2-criteria">
            <h2>✅ 可测试化验收准则</h2>
            <p className="ra2-zone-hint">AI 将模糊需求改写为可度量形式。确认后生效；驳回会自动在问题日志生成「不可测」条目。</p>
            {record.criteria.length === 0 && <p className="text-muted">本轮分析未产生验收准则改写。</p>}
            {record.criteria.map((criterion) => (
              <article
                key={criterion.id}
                className={`ra2-ac${criterion.status === 'confirmed' ? ' is-confirmed' : ''}${criterion.status === 'rejected' ? ' is-rejected' : ''}`}
              >
                <p className="ra2-ac-from">原文（{reqTextById.get(criterion.reqId) ?? criterion.reqId}）：{criterion.originalText}</p>
                {editingCriterionId === criterion.id ? (
                  <div className="ra2-ac-edit">
                    <textarea
                      value={criterionDraft}
                      onChange={(e) => setCriterionDraft(e.target.value)}
                      rows={3}
                      aria-label="编辑验收准则"
                      autoFocus
                    />
                    <div className="ra2-ac-ops">
                      <button type="button" className="confirm" onClick={() => void handleCriterionEdit(criterion)}>保存</button>
                      <button type="button" onClick={() => setEditingCriterionId(null)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <p className="ra2-ac-rewritten">→ {criterion.rewrittenText}</p>
                )}
                {editingCriterionId !== criterion.id && (
                  <div className="ra2-ac-ops">
                    <button
                      type="button"
                      className={`confirm${criterion.status === 'confirmed' ? ' on' : ''}`}
                      onClick={() => void handleCriterionStatus(criterion, 'confirmed')}
                    >
                      {criterion.status === 'confirmed' ? '✓ 已确认' : '确认'}
                    </button>
                    <button type="button" onClick={() => { setEditingCriterionId(criterion.id); setCriterionDraft(criterion.rewrittenText) }}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className={`reject${criterion.status === 'rejected' ? ' on' : ''}`}
                      onClick={() => void handleCriterionStatus(criterion, 'rejected')}
                    >
                      {criterion.status === 'rejected' ? '已驳回' : '驳回'}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </section>}

          {activeTab === 'conditions' && <section className="ra2-zone" id="ra2-conditions">
            <h2>🧪 测试条件清单</h2>
            <p className="ra2-zone-hint">每条需求导出的待验证点，可人工增删改。勾选后一键接力到用例生成工具；已接力/已生成的条件受保护。</p>
            {record.conditions.length === 0 && <p className="text-muted">本轮分析未产出测试条件。</p>}
            {[...conditionsByReq.entries()].map(([reqId, conditions]) => (
              <div key={reqId} className="ra2-cond-group">
                <h3>{reqId === '__none__' ? '通用条件' : reqTextById.get(reqId) ?? reqId}</h3>
                {conditions.map((condition) => (
                  <div key={condition.id} className={`ra2-cond${condition.relay !== 'none' ? ' is-relayed' : ''}`}>
                    {editingConditionId === condition.id ? (
                      <div className="ra2-cond-edit">
                        <select className="ra2-filter-select" aria-label="条件分类" value={conditionDraftKind} onChange={(e) => setConditionDraftKind(e.target.value as ConditionKind)}>
                          <option value="normal">正常</option>
                          <option value="boundary">边界</option>
                          <option value="exception">异常</option>
                        </select>
                        <input
                          className="ra2-cond-edit-input"
                          aria-label="编辑条件文本"
                          value={conditionDraftText}
                          onChange={(e) => setConditionDraftText(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleEditCondition(condition)
                            if (e.key === 'Escape') setEditingConditionId(null)
                          }}
                        />
                        <button type="button" className="ra2-filter-link" onClick={() => void handleEditCondition(condition)}>保存</button>
                        <button type="button" className="ra2-filter-link" onClick={() => setEditingConditionId(null)}>取消</button>
                      </div>
                    ) : (
                      <label>
                        <input
                          type="checkbox"
                          checked={checked.has(condition.id)}
                          disabled={condition.relay !== 'none'}
                          onChange={() => toggleCondition(condition.id)}
                        />
                        <span className={`ra2-kind ra2-kind-${condition.kind}`}>{CONDITION_KIND_LABEL[condition.kind]}</span>
                        <span className="ra2-cond-text">{condition.text}</span>
                        {condition.relay === 'relayed' && <span className="ra2-relay-tag">已接力</span>}
                        {condition.relay === 'generated' && <span className="ra2-relay-tag is-generated">已生成用例</span>}
                      </label>
                    )}
                    {condition.relay === 'none' && editingConditionId !== condition.id && (
                      <span className="ra2-cond-ops">
                        <button
                          type="button"
                          aria-label={`编辑条件：${condition.text.slice(0, 20)}`}
                          onClick={() => { setEditingConditionId(condition.id); setConditionDraftText(condition.text); setConditionDraftKind(condition.kind) }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除条件：${condition.text.slice(0, 20)}`}
                          onClick={() => setPendingDeleteCondition(condition)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
                {addingForReq === reqId ? (
                  <div className="ra2-cond-edit">
                    <select className="ra2-filter-select" aria-label="新条件分类" value={newConditionKind} onChange={(e) => setNewConditionKind(e.target.value as ConditionKind)}>
                      <option value="normal">正常</option>
                      <option value="boundary">边界</option>
                      <option value="exception">异常</option>
                    </select>
                    <input
                      className="ra2-cond-edit-input"
                      aria-label="新条件文本"
                      placeholder="输入条件内容…"
                      value={newConditionText}
                      onChange={(e) => setNewConditionText(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleAddCondition(reqId)
                        if (e.key === 'Escape') setAddingForReq(null)
                      }}
                    />
                    <button type="button" className="ra2-filter-link" onClick={() => void handleAddCondition(reqId)}>添加</button>
                    <button type="button" className="ra2-filter-link" onClick={() => setAddingForReq(null)}>取消</button>
                  </div>
                ) : (
                  reqId !== '__none__' && (
                    <button type="button" className="ra2-cond-add" onClick={() => { setAddingForReq(reqId); setNewConditionText(''); setNewConditionKind('normal') }}>
                      <Plus className="h-3 w-3" /> 新增条件
                    </button>
                  )
                )}
              </div>
            ))}
            <div className="ra2-relay-bar">
              <span>已选 <b>{[...checked].filter((cid) => record.conditions.find((c) => c.id === cid)?.relay === 'none').length}</b> / {relayableCount} 条可接力测试条件</span>
              <button
                type="button"
                className="ra2-relay-btn ai-glass-action"
                disabled={relaying || checked.size === 0}
                onClick={() => void handleRelay()}
              >
                {relaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                接力到用例生成 →
              </button>
            </div>
          </section>}

          {activeTab === 'uncovered' && uncovered.length > 0 && (
            <section className="ra2-zone" id="ra2-uncovered">
              <h2>🕳️ 未覆盖需求</h2>
              <p className="ra2-zone-hint">以下条目本轮未产出测试条件。未覆盖是显式陈述，不等于没有风险——请人工确认是否接受。</p>
              <ul className="ra2-uncovered-list">
                {uncovered.map(({ req, reason }) => (
                  <li key={req.id} className="ra2-uncovered-item">
                    <span className="ra2-uncovered-text">{req.text}</span>
                    <span className="ra2-uncovered-reason">{reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {activeTab === 'rtm' && <section className="ra2-zone" id="ra2-rtm">
            <h2>🔗 追溯矩阵（RTM）</h2>
            <p className="ra2-zone-hint">需求 ↔ 测试条件 ↔ 用例的双向追溯。覆盖率为条件级。</p>
            {rtm && (
              <>
                <p className="ra2-cov">
                  <span className="ra2-cov-num">{rtm.coverage}%</span>
                  <span className="text-muted"> 条件覆盖率（{rtm.coveredConditions}/{rtm.totalConditions} 已生成用例）</span>
                </p>
                <table className="ra2-rtm">
                  <thead>
                    <tr><th>需求条目</th><th>测试条件</th><th>用例集</th><th>状态</th></tr>
                  </thead>
                  <tbody>
                    {rtm.rows.map((row) => (
                      <tr key={row.conditionId}>
                        <td>{row.reqText || '—'}</td>
                        <td>{row.conditionText}</td>
                        <td>{row.testsetId ?? '—'}</td>
                        <td>{row.relay === 'generated' ? '✅ 已生成' : row.relay === 'relayed' ? '🔄 已接力' : '⬜ 未接力'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>}
        </main>
      </div>

      <ConfirmDialog
        open={pendingBulk !== null}
        title={pendingBulk === 'resolved' ? '批量标记已澄清' : '批量标记已接受'}
        confirmText={pendingBulk === 'resolved' ? '标记已澄清' : '标记已接受'}
        description={pendingBulk ? `将把选中的 ${selectedIssueIds.size} 条问题批量标记为「${pendingBulk === 'resolved' ? '已澄清' : '已接受'}」。` : ''}
        onCancel={() => setPendingBulk(null)}
        onConfirm={() => void handleBulkConfirm()}
      />

      <ConfirmDialog
        open={pendingDeleteCondition !== null}
        title="删除测试条件"
        danger
        confirmText="确认删除"
        description={pendingDeleteCondition ? `将删除条件「${pendingDeleteCondition.text.slice(0, 60)}」，删除后不可恢复。` : ''}
        onCancel={() => setPendingDeleteCondition(null)}
        onConfirm={() => void handleDeleteCondition()}
      />

      <ConfirmDialog
        open={reanalyzeConfirm}
        title="重新分析这条需求？"
        confirmText="开始重新分析"
        description="将基于原文重新生成一份新记录：内容与上一版一致且已处理的问题会继承「已澄清/已接受」状态，其余问题重新待澄清。旧记录保留不覆盖。"
        onCancel={() => setReanalyzeConfirm(false)}
        onConfirm={() => void handleReanalyze()}
      />
    </div>
  )
}
