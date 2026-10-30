import { MonitorWizard, ReportPanel } from './LoadTestMonitoring'
import { LoadTestOptions } from './LoadTestOptions'
import { LoadTestScriptEditor } from './LoadTestScriptEditor'
import { loadActiveAiConfigSelection } from '../lib/active-ai-config'
import { readOptions } from '../features/loadtest/options-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Play, Square, Trash2, Plus } from 'lucide-react'
import {
  getProject,
  getRun,
  listRuns,
  startRun,
  stopRun,
  streamRunEvents,
  updateProject,
  generateLoadTestDraft,
  type LoadTestProject,
  type LoadTestRunStatus,
  type LoadTestRunSummary,
} from '../features/loadtest/loadtest-api'

type Tab = 'config' | 'run' | 'history'

const STATUS_LABEL: Record<LoadTestRunStatus, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  stopped: '已停止',
}

const STATUS_CLASS: Record<LoadTestRunStatus, string> = {
  queued: 'bg-amber-100 text-amber-700',
  running: 'bg-blue-100 text-blue-700',
  succeeded: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  stopped: 'bg-gray-200 text-gray-600',
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

/** 从 STAGES（如 "30s:10,60s:30,30s:0"）估算峰值并发 */
function peakVusFromStages(stages: string | undefined): number | null {
  if (!stages) return null
  const targets = stages.split(',').map((part) => Number(part.split(':')[1])).filter((n) => Number.isFinite(n))
  return targets.length > 0 ? Math.max(...targets) : null
}

function peakVusFromScript(source: string): number | null {
  try {
    const options = readOptions(source).options
    if (typeof options.vus === 'number') return options.vus
    if (!options.scenarios || typeof options.scenarios !== 'object' || Array.isArray(options.scenarios)) return null
    let peak = 0
    for (const value of Object.values(options.scenarios)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const scenario = value as Record<string, unknown>
      let n: number | null = null
      if (['shared-iterations', 'per-vu-iterations', 'constant-vus'].includes(String(scenario.executor))) n = typeof scenario.vus === 'number' ? scenario.vus : 1
      if (['constant-arrival-rate', 'ramping-arrival-rate'].includes(String(scenario.executor))) n = typeof scenario.maxVUs === 'number' ? scenario.maxVUs : typeof scenario.preAllocatedVUs === 'number' ? scenario.preAllocatedVUs : null
      if (scenario.executor === 'ramping-vus') {
        if (!Array.isArray(scenario.stages)) return null
        const targets = scenario.stages.map(stage => stage && typeof stage === 'object' && 'target' in stage ? Number(stage.target) : NaN)
        if (targets.some(n => !Number.isFinite(n))) return null
        n = Math.max(typeof scenario.startVUs === 'number' ? scenario.startVUs : 1, ...targets)
      }
      if (n === null) return null
      peak += n
    }
    return peak
  } catch { return null }
}

export function LoadTestWorkspacePage() {
  const { id = '' } = useParams()
  const [project, setProject] = useState<LoadTestProject | null>(null)
  const [tab, setTab] = useState<Tab>('config')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    getProject(id)
      .then((found) => {
        setProject(found)
        setError('')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载失败'))
  }, [id])

  if (!project) {
    return <div className="mx-auto max-w-shell px-6 py-16 text-center text-sm text-muted">{error || '加载中…'}</div>
  }

  return (
    <div className="mx-auto max-w-shell px-6 py-8 max-lg:px-4">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/loadtest" className="rounded-lg p-2 text-muted transition hover:bg-white/70" aria-label="返回列表">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-fg">{project.name}</h1>
            <p className="text-xs text-muted">{project.targetBaseUrl}</p>
          </div>
        </div>
        <nav className="flex rounded-xl border border-border bg-white/70 p-1">
          {([['config', '配置'], ['run', '运行'], ['history', '历史']] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                tab === key ? 'bg-accent text-white shadow' : 'text-muted hover:text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {error && <div className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div hidden={tab !== 'config'}>
        <ConfigTab
          project={project}
          onSaved={(saved) => { setProject(saved); setNotice('已保存'); setTimeout(() => setNotice(''), 2500) }}
          onError={setError}
        />
      </div>
      {tab === 'run' && <RunTab key={project.id + project.updatedAt} project={project} onError={setError} />}
      {tab === 'history' && <HistoryTab projectId={project.id} onError={setError} />}
    </div>
  )
}

// ── 配置页签 ────────────────────────────────────────────────────────────────

function ConfigTab({
  project,
  onSaved,
  onError,
}: {
  project: LoadTestProject
  onSaved: (p: LoadTestProject) => void
  onError: (message: string) => void
}) {
  const [form, setForm] = useState({
    name: project.name,
    description: project.description,
    targetBaseUrl: project.targetBaseUrl,
    scriptSource: project.scriptSource,
    payloadTemplate: project.payloadTemplate ?? '',
  })
  const [envRows, setEnvRows] = useState<[string, string][]>(Object.entries(project.envVars))
  const [saving, setSaving] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState('')
  const [scriptNotice, setScriptNotice] = useState('')

  const generateDraft = async () => {
    setDrafting(true)
    try {
      if (!draftPrompt.trim()) throw new Error('请输入压测需求')
      const config = await loadActiveAiConfigSelection()
      if (!config) throw new Error('请先在设置中配置并选择 AI 模型')
      setDraft(await generateLoadTestDraft(draftPrompt.trim(), form.targetBaseUrl.trim(), config.payload))
    } catch (err) { onError(err instanceof Error ? err.message : '脚本生成失败') } finally { setDrafting(false) }
  }

  const save = async () => {
    setSaving(true)
    try {
      const envVars: Record<string, string> = {}
      for (const [key, value] of envRows) {
        if (key.trim()) envVars[key.trim()] = value
      }
      const saved = await updateProject(project.id, {
        name: form.name.trim(),
        description: form.description.trim(),
        targetBaseUrl: form.targetBaseUrl.trim(),
        scriptSource: form.scriptSource,
        payloadTemplate: form.payloadTemplate.trim() ? form.payloadTemplate : null,
        envVars,
      })
      onSaved(saved)
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent'

  return (
    <div className="grid gap-5">
      <MonitorWizard />
      <section className="rounded-2xl border border-border bg-white/80 p-5">
        <h2 className="mb-4 text-sm font-semibold text-fg">基本信息</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted">项目名称</span>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted">目标地址</span>
            <input className={inputCls} value={form.targetBaseUrl} onChange={(e) => setForm({ ...form, targetBaseUrl: e.target.value })} />
          </label>
          <label className="grid gap-1.5 text-sm md:col-span-2">
            <span className="text-muted">描述</span>
            <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-white/80 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">环境变量 <span className="ml-1 font-normal text-muted">（API_BASE / STAGES / 阈值等，注入 k6 进程）</span></h2>
          <button
            type="button"
            onClick={() => setEnvRows([...envRows, ['', '']])}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" /> 添加
          </button>
        </div>
        <div className="grid gap-2">
          {envRows.map(([key, value], index) => (
            <div key={index} className="flex gap-2">
              <input
                className={`${inputCls} w-56 font-mono`}
                placeholder="KEY"
                value={key}
                onChange={(e) => setEnvRows(envRows.map((row, i) => (i === index ? [e.target.value, row[1]] : row)))}
              />
              <input
                className={`${inputCls} flex-1 font-mono`}
                placeholder="value"
                value={value}
                onChange={(e) => setEnvRows(envRows.map((row, i) => (i === index ? [row[0], e.target.value] : row)))}
              />
              <button
                type="button"
                aria-label="删除变量"
                onClick={() => setEnvRows(envRows.filter((_, i) => i !== index))}
                className="rounded-lg p-2 text-muted hover:bg-danger-bg hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {envRows.length === 0 && <p className="text-xs text-muted">暂无环境变量。</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-white/80 p-5">
        <h2 className="mb-2 text-sm font-semibold text-fg">请求体模板 <span className="ml-1 font-normal text-muted">（可选，JSON；注入为 PAYLOAD_FILE）</span></h2>
        <textarea
          className={`${inputCls} h-32 font-mono text-xs`}
          value={form.payloadTemplate}
          onChange={(e) => setForm({ ...form, payloadTemplate: e.target.value })}
          placeholder='{"key": "value"}'
          spellCheck={false}
        />
      </section>

      <LoadTestOptions source={form.scriptSource} onChange={scriptSource => {setForm(f => ({...f, scriptSource})); setScriptNotice('参数已写回源码；后续源码编辑以最后一次修改为准。')}} />
      <section className="rounded-2xl border border-border bg-white/80 p-5">
        <h2 className="mb-2 text-sm font-semibold text-fg">AI 生成脚本草稿</h2><p className="text-xs text-muted">描述测试目标、请求与负载模型。生成内容先预览，应用后仍需保存。</p>
        <textarea aria-label="压测需求" className={`${inputCls} mt-3 h-24`} value={draftPrompt} onChange={e => setDraftPrompt(e.target.value)} placeholder="例如：对目标地址发起 GET，2 VU 持续 30 秒，检查状态码" />
        <button type="button" className="mt-2 rounded-lg border border-border px-3 py-2 text-sm" disabled={drafting} onClick={() => void generateDraft()}>{drafting ? '生成中…' : '生成草稿'}</button>
        {draft && <div className="mt-3"><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 font-mono text-xs">{draft}</pre><button type="button" className="mt-2 rounded-lg bg-accent px-3 py-2 text-sm text-white" onClick={() => {setForm(f => ({...f, scriptSource: draft})); setScriptNotice('AI 草稿已替换编辑器内容，请检查后保存。'); setDraft('')}}>应用草稿到编辑器</button></div>}
      </section>
      <section className="rounded-2xl border border-border bg-white/80 p-5">
        <h2 className="mb-2 text-sm font-semibold text-fg">k6 脚本</h2>{scriptNotice && <p className="mb-2 text-xs text-amber-700">{scriptNotice}</p>}
        <LoadTestScriptEditor value={form.scriptSource} onChange={scriptSource => {setForm(f => ({...f, scriptSource})); setScriptNotice('源码已修改，参数面板将按最新源码同步。')}} />
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-accent-strong disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存配置'}
        </button>
      </div>
    </div>
  )
}

// ── 运行页签 ────────────────────────────────────────────────────────────────

function RunTab({ project, onError }: { project: LoadTestProject; onError: (message: string) => void }) {
  const [stages, setStages] = useState(project.envVars.STAGES ?? '')
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [status, setStatus] = useState<LoadTestRunStatus | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [summary, setSummary] = useState('')
  const [confirming, setConfirming] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const running = status === 'queued' || status === 'running'
  const peakVus = useMemo(() => peakVusFromScript(project.scriptSource) ?? peakVusFromStages(stages || undefined), [project.scriptSource, stages])

  const attach = useCallback((runId: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    ;(async () => {
      try {
        for await (const event of streamRunEvents(runId, controller.signal)) {
          if (event.type === 'log') {
            setLogs((prev) => [...prev.slice(-800), event.line])
          } else if (event.type === 'status') {
            setStatus(event.status)
          } else if (event.type === 'summary') {
            setSummary(event.text)
          }
        }
      } catch {
        // 中断（含主动 abort）时静默
      }
    })()
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const launch = async () => {
    try {
      const env: Record<string, string> = {}
      if (stages.trim()) env.STAGES = stages.trim()
      const run = await startRun(project.id, env)
      setCurrentRunId(run.id)
      setLogs([])
      setSummary('')
      setStatus('queued')
      setConfirming(false)
      attach(run.id)
    } catch (err) {
      onError(err instanceof Error ? err.message : '启动失败')
      setConfirming(false)
    }
  }

  const stop = async () => {
    if (!currentRunId) return
    try {
      await stopRun(currentRunId)
    } catch (err) {
      onError(err instanceof Error ? err.message : '停止失败')
    }
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-2xl border border-border bg-white/80 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="grid min-w-72 flex-1 gap-1.5 text-sm">
            <span className="text-muted">本次覆盖 STAGES（留空用项目配置）</span>
            <input
              className="rounded-lg border border-border bg-white px-3 py-2 font-mono text-sm outline-none focus:border-accent"
              value={stages}
              onChange={(e) => setStages(e.target.value)}
              placeholder="30s:10,60s:30,30s:0"
              disabled={running}
            />
          </label>
          {running ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="flex items-center gap-2 rounded-xl bg-danger px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              <Square className="h-4 w-4" /> 停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-accent-strong"
            >
              <Play className="h-4 w-4" /> 开始压测
            </button>
          )}
        </div>
        {status && (
          <div className="mt-4 flex items-center gap-3 text-sm">
            <span className="text-muted">当前执行状态：</span>
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
            {currentRunId && <span className="font-mono text-xs text-muted">{currentRunId}</span>}
          </div>
        )}
      </section>

      {currentRunId && <ReportPanel runId={currentRunId} live />}
      <section className="rounded-2xl border border-border bg-white/80 p-5">
        <h2 className="mb-2 text-sm font-semibold text-fg">执行日志</h2>
        <div ref={logRef} className="h-80 overflow-y-auto rounded-xl bg-[oklch(0.19_0.02_262)] p-4 font-mono text-xs leading-5 text-emerald-100/90">
          {logs.length === 0 ? (
            <p className="text-white/40">（尚无日志。点击「开始压测」后此处实时输出 k6 日志。）</p>
          ) : (
            logs.map((line, index) => <div key={index} className="whitespace-pre-wrap break-all">{line}</div>)
          )}
        </div>
      </section>

      {summary && (
        <section className="rounded-2xl border border-border bg-white/80 p-5">
          <h2 className="mb-2 text-sm font-semibold text-fg">k6 结果摘要</h2>
          <pre className="overflow-x-auto rounded-xl bg-bg p-4 font-mono text-xs leading-6 text-fg">{summary}</pre>
        </section>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-3 text-lg font-semibold text-fg">确认发起压测</h2>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">目标地址</dt><dd className="max-w-64 truncate font-mono text-fg">{project.targetBaseUrl}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">峰值并发</dt><dd className="font-semibold text-fg">{peakVus !== null ? `最多约 ${peakVus} VU` : '未知（请检查脚本）'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">压测来源</dt><dd className="text-fg">本机</dd></div>
            </dl>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">请确认目标环境允许本次压测，且峰值并发在预期范围内。</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-bg">取消</button>
              <button type="button" onClick={() => void launch()} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-strong">确认执行</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 历史页签 ────────────────────────────────────────────────────────────────

function HistoryTab({ projectId, onError }: { projectId: string; onError: (message: string) => void }) {
  const [runs, setRuns] = useState<LoadTestRunSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ summaryText: string | null; logTail: string } | null>(null)

  useEffect(() => {
    listRuns(projectId).then(setRuns).catch((err) => onError(err instanceof Error ? err.message : '加载失败'))
  }, [projectId, onError])

  const openDetail = async (runId: string) => {
    setSelected(runId)
    try {
      const run = await getRun(runId)
      setDetail({ summaryText: run.summaryText, logTail: run.logTail })
    } catch (err) {
      onError(err instanceof Error ? err.message : '读取失败')
    }
  }

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-2xl border border-border bg-white/80">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-5 py-3 font-medium">执行 ID</th>
              <th className="px-5 py-3 font-medium">状态</th>
              <th className="px-5 py-3 font-medium">退出码</th>
              <th className="px-5 py-3 font-medium">开始时间</th>
              <th className="px-5 py-3 font-medium">结束时间</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                onClick={() => void openDetail(run.id)}
                className="cursor-pointer border-b border-border/60 transition hover:bg-accent-soft/40"
              >
                <td className="px-5 py-3 font-mono text-xs">{run.id.slice(0, 18)}…</td>
                <td className="px-5 py-3"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[run.status]}`}>{STATUS_LABEL[run.status]}</span></td>
                <td className="px-5 py-3 font-mono text-xs">{run.exitCode ?? '—'}</td>
                <td className="px-5 py-3 text-xs text-muted">{formatTime(run.startedAt)}</td>
                <td className="px-5 py-3 text-xs text-muted">{formatTime(run.endedAt)}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-muted">还没有执行记录，到「运行」页签发起一次。</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {selected && <ReportPanel key={selected} runId={selected} />}
      {selected && detail && (
        <section className="rounded-2xl border border-border bg-white/80 p-5">
          <h2 className="mb-2 text-sm font-semibold text-fg">执行详情 <span className="font-mono text-xs font-normal text-muted">{selected}</span></h2>
          {detail.summaryText ? (
            <pre className="mb-3 overflow-x-auto rounded-xl bg-bg p-4 font-mono text-xs leading-6 text-fg">{detail.summaryText}</pre>
          ) : (
            <p className="mb-3 text-xs text-muted">（无摘要）</p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-accent">查看日志尾部</summary>
            <pre className="mt-2 max-h-64 overflow-y-auto rounded-xl bg-[oklch(0.19_0.02_262)] p-4 font-mono text-xs leading-5 text-emerald-100/90">{detail.logTail || '（空）'}</pre>
          </details>
        </section>
      )}
    </div>
  )
}
