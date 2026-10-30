/** 用例管理（P3 升级）：状态页签 + 用例集分组 + 批量勾选 + Run All / 重跑失败 + 详情抽屉。 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, CheckCircle2, CheckSquare, FolderPlus, MinusCircle, Play, Plus, RefreshCw, Square, Trash2, User, Wand2 } from 'lucide-react'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import {
  createAutomationSet,
  deleteAutomationCase,
  getAutomationStatus,
  listAutomationCases,
  listAutomationSets,
  startBatchRuns,
  startAutomationRun,
  type AutomationCase,
  type AutomationSet,
  type EngineStatus,
} from '../../lib/automation-api'
import { listTestCaseProjects } from '../../lib/testcase-api'
import { loadActiveAiConfigSelection } from '../../lib/active-ai-config'
import { CaseDetailDrawer } from './CaseDetailDrawer'
import { RunProgressModal, type RunProgressHandle } from './RunProgressModal'

type Project = { id: string; name: string }
type StatusTab = 'all' | 'never' | 'passed' | 'partial' | 'failed'

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'never', label: '未运行' },
  { key: 'passed', label: '通过' },
  { key: 'partial', label: '部分' },
  { key: 'failed', label: '失败' },
]

function ExecutableBadge({ level, manualCount }: { level: AutomationCase['executable']; manualCount: number }) {
  if (level === 'full') {
    return <span className="at-badge at-badge-green"><CheckCircle2 size={12} />全自动</span>
  }
  if (level === 'partial') {
    return <span className="at-badge at-badge-amber"><MinusCircle size={12} />部分自动 · {manualCount} 项人工</span>
  }
  return <span className="at-badge at-badge-gray"><User size={12} />需人工</span>
}

function LastRunBadge({ item }: { item: AutomationCase }) {
  if (item.lastRunStatus === 'never' || !item.lastRunAt) {
    return <span className="at-muted at-small">从未运行</span>
  }
  const when = new Date(item.lastRunAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  if (item.lastRunStatus === 'passed') return <span className="at-small"><span style={{ color: 'var(--color-success)' }}>✓ 通过</span> <span className="at-muted">{when}</span></span>
  if (item.lastRunStatus === 'partial') return <span className="at-small"><span style={{ color: 'oklch(0.6 0.14 75)' }}>◐ 部分通过</span> <span className="at-muted">{when}</span></span>
  return <span className="at-small"><span style={{ color: 'var(--color-danger)' }}>✗ 失败</span> <span className="at-muted">{when}</span></span>
}

export function CaseListView({ projectId: lockedProjectId }: { projectId?: string } = {}) {
  const navigate = useNavigate()
  const [cases, setCases] = useState<AutomationCase[]>([])
  const [sets, setSets] = useState<AutomationSet[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState(lockedProjectId ?? '')
  const [setId, setSetId] = useState('')
  const [query, setQuery] = useState('')
  const [statusTab, setStatusTab] = useState<StatusTab>('all')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  const [runHandle, setRunHandle] = useState<RunProgressHandle | null>(null)
  const [deleting, setDeleting] = useState<AutomationCase | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [batching, setBatching] = useState(false)
  const [detailCase, setDetailCase] = useState<AutomationCase | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [caseList, setList, status] = await Promise.all([listAutomationCases(), listAutomationSets(), getAutomationStatus()])
      setCases(caseList)
      setSets(setList)
      setEngine(status.engine)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (lockedProjectId !== undefined) setProjectId(lockedProjectId)
  }, [lockedProjectId])

  useEffect(() => {
    void refresh()
    listTestCaseProjects()
      .then((list) => setProjects((list as { projects?: Project[] }).projects ?? (list as unknown as Project[])))
      .catch(() => setProjects([]))
  }, [refresh])

  /** 状态页签前的基础过滤（项目 / 用例集 / 搜索）。 */
  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cases.filter((item) => {
      if (projectId && item.projectId !== projectId) return false
      if (setId === '__none__' ? item.setId : setId && item.setId !== setId) return false
      if (q && !item.title.toLowerCase().includes(q) && !item.caseNo.toLowerCase().includes(q)) return false
      return true
    })
  }, [cases, projectId, setId, query])

  const statusCounts = useMemo(() => {
    const counts: Record<StatusTab, number> = { all: baseFiltered.length, never: 0, passed: 0, partial: 0, failed: 0 }
    for (const item of baseFiltered) counts[item.lastRunStatus] += 1
    return counts
  }, [baseFiltered])

  const filtered = useMemo(
    () => (statusTab === 'all' ? baseFiltered : baseFiltered.filter((item) => item.lastRunStatus === statusTab)),
    [baseFiltered, statusTab],
  )

  /** 按用例集分组（组名排序，未分组垫底），组内按编号排序。 */
  const grouped = useMemo(() => {
    const map = new Map<string, AutomationCase[]>()
    for (const item of filtered) {
      const name = setName(item.setId)
      const list = map.get(name) ?? []
      list.push(item)
      map.set(name, list)
    }
    return [...map.entries()]
      .map(([name, items]) => ({ name, items: [...items].sort((a, b) => a.caseNo.localeCompare(b.caseNo)) }))
      .sort((a, b) => (a.name === '未分组' ? 1 : b.name === '未分组' ? -1 : a.name.localeCompare(b.name)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sets])

  const projectName = useCallback((id: string) => projects.find((p) => p.id === id)?.name ?? id, [projects])
  function setName(id?: string): string {
    return sets.find((s) => s.id === id)?.name ?? '未分组'
  }

  const selectedItems = filtered.filter((item) => selected.has(item.id))
  const allOn = filtered.length > 0 && filtered.every((item) => selected.has(item.id))

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectMany = (items: AutomationCase[], next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev)
      for (const item of items) {
        if (next) copy.add(item.id)
        else copy.delete(item.id)
      }
      return copy
    })
  }

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const runCase = async (item: AutomationCase) => {
    try {
      // 带上当前 AI 配置：规划提案用例首跑时借此编译补全步骤（无配置则跑占位步骤）
      const aiSelection = await loadActiveAiConfigSelection().catch(() => null)
      const run = await startAutomationRun(item.id, aiSelection ? { aiConfig: aiSelection.payload } : undefined)
      setRunHandle({
        runId: run.id,
        title: `${item.caseNo} · ${item.title}`,
        onDone: () => void refresh(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 批量执行（Run All / 重跑失败 / 批量勾选共用）。 */
  const runBatch = async (items: AutomationCase[], label: string) => {
    const targets = items.filter((item) => item.executable !== 'manual')
    if (targets.length === 0) {
      setError(items.length === 0 ? '当前没有可执行的用例' : '所选用例均需人工，无法自动执行')
      return
    }
    setBatching(true)
    setError(null)
    setNotice(null)
    try {
      const aiSelection = await loadActiveAiConfigSelection().catch(() => null)
      const result = await startBatchRuns({ caseIds: targets.map((item) => item.id), aiConfig: aiSelection ? aiSelection.payload : undefined })
      setNotice(
        `${label}：已发起 ${result.started} 条执行（批次 #${result.batchId.slice(0, 8)}）` +
          (result.skippedManual.length > 0 ? `；跳过 ${result.skippedManual.length} 条需人工用例` : '') +
          (result.failed.length > 0 ? `；${result.failed.length} 条发起失败` : '') +
          '，到「运行」页查看进度',
      )
      void refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBatching(false)
    }
  }

  const createSet = async () => {
    const name = window.prompt('新用例集名称')
    if (!name?.trim() || !projectId) {
      if (!projectId) setError('先在左侧筛选中选择一个项目，再创建用例集')
      return
    }
    try {
      await createAutomationSet({ projectId, name: name.trim() })
      void refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      {engine && !engine.ready && (
        <p className="at-note" style={{ marginBottom: 12 }}>
          ⚠ 执行引擎不可用：{engine.reason}（用例管理不受影响；配置 server/.env 的 MIDSCENE_MODEL_* 并重启后恢复）
        </p>
      )}
      {error && <p className="at-note" style={{ marginBottom: 12, color: 'var(--color-danger)' }}>{error}</p>}
      {notice && <p className="at-note" style={{ marginBottom: 12 }}>{notice}</p>}
      <div className="at-toolbar">
        {!lockedProjectId && (
          <select className="at-select" value={projectId} onChange={(e) => { setProjectId(e.target.value); setSetId('') }}>
            <option value="">全部项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <select className="at-select" value={setId} onChange={(e) => setSetId(e.target.value)}>
          <option value="">全部用例集</option>
          {sets.filter((s) => !projectId || s.projectId === projectId).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          <option value="__none__">未分组</option>
        </select>
        <input
          className="at-input"
          style={{ width: 200 }}
          placeholder="搜索用例标题 / 编号"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="at-spacer" />
        <button
          className="at-btn at-btn-run"
          disabled={batching || filtered.length === 0 || engine?.ready === false}
          title="执行当前筛选出的全部可执行用例"
          onClick={() => void runBatch(filtered, 'Run All')}
        >
          <Play size={14} />{batching ? '发起中…' : 'Run All'}
        </button>
        <button
          className="at-btn"
          disabled={batching || engine?.ready === false}
          title="重跑最近一次失败或部分通过的用例"
          onClick={() => void runBatch(baseFiltered.filter((item) => item.lastRunStatus === 'failed' || item.lastRunStatus === 'partial'), '重跑失败')}
        >
          <RefreshCw size={14} />重跑失败
        </button>
        {selectedItems.length > 0 && (
          <>
            <button className="at-btn at-btn-run" disabled={batching || engine?.ready === false} onClick={() => void runBatch(selectedItems, '批量执行')}>
              <Play size={14} />批量执行（{selectedItems.length}）
            </button>
            <button className="at-btn at-btn-danger" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 size={14} />批量删除（{selectedItems.length}）
            </button>
          </>
        )}
        <button className="at-btn" title={projectId ? '在当前项目新建用例集' : '先选择项目'} onClick={() => void createSet()}>
          <FolderPlus size={14} />新建用例集
        </button>
        <button className="at-btn" onClick={() => navigate(`/automation/cases/new?from=functional${projectId ? `&project=${projectId}` : ''}`)}>
          <Wand2 size={14} />从功能用例导入
        </button>
        <button className="at-btn at-btn-primary" onClick={() => navigate(`/automation/cases/new${projectId ? `?project=${projectId}` : ''}`)}>
          <Plus size={14} />新建自动化用例
        </button>
      </div>

      <div className="at-tabs" role="tablist" aria-label="运行状态筛选">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={statusTab === tab.key}
            className={`at-tab ${statusTab === tab.key ? 'is-active' : ''}`}
            onClick={() => setStatusTab(tab.key)}
          >
            {tab.label} <span className="at-num">{statusCounts[tab.key]}</span>
          </button>
        ))}
      </div>

      <div className="at-card at-table-wrap">
        <table className="at-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="全选当前列表"
                  checked={allOn}
                  disabled={filtered.length === 0}
                  onChange={(e) => toggleSelectMany(filtered, e.target.checked)}
                />
              </th>
              <th>编号 / 标题</th>
              <th>项目</th>
              <th>可自动化程度</th>
              <th>步骤</th>
              <th>最近运行</th>
              <th style={{ width: 230 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="at-muted" style={{ textAlign: 'center', padding: 28 }}>加载中…</td></tr>
            )}
            {!loading && error && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--color-danger)' }}>{error}</td></tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="at-empty">
                    <Bot size={28} />
                    <div>没有符合条件的自动化用例</div>
                    <div className="at-small at-muted">到「规划」采纳提案生成用例，或新建一个</div>
                  </div>
                </td>
              </tr>
            )}
            {grouped.map((group) => {
              const collapsed = collapsedGroups.has(group.name)
              const groupOn = group.items.length > 0 && group.items.every((item) => selected.has(item.id))
              return (
                <Fragment key={group.name}>
                  <tr className="at-group-row">
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择分组 ${group.name}`}
                        checked={groupOn}
                        onChange={(e) => toggleSelectMany(group.items, e.target.checked)}
                      />
                    </td>
                    <td colSpan={6}>
                      <button className="at-btn at-btn-sm" onClick={() => toggleGroup(group.name)}>
                        {collapsed ? '▸' : '▾'} {group.name}
                      </button>
                      <span className="at-small at-muted" style={{ marginLeft: 8 }}>{group.items.length} 条用例</span>
                    </td>
                  </tr>
                  {!collapsed && group.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择用例 ${item.caseNo}`}
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                        />
                      </td>
                      <td>
                        <button className="at-title-btn" title="查看详情" onClick={() => setDetailCase(item)}>
                          <b className="at-num">{item.caseNo}</b> · {item.title}
                        </button>
                      </td>
                      <td>{projectName(item.projectId)}<span className="at-muted"> / {setName(item.setId)}</span></td>
                      <td><ExecutableBadge level={item.executable} manualCount={item.manualItems.length} /></td>
                      <td className="at-num">{item.steps.length > 0 ? `${item.steps.length} 步` : <span className="at-muted">无可执行步骤</span>}</td>
                      <td><LastRunBadge item={item} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            className="at-btn at-btn-sm at-btn-run"
                            disabled={item.executable === 'manual' || engine?.ready === false}
                            title={item.executable === 'manual' ? '无可自动执行步骤' : '执行该用例'}
                            onClick={() => void runCase(item)}
                          >
                            <Play size={13} />执行
                          </button>
                          <button className="at-btn at-btn-sm" title="查看详情" onClick={() => setDetailCase(item)}>详情</button>
                          <button className="at-btn at-btn-sm" onClick={() => navigate(`/automation/cases/${item.id}`)}>编辑</button>
                          <button className="at-btn at-btn-sm at-btn-danger" title="删除" aria-label={`删除用例 ${item.caseNo}`} onClick={() => setDeleting(item)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <RunProgressModal handle={runHandle} onClose={() => setRunHandle(null)} />

      <CaseDetailDrawer item={detailCase} onClose={() => setDetailCase(null)} />

      <ConfirmDialog
        open={deleting !== null}
        title="删除自动化用例"
        description={`确定删除 ${deleting?.caseNo} · ${deleting?.title} 吗？该操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={async () => {
          try {
            if (deleting) await deleteAutomationCase(deleting.id)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setDeleting(null)
            void refresh()
          }
        }}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title="批量删除自动化用例"
        description={`确定删除选中的 ${selectedItems.length} 条用例吗？该操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={async () => {
          const results = await Promise.allSettled(selectedItems.map((item) => deleteAutomationCase(item.id)))
          const failed = results.filter((r) => r.status === 'rejected').length
          setNotice(failed > 0 ? `批量删除完成：${selectedItems.length - failed} 条成功，${failed} 条失败` : `已删除 ${selectedItems.length} 条用例`)
          setSelected(new Set())
          setBulkDeleteOpen(false)
          void refresh()
        }}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </div>
  )
}
