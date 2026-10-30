/** 探源页（P2）：发起站点探索 → 步进进度 + 直播画面 + Live log → 捕获页面网格 + 历史记录。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, Globe, Loader2, Play, Square, Trash2 } from 'lucide-react'
import {
  abortExplore,
  deleteExploreSource,
  exploreScreenshotUrl,
  getExploreSource,
  listCapturedPages,
  listExploreSources,
  startExplore,
  subscribeExploreEvents,
  type CapturedPage,
  type ExploreEvent,
  type ExploreSource,
} from '../../lib/automation-api'
import { loadActiveAiConfigSelection } from '../../lib/active-ai-config'

const STATUS_LABEL: Record<ExploreSource['status'], { text: string; className: string }> = {
  running: { text: '探索中', className: 'at-badge at-badge-blue' },
  done: { text: '完成', className: 'at-badge at-badge-green' },
  failed: { text: '失败', className: 'at-badge at-badge-red' },
  aborted: { text: '已中止', className: 'at-badge' },
}

const MAX_PAGES_OPTIONS = [10, 25, 50]

type LiveLogLine = { level: 'info' | 'warn'; text: string }

function Stepper({ active }: { active: 'login' | 'crawl' | 'done' | 'idle' }) {
  const steps: Array<{ key: string; label: string; state: 'done' | 'active' | 'todo' }> = [
    { key: 'login', label: '登录', state: active === 'idle' ? 'todo' : 'done' },
    {
      key: 'crawl',
      label: '探索',
      state: active === 'crawl' ? 'active' : active === 'done' ? 'done' : 'todo',
    },
    { key: 'plan', label: '规划', state: 'todo' },
  ]
  return (
    <ol className="at-src-step" aria-label="探源步骤">
      {steps.map((s, i) => (
        <li key={s.key} className={`at-src-step-item is-${s.state}`}>
          <span className="at-src-step-dot">{s.state === 'done' ? '✓' : i + 1}</span>
          <span>
            {s.label}
            {s.key === 'plan' && <em className="at-small at-muted">（到「规划」页继续）</em>}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function SourcesView({ projectId, systemUrl }: { projectId: string; systemUrl: string }) {
  const [sources, setSources] = useState<ExploreSource[]>([])
  const [entryUrl, setEntryUrl] = useState(systemUrl)
  const [maxPages, setMaxPages] = useState(25)
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [pages, setPages] = useState<CapturedPage[]>([])
  const [frame, setFrame] = useState<string | null>(null)
  const [logs, setLogs] = useState<LiveLogLine[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [stage, setStage] = useState<'login' | 'crawl' | 'done' | 'idle'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const running = sources.find((s) => s.id === activeSourceId)?.status === 'running'

  const refreshSources = useCallback(async () => {
    try {
      const list = await listExploreSources(projectId)
      setSources(list)
      return list
    } catch {
      setSources([])
      return [] as ExploreSource[]
    }
  }, [projectId])

  const loadPages = useCallback(async (sourceId: string) => {
    try {
      setPages(await listCapturedPages(sourceId))
    } catch {
      setPages([])
    }
  }, [])

  /** 挂上一个探源任务的事件流（新发起或断线重连）。 */
  const attach = useCallback(
    (sourceId: string) => {
      unsubscribeRef.current?.()
      setActiveSourceId(sourceId)
      setFrame(null)
      setLogs([])
      setProgress({ done: 0, total: 0 })
      setStage('crawl')
      void loadPages(sourceId)
      unsubscribeRef.current = subscribeExploreEvents(
        sourceId,
        (event: ExploreEvent) => {
          if (event.kind === 'stage') setStage(event.stage === 'done' ? 'done' : event.stage)
          if (event.kind === 'log') setLogs((prev) => [...prev.slice(-200), { level: event.level, text: event.text }])
          if (event.kind === 'progress') setProgress({ done: event.done, total: event.total })
          if (event.kind === 'frame') setFrame(event.data)
          if (event.kind === 'page') {
            setPages((prev) => [
              ...prev,
              { id: event.page.id, sourceId, url: event.page.url, title: event.page.title, depth: event.page.depth, aiSummary: event.page.aiSummary, elements: [], createdAt: event.at },
            ])
          }
          if (event.kind === 'error') setError(event.message)
          if (event.kind === 'done') {
            setStage('done')
            void refreshSources()
            void loadPages(sourceId)
          }
        },
        (message) => setLogs((prev) => [...prev, { level: 'warn', text: message }]),
      )
    },
    [loadPages, refreshSources],
  )

  // 挂载：拉历史；若有在跑的任务自动接入直播
  useEffect(() => {
    let cancelled = false
    refreshSources().then((list) => {
      if (cancelled) return
      const runningSource = list.find((s) => s.status === 'running')
      if (runningSource) attach(runningSource.id)
    })
    return () => {
      cancelled = true
      unsubscribeRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // 项目信息异步到位后回填入口地址（组件挂载早于 project 加载，初值常为空）
  useEffect(() => {
    if (systemUrl) setEntryUrl((current) => (current.trim() ? current : systemUrl))
  }, [systemUrl])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [logs])

  const start = async () => {
    if (starting || running) return
    // AI 配置可缺省：缺省时服务端跳过页面摘要（捕获照常）
    const aiSelection = await loadActiveAiConfigSelection().catch(() => null)
    const url = entryUrl.trim()
    if (!url) {
      setError('必须填写被测地址')
      return
    }
    setStarting(true)
    setError(null)
    try {
      const source = await startExplore({
        projectId,
        entryUrl: url,
        maxPages,
        aiConfig: aiSelection ? aiSelection.payload : undefined,
      })
      await refreshSources()
      attach(source.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发起探源失败')
    } finally {
      setStarting(false)
    }
  }

  const stop = async () => {
    if (!activeSourceId) return
    try {
      await abortExplore(activeSourceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '中止失败')
    }
  }

  const remove = async (sourceId: string) => {
    try {
      await deleteExploreSource(sourceId)
      if (activeSourceId === sourceId) {
        unsubscribeRef.current?.()
        setActiveSourceId(null)
        setPages([])
      }
      await refreshSources()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const selected = sources.find((s) => s.id === activeSourceId)

  return (
    <div className="at-cards-col">
      <div className="at-card">
        <div className="at-card-head">
          <Globe size={15} />
          <span>站点探索</span>
          <span className="at-small at-muted">agent 自动爬站，捕获页面（截图 + AI 摘要 + 元素清单）</span>
        </div>
        <div className="at-fields" style={{ gridTemplateColumns: 'minmax(0, 2fr) 160px auto', alignItems: 'end' }}>
          <div className="at-field">
            <label htmlFor="at-src-url">被测地址</label>
            <input id="at-src-url" className="at-input" value={entryUrl} onChange={(e) => setEntryUrl(e.target.value)} placeholder="https://www.example.com" />
          </div>
          <div className="at-field">
            <label htmlFor="at-src-max">捕获上限</label>
            <select id="at-src-max" className="at-input" value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))}>
              {MAX_PAGES_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} 页
                </option>
              ))}
            </select>
          </div>
          <div className="at-field">
            {running ? (
              <button className="at-btn at-btn-danger" onClick={() => void stop()}>
                <Square size={13} /> 停止
              </button>
            ) : (
              <button className="at-btn at-btn-primary" disabled={starting} onClick={() => void start()}>
                {starting ? <Loader2 size={13} className="at-spin" /> : <Play size={13} />} 开始探源
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="at-status-banner is-warn" style={{ marginTop: 10 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        <Stepper active={selected ? stage : 'idle'} />
        {selected && (
          <div className="at-src-live">
            <div className="at-src-frame">
              {frame ? <img src={frame} alt="探索直播画面" /> : <div className="at-empty at-small at-muted">{running ? '等待直播帧…' : '探索已结束'}</div>}
              <div className="at-src-frame-bar">
                <span className={`at-badge ${STATUS_LABEL[selected.status].className}`}>{STATUS_LABEL[selected.status].text}</span>
                <span className="at-small at-muted">
                  {progress.done || selected.pageCount} / {progress.total || selected.maxPages} 页
                </span>
              </div>
            </div>
            <div className="at-src-log" aria-label="探索日志">
              {logs.length === 0 && <div className="at-small at-muted">探索日志会显示在这里…</div>}
              {logs.map((line, i) => (
                <div key={i} className={`at-src-log-line is-${line.level}`}>
                  {line.text}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </div>

      <div className="at-card">
        <div className="at-card-head">
          <span>捕获页面{selected ? `（${pages.length}）` : ''}</span>
          {selected && (
            <a className="at-small" href={selected.entryUrl} target="_blank" rel="noreferrer">
              {selected.entryUrl} <ExternalLink size={11} style={{ verticalAlign: -1 }} />
            </a>
          )}
        </div>
        {!selected ? (
          <div className="at-empty at-small at-muted">发起一次探源，或从下方历史记录中选择</div>
        ) : pages.length === 0 ? (
          <div className="at-empty at-small at-muted">{running ? '正在捕获页面…' : '这次探索没有捕获到页面'}</div>
        ) : (
          <div className="at-src-grid">
            {pages.map((p) => (
              <figure key={p.id} className="at-src-card">
                {p.id && !p.id.startsWith('pending') ? (
                  <img className="at-src-shot" src={exploreScreenshotUrl(p.id)} alt={p.title} loading="lazy" />
                ) : (
                  <div className="at-src-shot at-src-shot-empty at-small at-muted">截帧见上方直播</div>
                )}
                <figcaption>
                  <div className="at-src-card-title" title={p.title}>
                    {p.title || p.url}
                  </div>
                  <div className="at-small at-muted at-src-card-url" title={p.url}>
                    {p.url}
                  </div>
                  {p.aiSummary && <p className="at-small at-src-card-sum">{p.aiSummary}</p>}
                  <div className="at-small at-muted">
                    深度 {p.depth}
                    {p.elements.length > 0 && ` · ${p.elements.length} 个可交互元素`}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      {sources.length > 0 && (
        <div className="at-card">
          <div className="at-card-head">
            <span>历史探源</span>
          </div>
          <table className="at-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>入口</th>
                <th>页面</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className={s.id === activeSourceId ? 'is-active' : ''}>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td className="at-src-card-url" title={s.entryUrl}>
                    {s.entryUrl}
                  </td>
                  <td>{s.pageCount} 页</td>
                  <td>
                    <span className={STATUS_LABEL[s.status].className}>{STATUS_LABEL[s.status].text}</span>
                    {s.error && (
                      <span className="at-small" style={{ color: 'var(--color-danger)', marginLeft: 6 }} title={s.error}>
                        {s.error}
                      </span>
                    )}
                  </td>
                  <td>
                    <button className="at-btn at-btn-sm" onClick={() => attach(s.id)}>
                      查看
                    </button>
                    <button className="at-btn at-btn-sm" title="删除这次探索" onClick={() => void remove(s.id)}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
