/** 运行详情页（P4）：通过率环 + AI 根因摘要 + Copy Fix Prompt + 报告链接 + List/Map 双视图（Agent Action View）。 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, ExternalLink, FolderPlus, Map as MapIcon, RefreshCw, Sparkles, Table2 } from 'lucide-react'
import {
  automationRunReportUrl,
  createTestListFromRun,
  generateRunRootCause,
  getAutomationRun,
  getRunFrames,
  getRunPageMap,
  type PageMap,
  type PageMapEdge,
  type PageMapNode,
  type RunFrameInfo,
  type RunRecord,
} from '../../lib/automation-api'
import { loadActiveAiConfigSelection } from '../../lib/active-ai-config'

const VERDICT_LABEL: Record<NonNullable<RunRecord['verdict']>, string> = {
  passed: '通过',
  partial: '部分通过',
  failed: '失败',
  aborted: '已中止',
}

const STEP_STATUS_MARK: Record<string, { glyph: string; color: string; label: string }> = {
  passed: { glyph: '✓', color: 'var(--color-success)', label: '通过' },
  failed: { glyph: '✗', color: 'var(--color-danger)', label: '失败' },
  skipped: { glyph: '○', color: 'var(--color-muted, #999)', label: '跳过' },
  'skipped-manual': { glyph: '◐', color: 'oklch(0.6 0.14 75)', label: '人工项' },
}

const FRAME_PHASE_LABEL: Record<RunFrameInfo['phase'], string> = {
  decision: '决策',
  action: '动作',
  failed: '失败现场',
}

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

function PassRateRing({ passed, total }: { passed: number; total: number }) {
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0
  const r = 42
  const circumference = 2 * Math.PI * r
  const color = pct === 100 ? 'var(--color-success)' : pct > 0 ? 'oklch(0.7 0.15 80)' : 'var(--color-danger)'
  return (
    <svg className="at-ring" viewBox="0 0 100 100" role="img" aria-label={`步骤通过率 ${pct}%`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-border, #ddd)" strokeWidth="9" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeDasharray={`${(circumference * pct) / 100} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="56" textAnchor="middle" fontSize="21" fontWeight="700" fill="currentColor">
        {pct}%
      </text>
    </svg>
  )
}

function StepStatusMark({ status }: { status: string }) {
  const mark = STEP_STATUS_MARK[status] ?? { glyph: '?', color: 'currentColor', label: status }
  return (
    <span className="at-small" style={{ color: mark.color }} title={mark.label}>
      {mark.glyph} {mark.label}
    </span>
  )
}

/** 站点图布局：BFS 分层（首访节点为根），同层纵向排列。 */
type PlacedNode = PageMapNode & { x: number; y: number }

function layoutPageMap(pageMap: PageMap): { placed: PlacedNode[]; edges: PageMapEdge[]; width: number; height: number } {
  const NODE_W = 210
  const NODE_H = 62
  const COL_GAP = 70
  const ROW_GAP = 26
  const byUrl = new Map(pageMap.nodes.map((n) => [n.url, n]))
  const depth = new Map<string, number>()
  const ordered = [...pageMap.nodes].sort((a, b) => a.firstAt.localeCompare(b.firstAt))
  const root = ordered[0]
  if (root) {
    depth.set(root.url, 0)
    let frontier = [root.url]
    let d = 0
    while (frontier.length > 0 && depth.size < byUrl.size) {
      d += 1
      const next: string[] = []
      for (const url of frontier) {
        for (const edge of pageMap.edges) {
          if (edge.from === url && byUrl.has(edge.to) && !depth.has(edge.to)) {
            depth.set(edge.to, d)
            next.push(edge.to)
          }
        }
      }
      frontier = next
    }
  }
  let extraDepth = Math.max(0, ...depth.values()) + 1
  for (const node of ordered) {
    if (!depth.has(node.url)) depth.set(node.url, extraDepth++)
  }

  const rowsPerDepth = new Map<number, number>()
  const placed: PlacedNode[] = ordered.map((node) => {
    const d = depth.get(node.url) ?? 0
    const row = rowsPerDepth.get(d) ?? 0
    rowsPerDepth.set(d, row + 1)
    return { ...node, x: d * (NODE_W + COL_GAP), y: row * (NODE_H + ROW_GAP) }
  })
  const width = Math.max(1, ...placed.map((n) => n.x + NODE_W))
  const height = Math.max(1, ...placed.map((n) => n.y + NODE_H))
  return { placed, edges: pageMap.edges, width, height }
}

function AgentActionMap({
  pageMap,
  selectedUrl,
  onSelect,
}: {
  pageMap: PageMap
  selectedUrl: string | null
  onSelect: (node: PageMapNode) => void
}) {
  const { placed, edges, width, height } = useMemo(() => layoutPageMap(pageMap), [pageMap])
  const pos = new Map(placed.map((n) => [n.url, n]))
  return (
    <div className="at-map-wrap">
      <svg width={width + 40} height={height + 40} viewBox={`-20 -20 ${width + 40} ${height + 40}`} role="img" aria-label="Agent Action View 站点地图">
        <defs>
          <marker id="at-map-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--color-muted, #888)" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = pos.get(edge.from)
          const to = pos.get(edge.to)
          if (!from || !to) return null
          const x1 = from.x + 210
          const y1 = from.y + 31
          const x2 = to.x
          const y2 = to.y + 31
          const midX = (x1 + x2) / 2
          return (
            <g key={`${edge.from}->${edge.to}`}>
              <path
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                fill="none"
                stroke="var(--color-muted, #888)"
                strokeWidth="1.5"
                strokeDasharray={edge.count > 1 ? '' : '4 3'}
                markerEnd="url(#at-map-arrow)"
              />
              {edge.count > 1 && (
                <text x={midX} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontSize="11" fill="var(--color-muted, #888)">
                  ×{edge.count}
                </text>
              )}
            </g>
          )
        })}
        {placed.map((node) => (
          <g
            key={node.url}
            transform={`translate(${node.x},${node.y})`}
            className={`at-map-node${node.failed ? ' is-failed' : ''}${selectedUrl === node.url ? ' is-selected' : ''}`}
            onClick={() => onSelect(node)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(node)
            }}
          >
            <rect width="210" height="62" rx="10" className="at-map-node-bg" />
            <text x="12" y="24" fontSize="12" fontWeight="600" className="at-map-node-label">
              {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
            </text>
            <text x="12" y="45" fontSize="11" className="at-map-node-meta">
              触点 {node.touches} · {node.frameCount > 0 ? `${node.frameCount} 帧` : '无逐帧'}
              {node.failed ? ' · 失败热点' : ''}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function FrameStrip({ frames }: { frames: RunFrameInfo[] }) {
  if (frames.length === 0) {
    return <p className="at-muted at-small">该页面没有逐帧快照（视觉引擎运行请看回放报告）。</p>
  }
  return (
    <div className="at-frame-strip">
      {frames.map((frame, index) => (
        <figure key={`${frame.at}-${index}`} className="at-frame-card">
          {frame.screenshot ? (
            <img src={frame.screenshot} alt={`步骤 ${frame.stepId} ${FRAME_PHASE_LABEL[frame.phase]}`} loading="lazy" />
          ) : (
            <div className="at-frame-empty">无截图</div>
          )}
          <figcaption className="at-small">
            步骤 {frame.stepId} · {FRAME_PHASE_LABEL[frame.phase]}
            {frame.targetLabel ? ` · ${frame.targetLabel}` : ''}
            {frame.durationMs ? ` · ${frame.durationMs}ms` : ''}
            {frame.reason ? <em className="at-muted" style={{ display: 'block' }}>{frame.reason}</em> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

export function RunDetailView() {
  const { projectId = '', runId = '' } = useParams<{ projectId: string; runId: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<RunRecord | null>(null)
  const [pageMap, setPageMap] = useState<PageMap | null>(null)
  const [view, setView] = useState<'list' | 'map'>('list')
  const [selectedNode, setSelectedNode] = useState<PageMapNode | null>(null)
  const [frames, setFrames] = useState<RunFrameInfo[] | null>(null)
  const [causeBusy, setCauseBusy] = useState(false)
  const [listBusy, setListBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([getAutomationRun(runId), getRunPageMap(runId)])
      .then(([runRecord, map]) => {
        if (cancelled) return
        setRun(runRecord)
        setPageMap(map)
        setView(map.available ? 'map' : 'list')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [runId])

  const selectNode = useCallback(
    (node: PageMapNode) => {
      setSelectedNode(node)
      setFrames(null)
      if (node.frameCount > 0) {
        getRunFrames(runId, node.url)
          .then(setFrames)
          .catch(() => setFrames([]))
      } else {
        setFrames([])
      }
    },
    [runId],
  )

  const handleGenerate = useCallback(async () => {
    setCauseBusy(true)
    setError(null)
    try {
      const selection = await loadActiveAiConfigSelection()
      if (!selection) {
        setError('未配置可用的 AI 模型，无法生成根因')
        return
      }
      const rootCause = await generateRunRootCause(runId, selection.payload)
      setRun((prev) => (prev ? { ...prev, rootCause } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCauseBusy(false)
    }
  }, [runId])

  const copyFixPrompt = useCallback(() => {
    if (!run?.rootCause) return
    void navigator.clipboard.writeText(run.rootCause.fixPrompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [run])

  const stepStats = useMemo(() => {
    const auto = (run?.stepResults ?? []).filter((s) => s.status === 'passed' || s.status === 'failed')
    return { passed: auto.filter((s) => s.status === 'passed').length, total: auto.length }
  }, [run])

  /** Make a list from last run：本次运行（批次则整组）的用例收进新 Test List 并跳转。 */
  async function onMakeList() {
    if (!run) return
    setListBusy(true)
    setError(null)
    try {
      const created = await createTestListFromRun(run.id)
      navigate(`/automation/lists?select=${encodeURIComponent(created.id)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '建列表失败')
    } finally {
      setListBusy(false)
    }
  }

  if (error && !run) {
    return (
      <div className="at-page">
        <p className="at-note" style={{ color: 'var(--color-danger)' }}>{error}</p>
        <Link className="at-btn" to={`/automation/p/${projectId}/runs`}>
          <ArrowLeft size={14} />返回运行列表
        </Link>
      </div>
    )
  }
  if (!run) {
    return <div className="at-page"><p className="at-muted">加载中…</p></div>
  }

  return (
    <div className="at-page">
      <div className="at-run-head">
        <Link className="at-btn at-btn-sm" to={`/automation/p/${projectId}/runs`}>
          <ArrowLeft size={13} />运行
        </Link>
        <h2 style={{ margin: 0 }}>
          <span className="at-num">{run.caseNo}</span> · {run.title}
        </h2>
        <span className={`at-badge ${run.verdict === 'passed' ? 'at-badge-green' : run.verdict === 'partial' ? 'at-badge-amber' : 'at-badge-red'}`}>
          {run.verdict ? VERDICT_LABEL[run.verdict] : run.status}
        </span>
        <div className="at-spacer" />
        {run.reportFile && (
          <a className="at-btn at-btn-sm" href={automationRunReportUrl(run.id)} target="_blank" rel="noreferrer">
            <ExternalLink size={13} />回放报告
          </a>
        )}
        <button
          className="at-btn at-btn-sm"
          onClick={() => void onMakeList()}
          disabled={listBusy}
          title="把本次运行（批次则整组）的用例收进 Test List"
        >
          <FolderPlus size={13} />{listBusy ? '创建中…' : '从本次运行建列表'}
        </button>
      </div>

      <div className="at-card at-run-summary">
        <PassRateRing passed={stepStats.passed} total={stepStats.total} />
        <div className="at-run-meta">
          <div>自动步骤通过 <b>{stepStats.passed}</b> / {stepStats.total}</div>
          <div className="at-muted at-small">
            引擎 {run.engine === 'auto' ? '极速优先' : '纯视觉'} · 时长 {formatDuration(run.durationMs)} · 视口 {run.viewport ?? '—'}
            {run.runGroupId ? ` · 批次 #${run.runGroupId.slice(0, 8)}` : ''}
          </div>
          <div className="at-muted at-small">
            开始 {run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN') : '—'} · 入口 {run.entryUrl || '—'}
          </div>
          {run.error && <div className="at-small" style={{ color: 'var(--color-danger)' }}>{run.error}</div>}
        </div>
      </div>

      {error && <p className="at-note" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {run.verdict === 'failed' && (
        <div className="at-card at-cause-card">
          <div className="at-cause-head">
            <Sparkles size={16} />
            <b>AI 根因</b>
            <div className="at-spacer" />
            {run.rootCause && (
              <button className="at-btn at-btn-sm" onClick={copyFixPrompt}>
                <Copy size={13} />{copied ? '已复制' : 'Copy Fix Prompt'}
              </button>
            )}
            <button className="at-btn at-btn-sm" disabled={causeBusy} onClick={() => void handleGenerate()}>
              <RefreshCw size={13} />{causeBusy ? '生成中…' : run.rootCause ? '重新生成' : '生成根因'}
            </button>
          </div>
          {run.rootCause ? (
            <>
              <p style={{ margin: '8px 0' }}>{run.rootCause.summary}</p>
              <details>
                <summary className="at-small at-muted">Fix Prompt（{run.rootCause.fixPrompt.length} 字，复制后交给开发者或 AI 编码助手）</summary>
                <pre className="at-drawer-code" style={{ marginTop: 8 }}>{run.rootCause.fixPrompt}</pre>
              </details>
              <p className="at-small at-muted" style={{ margin: '6px 0 0' }}>
                生成于 {new Date(run.rootCause.generatedAt).toLocaleString('zh-CN')}
              </p>
            </>
          ) : (
            <p className="at-muted at-small" style={{ margin: '8px 0 0' }}>
              尚未生成。点击「生成根因」对失败步骤调用 AI 分析（需要已配置的 AI 模型）。
            </p>
          )}
        </div>
      )}

      <div className="at-tabs" role="tablist" aria-label="结果视图">
        <button role="tab" aria-selected={view === 'map'} className={`at-tab ${view === 'map' ? 'is-active' : ''}`} onClick={() => setView('map')}>
          <MapIcon size={14} />Map · Agent Action View
        </button>
        <button role="tab" aria-selected={view === 'list'} className={`at-tab ${view === 'list' ? 'is-active' : ''}`} onClick={() => setView('list')}>
          <Table2 size={14} />List · 步骤明细
        </button>
      </div>

      {view === 'list' && (
        <div className="at-card at-table-wrap">
          <table className="at-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th style={{ width: 80 }}>类型</th>
                <th>步骤</th>
                <th style={{ width: 110 }}>结果</th>
                <th style={{ width: 90 }}>耗时</th>
              </tr>
            </thead>
            <tbody>
              {run.stepResults.map((step, index) => (
                <tr key={`${step.stepId}-${index}`}>
                  <td className="at-num">{step.stepId}</td>
                  <td>{step.type}</td>
                  <td>
                    {step.text}
                    {step.error && <div className="at-small" style={{ color: 'var(--color-danger)' }}>{step.error}</div>}
                    {step.extractedValue !== undefined && <div className="at-small at-muted">提取：{step.extractedValue}</div>}
                  </td>
                  <td><StepStatusMark status={step.status} /></td>
                  <td className="at-num">{step.durationMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'map' && (
        <div className="at-card">
          {pageMap?.available ? (
            <>
              <AgentActionMap pageMap={pageMap} selectedUrl={selectedNode?.url ?? null} onSelect={selectNode} />
              {selectedNode && (
                <div className="at-node-panel">
                  <div className="at-cause-head">
                    <b>{selectedNode.label}</b>
                    <span className="at-small at-muted">
                      触点 {selectedNode.touches} · 帧 {selectedNode.frameCount}
                      {selectedNode.failed ? ' · 失败热点' : ''}
                    </span>
                  </div>
                  <FrameStrip frames={frames ?? []} />
                </div>
              )}
            </>
          ) : (
            <div className="at-empty">
              <MapIcon size={28} />
              <div>该运行没有页面轨迹数据</div>
              <div className="at-small at-muted">老数据或全程视觉引擎运行没有逐帧轨迹，可查看回放报告</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
