/** 运行历史：统计卡 + 运行列表（可展开步骤回放与逐步结果 + 报告新标签页打开）+ 运行中自动刷新。 */

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronDown, ChevronUp, MinusCircle, RotateCw, Sparkles, User, XCircle } from 'lucide-react'
import {
  automationRunReportUrl,
  listAutomationCases,
  listAutomationRuns,
  type RunRecord,
  type StepResult,
} from '../../lib/automation-api'

function VerdictBadge({ verdict }: { verdict?: RunRecord['verdict'] }) {
  if (!verdict) return <span className="at-badge at-badge-blue">进行中</span>
  if (verdict === 'passed') return <span className="at-badge at-badge-green"><CheckCircle2 size={12} />通过</span>
  if (verdict === 'partial') return <span className="at-badge at-badge-amber"><MinusCircle size={12} />部分通过</span>
  if (verdict === 'aborted') return <span className="at-badge at-badge-gray">已中止</span>
  return <span className="at-badge at-badge-red"><XCircle size={12} />失败</span>
}

function ReplayStep({ result }: { result: StepResult }) {
  if (result.status === 'passed') return <span className="at-replay-step at-rs-ok" title={`${result.text}（${(result.durationMs / 1000).toFixed(1)}s）`}>{result.stepId || '✓'}</span>
  if (result.status === 'failed') return <span className="at-replay-step at-rs-fail" title={`${result.text}：${result.error ?? ''}`}>{result.stepId || '✗'}</span>
  if (result.status === 'skipped-manual') return <span className="at-replay-step at-rs-skip" title={`人工项：${result.text}（${result.error ?? '已跳过'}）`}><User size={12} /></span>
  return <span className="at-replay-step at-rs-muted" title={`已禁用：${result.text}`}>{result.stepId}</span>
}

const STEP_TYPE_META: Record<string, { label: string; badge: string }> = {
  act: { label: '动作', badge: 'at-badge-blue' },
  assert: { label: '断言', badge: 'at-badge-violet' },
  extract: { label: '提取', badge: 'at-badge-cyan' },
  wait: { label: '等待', badge: 'at-badge-gray' },
  external: { label: '外部', badge: 'at-badge-amber' },
}

function StepStatusBadge({ status }: { status: StepResult['status'] }) {
  if (status === 'passed') return <span className="at-badge at-badge-green">通过</span>
  if (status === 'failed') return <span className="at-badge at-badge-red">失败</span>
  if (status === 'skipped-manual') return <span className="at-badge at-badge-amber">人工跳过</span>
  return <span className="at-badge at-badge-gray">已禁用</span>
}

/** 逐步结果明细：悬停色块的平铺版本——不依赖报告文件也能看到每步做了什么、谁执行的、成败与原因。 */
function StepDetailList({ results }: { results: StepResult[] }) {
  return (
    <div className="at-sd-list">
      {results.map((result) => {
        const meta = STEP_TYPE_META[result.type] ?? { label: result.type, badge: 'at-badge-gray' }
        return (
          <div key={result.stepId} className="at-sd-row">
            <span className="at-sd-no">{result.stepId || '—'}</span>
            <span className={`at-badge ${meta.badge}`}>{meta.label}</span>
            <span className="at-sd-text">{result.text}</span>
            <span className="at-sd-meta">
              {result.engine && (
                <span className={`at-badge ${result.engine === 'fast' ? 'at-badge-violet' : 'at-badge-blue'}`}>
                  {result.engine === 'fast' ? '极速' : '视觉'}
                </span>
              )}
              <StepStatusBadge status={result.status} />
              <span className="at-num at-small at-muted">{(result.durationMs / 1000).toFixed(1)}s</span>
            </span>
            {result.extractedValue !== undefined && (
              <div className="at-sd-note">提取值：<code className="at-var-chip">{result.extractedValue}</code></div>
            )}
            {result.status === 'failed' && result.error && <div className="at-sd-error">{result.error}</div>}
            {result.status === 'skipped-manual' && result.error && <div className="at-sd-note">原因：{result.error}</div>}
          </div>
        )
      })}
    </div>
  )
}

function RunRow({ run, expanded, onToggle, projectId }: { run: RunRecord; expanded: boolean; onToggle: () => void; projectId?: string }) {
  return (
    <>
      <tr>
        <td><b className="at-num">#{run.id.slice(0, 8)}</b></td>
        <td>{run.caseNo} · {run.title}</td>
        <td className="at-small at-muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.entryUrl || '—'}</td>
        <td><VerdictBadge verdict={run.verdict} /></td>
        <td className="at-num">{run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : '—'}</td>
        <td><span className={`at-badge ${run.engine === 'auto' ? 'at-badge-violet' : 'at-badge-blue'}`}>{run.engine === 'auto' ? '混合' : '视觉'}</span></td>
        <td className="at-muted at-small">{new Date(run.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td>
          <button className="at-btn at-btn-sm" onClick={onToggle}>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} 详情
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="at-run-detail">
            <div className="at-small at-muted">步骤回放（悬停看详情）：</div>
            <div className="at-replay-steps">
              {run.stepResults.map((result, index) => <ReplayStep key={index} result={result} />)}
              {run.stepResults.length === 0 && <span className="at-muted at-small">运行尚未产生步骤结果</span>}
            </div>
            {run.stepResults.length > 0 && <StepDetailList results={run.stepResults} />}
            {run.verdict === 'partial' && (
              <p className="at-small" style={{ color: 'oklch(0.6 0.14 75)' }}>
                ◐ 部分通过 —— 含 {run.manualItems.length} 项人工项未执行，不构成完整验证。
              </p>
            )}
            {run.error && <p className="at-small" style={{ color: 'var(--color-danger)' }}>{run.error}</p>}
            {projectId && (
              <Link className="at-btn" style={{ marginTop: 8, marginRight: 8 }} to={`/automation/p/${projectId}/runs/${run.id}`}>
                <Sparkles size={13} />运行详情（AI 根因 · 站点图）
              </Link>
            )}
            {run.reportFile ? (
              <a
                className="at-btn"
                style={{ marginTop: 8 }}
                href={automationRunReportUrl(run.id)}
                target="_blank"
                rel="noreferrer"
              >
                {run.reportFile.includes('fast-replay-')
                  ? '查看极速回放（逐步截图 + 决策记录 + 耗时）↗'
                  : '查看完整报告（逐步截图 + 模型思考 + 点击落点）↗'}
              </a>
            ) : (
              run.status === 'done' && run.stepResults.length > 0 && (
                <p className="at-small at-muted" style={{ marginBottom: 0 }}>
                  本次运行全程由极速引擎完成，Midscene 未产生过程报告（极速路径不做逐步截图）；逐步结果见上表。
                </p>
              )
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export function RunHistoryView({ projectId }: { projectId?: string } = {}) {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const runsRef = useRef<RunRecord[]>([])
  runsRef.current = runs

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const all = await listAutomationRuns(undefined, 50)
      if (!projectId) {
        setRuns(all)
      } else {
        // 项目态：运行不带 projectId，用用例集归属过滤（plan 直跑无 caseId，项目态下不显示）
        const projectCases = await listAutomationCases(projectId)
        const ids = new Set(projectCases.map((c) => c.id))
        setRuns(all.filter((r) => r.caseId && ids.has(r.caseId)))
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // 有进行中的运行时每 3s 静默轮询（读 ref 判断，updater 保持纯函数，评审 M8）
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      if (runsRef.current.some((r) => r.status !== 'done')) void refresh(true)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const stats = useMemo(() => {
    const done = runs.filter((r) => r.status === 'done')
    const today = runs.filter((r) => new Date(r.createdAt).toDateString() === new Date().toDateString())
    const passed = done.filter((r) => r.verdict === 'passed').length
    const durations = done.map((r) => r.durationMs ?? 0).filter((d) => d > 0)
    const avg = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000) : 0
    const manualPending = done.reduce((sum, r) => sum + (r.verdict === 'partial' ? r.manualItems.length : 0), 0)
    return {
      todayCount: today.length,
      passRate: done.length > 0 ? Math.round((passed / done.length) * 100) : 0,
      avgSeconds: avg,
      manualPending,
    }
  }, [runs])

  // 按套件批次分组：同 batchId 的成员运行聚合为一组（批次头 + 成员行），无批次的运行单列
  const groups = useMemo(() => {
    const byBatch = new Map<string, RunRecord[]>()
    const singles: RunRecord[] = []
    for (const run of runs) {
      if (run.batchId) {
        const list = byBatch.get(run.batchId) ?? []
        list.push(run)
        byBatch.set(run.batchId, list)
      } else {
        singles.push(run)
      }
    }
    const batchGroups = [...byBatch.entries()].map(([batchId, members]) => {
      const done = members.filter((r) => r.status === 'done')
      return {
        batchId,
        members,
        createdAt: members[0]?.createdAt ?? '',
        running: members.length - done.length,
        passed: done.filter((r) => r.verdict === 'passed').length,
        partial: done.filter((r) => r.verdict === 'partial').length,
        failed: done.filter((r) => r.verdict === 'failed').length,
      }
    })
    return [...batchGroups.map((g) => ({ type: 'batch' as const, ...g })), ...singles.map((run) => ({ type: 'single' as const, run }))]
      .sort((a, b) => {
        const at = a.type === 'batch' ? a.createdAt : a.run.createdAt
        const bt = b.type === 'batch' ? b.createdAt : b.run.createdAt
        return bt.localeCompare(at)
      })
  }, [runs])

  return (
    <div>
      <div className="at-stat-row">
        <div className="at-stat-card">
          <div className="at-stat-label">今日运行</div>
          <div className="at-stat-value at-num">{stats.todayCount}</div>
        </div>
        <div className="at-stat-card">
          <div className="at-stat-label">通过率</div>
          <div className="at-stat-value at-num">{stats.passRate}%</div>
        </div>
        <div className="at-stat-card">
          <div className="at-stat-label">平均耗时</div>
          <div className="at-stat-value at-num">{stats.avgSeconds}<small style={{ fontSize: 12, color: 'var(--color-muted)' }}>s</small></div>
        </div>
        <div className="at-stat-card">
          <div className="at-stat-label">待人工补执行</div>
          <div className="at-stat-value at-num" style={{ color: 'oklch(0.6 0.14 75)' }}>{stats.manualPending}</div>
        </div>
      </div>

      <div className="at-toolbar">
        <div className="at-spacer" />
        <button className="at-btn" onClick={() => void refresh()}><RotateCw size={13} />刷新</button>
      </div>

      <div className="at-card at-table-wrap">
        <table className="at-table">
          <thead>
            <tr>
              <th>运行</th>
              <th>用例</th>
              <th>环境</th>
              <th>结果</th>
              <th>耗时</th>
              <th>引擎</th>
              <th>时间</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="at-muted" style={{ textAlign: 'center', padding: 28 }}>加载中…</td></tr>}
            {!loading && error && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--color-danger)' }}>{error}</td></tr>}
            {!loading && !error && groups.length === 0 && (
              <tr><td colSpan={8} className="at-muted" style={{ textAlign: 'center', padding: 28 }}>还没有运行记录 — 到「用例管理」执行一条试试</td></tr>
            )}
            {groups.map((group) => {
              if (group.type === 'single') {
                return (
                  <RunRow
                    key={group.run.id}
                    run={group.run}
                    expanded={expanded === group.run.id}
                    onToggle={() => setExpanded(expanded === group.run.id ? null : group.run.id)}
                    projectId={projectId}
                  />
                )
              }
              return (
                <Fragment key={group.batchId}>
                  <tr style={{ background: 'var(--color-surface-2)' }}>
                    <td colSpan={8}>
                      <span className="at-badge at-badge-blue">套件批次</span>{' '}
                      <b className="at-num">#{group.batchId.slice(0, 8)}</b>
                      <span className="at-small" style={{ marginLeft: 10 }}>
                        共 {group.members.length} 条：
                        <span style={{ color: 'var(--color-success)' }}> ✓ {group.passed}</span>
                        <span style={{ color: 'oklch(0.6 0.14 75)' }}> ◐ {group.partial}</span>
                        <span style={{ color: 'var(--color-danger)' }}> ✗ {group.failed}</span>
                        {group.running > 0 && <span className="at-muted"> · {group.running} 进行中</span>}
                      </span>
                      <span className="at-muted at-small" style={{ marginLeft: 10 }}>
                        {new Date(group.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                  </tr>
                  {group.members.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      expanded={expanded === run.id}
                      onToggle={() => setExpanded(expanded === run.id ? null : run.id)}
                      projectId={projectId}
                    />
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
