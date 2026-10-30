/** Test Lists（/automation/lists）：跨项目用例集管理 + 整集执行 + 定时（Schedules）。 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarClock, ListChecks, Play, Plus, Sparkles, Trash2, XCircle } from 'lucide-react'
import {
  addTestListItem,
  createSchedule,
  createTestList,
  deleteSchedule,
  deleteTestList,
  getTestList,
  listAutomationCases,
  listTestLists,
  removeTestListItem,
  runScheduleNow,
  runTestList,
  updateSchedule,
  type ListRunResult,
  type TestListDetail,
  type TestListSummary,
} from '../../lib/automation-api'
import { loadActiveAiConfigSelection } from '../../lib/active-ai-config'

/** 常用 cron 预设（写进输入框的起点，用户可改）。 */
const CRON_PRESETS = ['0 9 * * *', '0 9 * * 1', '*/30 * * * *', '0 2 * * 0']

function RunResultNote({ result }: { result: ListRunResult }) {
  return (
    <p className="at-small" style={{ marginTop: 8 }}>
      已发起 {result.started} 条运行（批次 #{result.batchId.slice(0, 8)}）
      {result.skippedManual.length > 0 && <span style={{ color: 'oklch(0.6 0.14 75)' }}> · 跳过需人工 {result.skippedManual.length} 条</span>}
      {result.failed.length > 0 && <span style={{ color: 'var(--color-danger)' }}> · 失败 {result.failed.length} 条：{result.failed.map((f) => f.error).join('；')}</span>}
    </p>
  )
}

export function TestListsView() {
  const [searchParams] = useSearchParams()
  const [lists, setLists] = useState<TestListSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('select'))
  const [detail, setDetail] = useState<TestListDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<ListRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [addCaseId, setAddCaseId] = useState('')
  const [cronText, setCronText] = useState('')
  const [allCases, setAllCases] = useState<{ id: string; caseNo: string; title: string }[]>([])

  const refreshLists = useCallback(async () => {
    try {
      setLists(await listTestLists())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshDetail = useCallback(async (id: string) => {
    try {
      setDetail(await getTestList(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载列表详情失败')
    }
  }, [])

  useEffect(() => {
    void refreshLists()
    void listAutomationCases()
      .then((cases) => setAllCases(cases.map((c) => ({ id: c.id, caseNo: c.caseNo, title: c.title }))))
      .catch(() => undefined)
  }, [refreshLists])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    void refreshDetail(selectedId)
  }, [selectedId, refreshDetail])

  const selected = useMemo(() => lists.find((l) => l.id === selectedId) ?? null, [lists, selectedId])
  const unusedCases = useMemo(() => {
    const used = new Set((detail?.items ?? []).map((item) => item.caseId))
    return allCases.filter((c) => !used.has(c.id))
  }, [allCases, detail])

  async function withBusy(action: () => Promise<void>) {
    setBusy(true)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  async function onCreateList() {
    const name = newName.trim()
    if (!name) return
    await withBusy(async () => {
      const created = await createTestList({ name, description: newDesc.trim() })
      setNewName('')
      setNewDesc('')
      await refreshLists()
      setSelectedId(created.id)
      setNotice('列表已创建')
    })
  }

  async function onRunList() {
    if (!selectedId) return
    await withBusy(async () => {
      const aiSelection = await loadActiveAiConfigSelection()
      const result = await runTestList(selectedId, { engine: 'auto', aiConfig: aiSelection?.payload })
      setRunResult(result)
    })
  }

  async function onDeleteList() {
    if (!selectedId || !selected) return
    if (!window.confirm(`删除列表「${selected.name}」？成员项与定时一并删除，不影响用例本身。`)) return
    await withBusy(async () => {
      await deleteTestList(selectedId)
      setSelectedId(null)
      await refreshLists()
      setNotice('列表已删除')
    })
  }

  async function onAddCase() {
    if (!selectedId || !addCaseId) return
    await withBusy(async () => {
      await addTestListItem(selectedId, addCaseId)
      setAddCaseId('')
      await refreshDetail(selectedId)
    })
  }

  async function onRemoveItem(itemId: string) {
    if (!selectedId) return
    await withBusy(async () => {
      await removeTestListItem(itemId)
      await refreshDetail(selectedId)
    })
  }

  async function onAddSchedule() {
    if (!selectedId || !cronText.trim()) return
    await withBusy(async () => {
      await createSchedule({ listId: selectedId, cron: cronText.trim() })
      setCronText('')
      await Promise.all([refreshDetail(selectedId), refreshLists()])
    })
  }

  async function onToggleSchedule(scheduleId: string, enabled: boolean) {
    if (!selectedId) return
    await withBusy(async () => {
      await updateSchedule(scheduleId, { enabled })
      await refreshDetail(selectedId)
    })
  }

  async function onDeleteSchedule(scheduleId: string) {
    if (!selectedId) return
    await withBusy(async () => {
      await deleteSchedule(scheduleId)
      await Promise.all([refreshDetail(selectedId), refreshLists()])
    })
  }

  async function onRunScheduleNow(scheduleId: string) {
    await withBusy(async () => {
      const aiSelection = await loadActiveAiConfigSelection()
      const result = await runScheduleNow(scheduleId, { engine: 'auto', aiConfig: aiSelection?.payload })
      setRunResult(result)
    })
  }

  return (
    <div className="at-page">
      <div className="at-header">
        <div>
          <h1 className="at-title"><ListChecks size={20} style={{ verticalAlign: -3, marginRight: 8 }} />Test Lists · 定时</h1>
          <p className="at-subtitle">跨项目用例集：整集执行、从运行建列表、cron 定时到点触发（失败继续）</p>
        </div>
        <Link className="at-btn" to="/automation"><ArrowLeft size={14} />返回项目列表</Link>
      </div>

      {error && (
        <div className="at-card" style={{ borderColor: 'var(--color-danger)', marginBottom: 12 }}>
          <span style={{ color: 'var(--color-danger)' }}>{error}</span>{' '}
          <button className="at-btn at-btn-sm" onClick={() => setError(null)}>关闭</button>
        </div>
      )}
      {notice && <p className="at-small at-muted" style={{ marginBottom: 8 }}>{notice}</p>}

      <div className="at-lists-layout">
        <div className="at-card">
          <div className="at-toolbar" style={{ marginBottom: 8 }}>
            <b>用例集列表</b>
            <span className="at-muted at-small">{lists.length} 个</span>
          </div>
          {loading && <p className="at-muted at-small">加载中…</p>}
          {!loading && lists.length === 0 && <p className="at-muted at-small">还没有用例集 —— 从一次运行「建列表」开始，或在右侧新建</p>}
          {lists.map((list) => (
            <button
              key={list.id}
              className={`at-list-item ${list.id === selectedId ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(list.id)}
            >
              <span className="at-list-item-name">{list.name}</span>
              <span className="at-muted at-small">{list.itemCount} 用例 · {list.scheduleCount} 定时</span>
            </button>
          ))}
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            <input className="at-input" placeholder="新列表名称" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="at-input" placeholder="说明（可选）" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            <button className="at-btn at-btn-primary" onClick={() => void onCreateList()} disabled={busy || !newName.trim()}>
              <Plus size={13} />新建列表
            </button>
          </div>
        </div>

        <div className="at-card" style={{ minHeight: 320 }}>
          {!detail && <p className="at-muted at-small">选择左侧列表查看详情；或在运行详情页「从本次运行建列表」</p>}
          {detail && (
            <>
              <div className="at-toolbar">
                <div>
                  <h2 style={{ margin: 0, fontSize: 17 }}>{detail.name}</h2>
                  {detail.description && <p className="at-small at-muted" style={{ margin: '2px 0 0' }}>{detail.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="at-btn at-btn-primary" onClick={() => void onRunList()} disabled={busy || detail.items.length === 0}>
                    <Play size={13} />运行整集（失败继续）
                  </button>
                  <button className="at-btn" onClick={() => void onDeleteList()} disabled={busy}>
                    <Trash2 size={13} />删除列表
                  </button>
                </div>
              </div>
              {runResult && <RunResultNote result={runResult} />}

              <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>用例（{detail.items.length}）</h3>
              <table className="at-table">
                <thead>
                  <tr><th>编号</th><th>标题</th><th>入口</th><th>最近运行</th><th style={{ width: 70 }}></th></tr>
                </thead>
                <tbody>
                  {detail.items.length === 0 && <tr><td colSpan={5} className="at-muted at-small" style={{ textAlign: 'center', padding: 16 }}>列表为空</td></tr>}
                  {detail.items.map((item) => (
                    <tr key={item.id}>
                      <td className="at-num">{item.case?.caseNo ?? '—'}</td>
                      <td>
                        {item.case ? (
                          <Link to={`/automation/cases/${item.case.id}`}>{item.case.title}</Link>
                        ) : (
                          <span className="at-muted">用例已删除</span>
                        )}
                      </td>
                      <td className="at-small at-muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.case?.entryUrl || '—'}
                      </td>
                      <td className="at-small">{item.case?.lastRunStatus === 'passed' ? '✓ 通过' : item.case?.lastRunStatus === 'failed' ? '✗ 失败' : item.case?.lastRunStatus === 'partial' ? '◐ 部分' : '—'}</td>
                      <td>
                        <button className="at-btn at-btn-sm" onClick={() => void onRemoveItem(item.id)} disabled={busy} title="移出列表">
                          <XCircle size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {unusedCases.length > 0 && (
                <div className="at-toolbar" style={{ marginTop: 8 }}>
                  <select className="at-input" style={{ maxWidth: 360 }} value={addCaseId} onChange={(e) => setAddCaseId(e.target.value)}>
                    <option value="">选择用例加入列表…</option>
                    {unusedCases.map((c) => (
                      <option key={c.id} value={c.id}>{c.caseNo} · {c.title}</option>
                    ))}
                  </select>
                  <button className="at-btn" onClick={() => void onAddCase()} disabled={busy || !addCaseId}>
                    <Plus size={13} />加入
                  </button>
                </div>
              )}

              <h3 style={{ fontSize: 14, margin: '18px 0 6px' }}><CalendarClock size={14} style={{ verticalAlign: -2 }} /> 定时（Schedules）</h3>
              <table className="at-table">
                <thead>
                  <tr><th>cron</th><th>说明</th><th>最近触发</th><th>启用</th><th style={{ width: 150 }}></th></tr>
                </thead>
                <tbody>
                  {detail.schedules.length === 0 && <tr><td colSpan={5} className="at-muted at-small" style={{ textAlign: 'center', padding: 16 }}>还没有定时</td></tr>}
                  {detail.schedules.map((schedule) => (
                    <tr key={schedule.id}>
                      <td className="at-num at-small">{schedule.cron}</td>
                      <td className="at-small">{schedule.cronText}</td>
                      <td className="at-small at-muted">{schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString('zh-CN') : '—'}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={schedule.enabled}
                          onChange={(e) => void onToggleSchedule(schedule.id, e.target.checked)}
                          disabled={busy}
                          aria-label={`启用定时 ${schedule.cron}`}
                        />
                      </td>
                      <td>
                        <button className="at-btn at-btn-sm" onClick={() => void onRunScheduleNow(schedule.id)} disabled={busy} title="立即执行一次">
                          <Play size={13} />
                        </button>{' '}
                        <button className="at-btn at-btn-sm" onClick={() => void onDeleteSchedule(schedule.id)} disabled={busy} title="删除定时">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="at-toolbar" style={{ marginTop: 8 }}>
                <input
                  className="at-input"
                  style={{ maxWidth: 220 }}
                  placeholder="cron（分 时 日 月 周）"
                  value={cronText}
                  onChange={(e) => setCronText(e.target.value)}
                />
                {CRON_PRESETS.map((preset) => (
                  <button key={preset} className="at-btn at-btn-sm" onClick={() => setCronText(preset)}>{preset}</button>
                ))}
                <button className="at-btn at-btn-primary" onClick={() => void onAddSchedule()} disabled={busy || !cronText.trim()}>
                  <Plus size={13} />添加定时
                </button>
              </div>
              <p className="at-small at-muted" style={{ marginTop: 6 }}>
                <Sparkles size={12} style={{ verticalAlign: -2 }} /> 到点自动整集执行（服务端扫描，分钟粒度）；定时触发不带 AI 配置，未编译提案用例按占位步骤直跑。
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
