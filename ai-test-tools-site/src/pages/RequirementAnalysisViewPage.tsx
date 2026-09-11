import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Loader2, Share2 } from 'lucide-react'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import {
  getAnalysisRecord,
  getAnalysisRtm,
  patchAnalysisIssue,
  patchCriterion,
  relayConditions,
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
  const [editingCriterionId, setEditingCriterionId] = useState<string | null>(null)
  const [criterionDraft, setCriterionDraft] = useState('')

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
      <header className="ra2-view-capsule">
        <button type="button" className="ra2-capsule-btn" aria-label="返回列表" onClick={() => navigate('/requirement-analysis')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="ra2-capsule-title" title={record.title}>{record.title}</span>
        {record.sourceFileName && <span className="ra2-capsule-file">📄 {record.sourceFileName}</span>}
        <button type="button" className="ra2-capsule-btn" aria-label="导出（二期）" disabled title="导出功能二期提供">
          <Download className="h-4 w-4" />
        </button>
      </header>

      <div className="ra2-view-layout">
        <nav className="ra2-zone-nav" aria-label="分区导航">
          <a href="#ra2-issues">问题日志 <span className="ra2-count">{record.issues.length}</span></a>
          <a href="#ra2-criteria">验收准则 <span className="ra2-count">{record.criteria.length}</span></a>
          <a href="#ra2-conditions">测试条件 <span className="ra2-count">{record.conditions.length}</span></a>
          <a href="#ra2-rtm">追溯矩阵</a>
        </nav>

        <main className="ra2-zones">
          <section className="ra2-zone" id="ra2-issues">
            <h2>⚠️ 问题日志</h2>
            <p className="ra2-zone-hint">AI 发现的歧义/缺失/冲突/不可测项。点状态可流转：待澄清 → 已澄清 → 已接受。</p>
            {record.issues.length === 0 && <p className="text-muted">未发现需求问题。</p>}
            {record.issues.map((issue) => (
              <article key={issue.id} className="ra2-issue">
                <div className="ra2-issue-head">
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
                {issue.suggestedQuestion && <p className="ra2-issue-ask">💬 建议澄清：{issue.suggestedQuestion}</p>}
              </article>
            ))}
          </section>

          <section className="ra2-zone" id="ra2-criteria">
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
          </section>

          <section className="ra2-zone" id="ra2-conditions">
            <h2>🧪 测试条件清单</h2>
            <p className="ra2-zone-hint">每条需求导出的待验证点。勾选后一键接力到用例生成工具。</p>
            {record.conditions.length === 0 && <p className="text-muted">本轮分析未产出测试条件。</p>}
            {[...conditionsByReq.entries()].map(([reqId, conditions]) => (
              <div key={reqId} className="ra2-cond-group">
                <h3>{reqId === '__none__' ? '通用条件' : reqTextById.get(reqId) ?? reqId}</h3>
                {conditions.map((condition) => (
                  <label key={condition.id} className={`ra2-cond${condition.relay !== 'none' ? ' is-relayed' : ''}`}>
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
                ))}
              </div>
            ))}
            <div className="ra2-relay-bar">
              <span>已选 <b>{[...checked].filter((cid) => record.conditions.find((c) => c.id === cid)?.relay === 'none').length}</b> / {relayableCount} 条可接力测试条件</span>
              <button
                type="button"
                className="ra2-relay-btn"
                disabled={relaying || checked.size === 0}
                onClick={() => void handleRelay()}
              >
                {relaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                接力到用例生成 →
              </button>
            </div>
          </section>

          <section className="ra2-zone" id="ra2-rtm">
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
          </section>
        </main>
      </div>
    </div>
  )
}
