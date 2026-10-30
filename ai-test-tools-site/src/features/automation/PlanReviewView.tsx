/** 规划评审页（P3）：生成提案（SSE 进度）→ 按 useCase 分组勾选/编辑 → 生成并执行（首跑编译）。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckSquare, ClipboardList, Loader2, Pencil, Play, RefreshCw, Square, Trash2 } from 'lucide-react'
import {
  acceptPlanProposals,
  deletePlanProposal,
  generatePlanProposals,
  listExploreSources,
  listPlanProposals,
  subscribePlanEvents,
  updatePlanProposal,
  type PlanEvent,
  type PlanProposal,
  type PlanProposalPriority,
} from '../../lib/automation-api'
import { loadActiveAiConfigSelection } from '../../lib/active-ai-config'

const PRIORITY_LABEL: Record<PlanProposalPriority, { text: string; className: string }> = {
  high: { text: '高', className: 'at-badge at-badge-red' },
  medium: { text: '中', className: 'at-badge at-badge-amber' },
  low: { text: '低', className: 'at-badge at-badge-gray' },
}

type LogLine = { level: 'info' | 'warn'; text: string }
type Draft = { title: string; goal: string; estSteps: string; expected: string; priority: PlanProposalPriority }

function toDraft(p: PlanProposal): Draft {
  return {
    title: p.title,
    goal: p.goal,
    estSteps: p.estSteps.join('\n'),
    expected: p.expected.join('\n'),
    priority: p.priority,
  }
}

function splitLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean)
}

export function PlanReviewView({ projectId, systemUrl }: { projectId: string; systemUrl: string }) {
  const [sources, setSources] = useState<{ id: string; entryUrl: string; pageCount: number }[]>([])
  const [sourceId, setSourceId] = useState('')
  const [proposals, setProposals] = useState<PlanProposal[]>([])
  const [batchId, setBatchId] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const refreshProposals = useCallback(async () => {
    try {
      const list = await listPlanProposals(projectId)
      setProposals(list)
      setBatchId((current) => {
        if (current && list.some((p) => p.batchId === current)) return current
        // 列表按创建时间倒序，首条即最新批次
        return list[0]?.batchId ?? ''
      })
    } catch {
      setProposals([])
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    void refreshProposals()
    listExploreSources(projectId)
      .then((list) => {
        if (cancelled) return
        setSources(list.map((s) => ({ id: s.id, entryUrl: s.entryUrl, pageCount: s.pageCount })))
        const withPages = list.find((s) => s.pageCount > 0)
        if (withPages) setSourceId(withPages.id)
      })
      .catch(() => setSources([]))
    return () => {
      cancelled = true
      unsubscribeRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [logs])

  /** 当前批次（默认最新），组内按 useCase 分组、caseNo 排序。 */
  const grouped = useMemo(() => {
    const inBatch = proposals.filter((p) => (batchId ? p.batchId === batchId : true))
    const map = new Map<string, PlanProposal[]>()
    for (const p of inBatch) {
      const list = map.get(p.useCase) ?? []
      list.push(p)
      map.set(p.useCase, list)
    }
    return [...map.entries()].map(([useCase, list]) => ({
      useCase,
      items: list.sort((a, b) => a.caseNo.localeCompare(b.caseNo)),
    }))
  }, [proposals, batchId])

  const batchProposals = grouped.flatMap((g) => g.items)
  const selectedCount = batchProposals.filter((p) => p.included && p.status === 'proposed').length
  const batches = useMemo(() => [...new Set(proposals.map((p) => p.batchId))], [proposals])

  const generate = async () => {
    if (generating) return
    const aiSelection = await loadActiveAiConfigSelection().catch(() => null)
    if (!aiSelection) {
      setError('生成提案需要 AI 模型：先在「AI 配置」里选择一个可用模型')
      return
    }
    setGenerating(true)
    setError(null)
    setNotice(null)
    setLogs([])
    try {
      const job = await generatePlanProposals({
        projectId,
        sourceId: sourceId || undefined,
        entryUrl: systemUrl || undefined,
        aiConfig: aiSelection.payload,
      })
      setBatchId(job.batchId)
      unsubscribeRef.current?.()
      unsubscribeRef.current = subscribePlanEvents(
        job.id,
        (event: PlanEvent) => {
          if (event.kind === 'log') setLogs((prev) => [...prev.slice(-200), { level: event.level, text: event.text }])
          if (event.kind === 'stage') {
            const label = event.stage === 'generate' ? 'LLM 生成提案…' : event.stage === 'validate' ? '校验并落库…' : '完成'
            setLogs((prev) => [...prev, { level: 'info', text: `— ${label} —` }])
          }
          if (event.kind === 'error') setError(event.message)
          if (event.kind === 'done') {
            setGenerating(false)
            void refreshProposals()
          }
        },
        (message) => setLogs((prev) => [...prev, { level: 'warn', text: message }]),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '发起生成失败')
      setGenerating(false)
    }
  }

  const toggleIncluded = async (p: PlanProposal) => {
    const next = !p.included
    setProposals((prev) => prev.map((item) => (item.id === p.id ? { ...item, included: next } : item)))
    try {
      await updatePlanProposal(p.id, { included: next })
    } catch (err) {
      setProposals((prev) => prev.map((item) => (item.id === p.id ? { ...item, included: !next } : item)))
      setError(err instanceof Error ? err.message : '保存勾选失败')
    }
  }

  const toggleGroup = async (items: PlanProposal[], next: boolean) => {
    const targets = items.filter((p) => p.status === 'proposed' && p.included !== next)
    setProposals((prev) => prev.map((item) => (targets.some((t) => t.id === item.id) ? { ...item, included: next } : item)))
    try {
      await Promise.all(targets.map((p) => updatePlanProposal(p.id, { included: next })))
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存勾选失败')
      void refreshProposals()
    }
  }

  const openEditor = (p: PlanProposal) => {
    setEditingId(p.id)
    setDraft(toDraft(p))
    setError(null)
  }

  const saveDraft = async () => {
    if (!editingId || !draft) return
    const estSteps = splitLines(draft.estSteps)
    const expected = splitLines(draft.expected)
    if (!draft.title.trim() || !draft.goal.trim() || estSteps.length === 0 || expected.length === 0) {
      setError('标题 / 目标 / 步骤 / 预期 均不可为空')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await updatePlanProposal(editingId, {
        title: draft.title.trim(),
        goal: draft.goal.trim(),
        estSteps,
        expected,
        priority: draft.priority,
      })
      setProposals((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setEditingId(null)
      setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: PlanProposal) => {
    try {
      await deletePlanProposal(p.id)
      setProposals((prev) => prev.filter((item) => item.id !== p.id))
      if (editingId === p.id) {
        setEditingId(null)
        setDraft(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const generateAndRun = async () => {
    const ids = batchProposals.filter((p) => p.included && p.status === 'proposed').map((p) => p.id)
    if (ids.length === 0) {
      setError('先勾选要采纳的提案')
      return
    }
    if (!systemUrl) {
      setError('项目没有入口地址，无法生成用例')
      return
    }
    const aiSelection = await loadActiveAiConfigSelection().catch(() => null)
    setAccepting(true)
    setError(null)
    setNotice(null)
    try {
      const result = await acceptPlanProposals({
        proposalIds: ids,
        run: true,
        entryUrl: systemUrl,
        aiConfig: aiSelection ? aiSelection.payload : undefined,
      })
      setNotice(
        `已生成 ${result.created.length} 条用例` +
          (result.batchId ? `，发起 ${result.runs.length} 条执行（批次 #${result.batchId.slice(0, 8)}）` : '') +
          (result.warning ? `；${result.warning}` : '') +
          (result.runs.length > 0 ? '。到「运行」页查看进度' : ''),
      )
      void refreshProposals()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成并执行失败')
    } finally {
      setAccepting(false)
    }
  }

  return (
    <div className="at-cards-col">
      <div className="at-card">
        <div className="at-card-head">
          <ClipboardList size={15} />
          <span>规划评审</span>
          <span className="at-small at-muted">LLM 读捕获页 + PRD 产出测试提案，勾选后生成用例并执行（首跑时补全步骤）</span>
        </div>
        <div className="at-fields" style={{ gridTemplateColumns: 'minmax(0, 2fr) auto auto', alignItems: 'end' }}>
          <div className="at-field">
            <label htmlFor="at-plan-src">页面来源</label>
            <select id="at-plan-src" className="at-input" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">最近一次有捕获的探源</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.entryUrl}（{s.pageCount} 页）
                </option>
              ))}
            </select>
          </div>
          <div className="at-field">
            <button className="at-btn at-btn-primary" disabled={generating || accepting} onClick={() => void generate()}>
              {generating ? <Loader2 size={13} className="at-spin" /> : <RefreshCw size={13} />} 生成提案
            </button>
          </div>
          <div className="at-field">
            <button className="at-btn at-btn-run" disabled={generating || accepting || selectedCount === 0} onClick={() => void generateAndRun()}>
              {accepting ? <Loader2 size={13} className="at-spin" /> : <Play size={13} />} 生成并执行（{selectedCount}）
            </button>
          </div>
        </div>
        {error && (
          <div className="at-status-banner is-warn" style={{ marginTop: 10 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        {notice && (
          <div className="at-status-banner" style={{ marginTop: 10 }}>
            {notice}
          </div>
        )}
        {(generating || logs.length > 0) && (
          <div className="at-src-log" style={{ marginTop: 10, maxHeight: 120 }} aria-label="生成日志">
            {logs.map((line, i) => (
              <div key={i} className={`at-src-log-line is-${line.level}`}>
                {line.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {batches.length > 1 && (
        <div className="at-card">
          <div className="at-card-head">
            <span>批次</span>
            <select className="at-select" style={{ maxWidth: 260 }} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              {batches.map((id) => {
                const first = proposals.find((p) => p.batchId === id)
                return (
                  <option key={id} value={id}>
                    {first ? new Date(first.createdAt).toLocaleString() : id.slice(0, 8)}（{proposals.filter((p) => p.batchId === id).length} 条）
                  </option>
                )
              })}
            </select>
          </div>
        </div>
      )}

      {batchProposals.length === 0 ? (
        <div className="at-card">
          <div className="at-empty">
            <ClipboardList size={28} />
            <div>还没有测试提案</div>
            <div className="at-small at-muted">先到「探源」捕获页面（或在设置里填 PRD），再点「生成提案」</div>
          </div>
        </div>
      ) : (
        grouped.map((group) => {
          const proposed = group.items.filter((p) => p.status === 'proposed')
          const allOn = proposed.length > 0 && proposed.every((p) => p.included)
          return (
            <div className="at-card" key={group.useCase}>
              <div className="at-card-head">
                <button className="at-btn at-btn-sm" disabled={proposed.length === 0} onClick={() => void toggleGroup(group.items, !allOn)}>
                  {allOn ? <CheckSquare size={13} /> : <Square size={13} />} {group.useCase}
                </button>
                <span className="at-small at-muted">{group.items.length} 条提案</span>
              </div>
              <table className="at-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th>编号 / 标题</th>
                    <th>目标</th>
                    <th>优先级</th>
                    <th>预估步骤</th>
                    <th style={{ width: 150 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((p) => (
                    <ProposalRow
                      key={p.id}
                      proposal={p}
                      editing={editingId === p.id}
                      draft={draft}
                      saving={saving}
                      onDraft={setDraft}
                      onToggle={() => void toggleIncluded(p)}
                      onEdit={() => openEditor(p)}
                      onCancelEdit={() => {
                        setEditingId(null)
                        setDraft(null)
                      }}
                      onSave={() => void saveDraft()}
                      onRemove={() => void remove(p)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        })
      )}
    </div>
  )
}

function ProposalRow(props: {
  proposal: PlanProposal
  editing: boolean
  draft: Draft | null
  saving: boolean
  onDraft: (draft: Draft) => void
  onToggle: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onRemove: () => void
}) {
  const { proposal: p, editing, draft, saving } = props
  const disabled = p.status !== 'proposed'
  return (
    <>
      <tr className={editing ? 'is-active' : ''}>
        <td>
          <input
            type="checkbox"
            aria-label={`选择 ${p.caseNo}`}
            checked={p.included && !disabled}
            disabled={disabled}
            onChange={props.onToggle}
          />
        </td>
        <td>
          <b className="at-num">{p.caseNo}</b> · {p.title}
          {p.status === 'accepted' && <span className="at-badge at-badge-green" style={{ marginLeft: 6 }}>已采纳</span>}
          {p.status === 'rejected' && <span className="at-badge at-badge-gray" style={{ marginLeft: 6 }}>已拒绝</span>}
        </td>
        <td className="at-src-card-url" title={p.goal}>
          {p.goal}
        </td>
        <td>
          <span className={PRIORITY_LABEL[p.priority].className}>{PRIORITY_LABEL[p.priority].text}</span>
        </td>
        <td className="at-num">{p.estSteps.length} 步 · {p.expected.length} 预期</td>
        <td>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="at-btn at-btn-sm" disabled={disabled} onClick={props.onEdit} title="编辑提案">
              <Pencil size={12} />
            </button>
            <button className="at-btn at-btn-sm at-btn-danger" onClick={props.onRemove} title="删除提案">
              <Trash2 size={12} />
            </button>
          </div>
        </td>
      </tr>
      {editing && draft && (
        <tr>
          <td colSpan={6}>
            <div className="at-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="at-field">
                <label>标题</label>
                <input className="at-input" value={draft.title} onChange={(e) => props.onDraft({ ...draft, title: e.target.value })} />
              </div>
              <div className="at-field">
                <label>优先级</label>
                <select className="at-input" value={draft.priority} onChange={(e) => props.onDraft({ ...draft, priority: e.target.value as PlanProposalPriority })}>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </div>
              <div className="at-field">
                <label>目标（验证什么）</label>
                <textarea className="at-input" rows={2} value={draft.goal} onChange={(e) => props.onDraft({ ...draft, goal: e.target.value })} />
              </div>
              <div className="at-field">
                <label>预估步骤（每行一条）</label>
                <textarea className="at-input" rows={4} value={draft.estSteps} onChange={(e) => props.onDraft({ ...draft, estSteps: e.target.value })} />
              </div>
              <div className="at-field">
                <label>预期结果（每行一条）</label>
                <textarea className="at-input" rows={3} value={draft.expected} onChange={(e) => props.onDraft({ ...draft, expected: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="at-btn at-btn-primary at-btn-sm" disabled={saving} onClick={props.onSave}>
                {saving ? '保存中…' : '保存'}
              </button>
              <button className="at-btn at-btn-sm" onClick={props.onCancelEdit}>
                取消
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
