/** P6 Insights：通过率趋势（status 堆叠柱）+ 引擎/耗时分布（单色系列）+ 失败热点排行。
 *
 * 图表规范（dataviz）：条 ≤24px 厚、数据端 4px 圆角基线端方角、堆叠段间 2px 表面缝、
 * 网格线 1px 实线弱化、文字只用文本色（不穿系列色）、悬停提示 + details 数据表救济、
 * 直标克制（只标极值/排行数值）。status 三色（good/warning/critical + 灰「中止」）相邻
 * 对已过校验（CVD ΔE 11.3 ≥ 8，常态 21.6 ≥ 15）；warning 对比度 <3:1 由标签+表格救济。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { getProjectInsights, type ProjectInsights } from '../../lib/automation-api'

const ENGINE_LABEL: Record<string, string> = { auto: '极速优先', visual: '纯视觉' }

/** 堆叠顺序自底向上：通过 → 部分 → 失败 → 中止。 */
const VERDICT_SEGMENTS = [
  { key: 'passed', label: '通过', color: 'var(--at-viz-good)' },
  { key: 'partial', label: '部分', color: 'var(--at-viz-warning)' },
  { key: 'failed', label: '失败', color: 'var(--at-viz-critical)' },
  { key: 'aborted', label: '中止', color: 'var(--at-viz-neutral)' },
] as const

type TrendPoint = ProjectInsights['trend'][number]
type TipLine = { label: string; value: string; color?: string }
type TooltipState = { x: number; y: number; lines: TipLine[] } | null

function formatDuration(ms?: number | null): string {
  if (ms === null || ms === undefined) return '—'
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

/** y 轴刻度：0..max 取 1/2/5×10ⁿ 步长、≤4 格；数据不顶格（留一格出头给直标/提示）。 */
function niceTicks(max: number): number[] {
  const target = Math.max(1, max)
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => target / s <= 4) ?? 1000
  let top = Math.ceil(target / step) * step
  if (top <= target) top += step
  const ticks: number[] = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  return ticks
}

function VizTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="at-viz-table">
      <summary>数据表</summary>
      <table className="at-table">
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={typeof cell === 'number' ? 'at-num' : ''}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function VizTooltip({ tip }: { tip: TooltipState }) {
  if (!tip) return null
  return (
    <div className="at-viz-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.lines.map((line) => (
        <div key={line.label} className="at-viz-tip-row">
          {line.color && <span className="at-viz-tip-key" style={{ background: line.color }} />}
          <span className="at-viz-tip-label">{line.label}</span>
          <b className="at-viz-tip-value">{line.value}</b>
        </div>
      ))}
    </div>
  )
}

/** 悬停提示定位：横向跟随指针（贴边内收），纵向固定图顶。 */
function useTip() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<TooltipState>(null)
  const show = useCallback((event: React.PointerEvent, lines: TipLine[]) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setTip({ x: Math.min(event.clientX - rect.left + 12, rect.width - 190), y: 8, lines })
  }, [])
  const hide = useCallback(() => setTip(null), [])
  return { wrapRef, tip, show, hide }
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const { wrapRef, tip, show, hide } = useTip()
  const ticks = niceTicks(Math.max(1, ...points.map((p) => p.total)))
  const top = ticks[ticks.length - 1]!
  return (
    <div className="at-viz-chart at-viz-dense" ref={wrapRef} onPointerLeave={hide}>
      <div className="at-viz-legend">
        {VERDICT_SEGMENTS.map((seg) => (
          <span key={seg.key} className="at-viz-legend-item">
            <span className="at-viz-swatch" style={{ background: seg.color }} />{seg.label}
          </span>
        ))}
      </div>
      <div className="at-viz-plot">
        <div className="at-viz-grid">
          {ticks.map((t) => (
            <div key={t} className="at-viz-gridline" style={{ bottom: `${(t / top) * 100}%` }}>
              <span className="at-viz-tick">{t}</span>
            </div>
          ))}
        </div>
        <div className="at-viz-columns">
          {points.map((point) => {
            const topKey = [...VERDICT_SEGMENTS].reverse().find((s) => point[s.key] > 0)?.key
            return (
              <div
                key={point.date}
                className="at-viz-col-hit"
                onPointerMove={(e) =>
                  show(e, [
                    { label: point.date, value: `${point.total} 次` },
                    ...VERDICT_SEGMENTS.map((seg) => ({ label: seg.label, value: String(point[seg.key]), color: seg.color })),
                    { label: '通过率', value: point.total > 0 ? `${Math.round((point.passed / point.total) * 100)}%` : '—' },
                  ])
                }
                aria-label={`${point.date} 共 ${point.total} 次`}
              >
                <div className="at-viz-col">
                  {VERDICT_SEGMENTS.map((seg) =>
                    point[seg.key] > 0 ? (
                      <div
                        key={seg.key}
                        className={`at-viz-seg${seg.key === topKey ? ' is-top' : ''}`}
                        style={{ height: `${(point[seg.key] / top) * 100}%`, background: seg.color }}
                      />
                    ) : null,
                  )}
                </div>
                <span className="at-viz-col-label">{point.date}</span>
              </div>
            )
          })}
        </div>
      </div>
      <VizTooltip tip={tip} />
    </div>
  )
}

function HBarList<T>({
  rows,
  max,
  widthOf,
  labelOf,
  valueOf,
  tipOf,
  barClass,
}: {
  rows: T[]
  max: number
  widthOf: (row: T) => number
  labelOf: (row: T) => string
  valueOf: (row: T) => string
  tipOf: (row: T) => TipLine[]
  barClass: string
}) {
  const { wrapRef, tip, show, hide } = useTip()
  return (
    <div className="at-viz-chart" ref={wrapRef} onPointerLeave={hide}>
      {rows.map((row, index) => (
        <div key={index} className="at-viz-hrow" onPointerMove={(e) => show(e, tipOf(row))}>
          <span className="at-viz-hrow-label">{labelOf(row)}</span>
          <div className="at-viz-hrow-track">
            {max > 0 && widthOf(row) > 0 && (
              <div className={`at-viz-hbar ${barClass}`} style={{ width: `${Math.max((widthOf(row) / max) * 100, 2)}%` }} />
            )}
          </div>
          <span className="at-viz-hrow-value at-num">{valueOf(row)}</span>
        </div>
      ))}
      <VizTooltip tip={tip} />
    </div>
  )
}

function DurationColumns({ buckets }: { buckets: ProjectInsights['durations'] }) {
  const { wrapRef, tip, show, hide } = useTip()
  const ticks = niceTicks(Math.max(1, ...buckets.map((b) => b.count)))
  const top = ticks[ticks.length - 1]!
  const maxLabel = buckets.reduce((a, b) => (b.count > a.count ? b : a), buckets[0]!).label
  return (
    <div className="at-viz-chart" ref={wrapRef} onPointerLeave={hide}>
      <div className="at-viz-plot">
        <div className="at-viz-grid">
          {ticks.map((t) => (
            <div key={t} className="at-viz-gridline" style={{ bottom: `${(t / top) * 100}%` }}>
              <span className="at-viz-tick">{t}</span>
            </div>
          ))}
        </div>
        <div className="at-viz-columns">
          {buckets.map((bucket) => (
            <div
              key={bucket.label}
              className="at-viz-col-hit"
              onPointerMove={(e) => show(e, [{ label: bucket.label, value: `${bucket.count} 次` }])}
              aria-label={`${bucket.label} ${bucket.count} 次`}
            >
              <div className="at-viz-col">
                {bucket.count > 0 && (
                  <div
                    className="at-viz-seg is-top is-single"
                    style={{ height: `${(bucket.count / top) * 100}%`, background: 'var(--at-viz-series)' }}
                  >
                    {bucket.label === maxLabel && (
                      <span className="at-viz-col-cap at-num">{bucket.count}</span>
                    )}
                  </div>
                )}
              </div>
              <span className="at-viz-col-label">{bucket.label}</span>
            </div>
          ))}
        </div>
      </div>
      <VizTooltip tip={tip} />
    </div>
  )
}

export function InsightsView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectInsights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getProjectInsights(projectId)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (loading) return <div className="at-card"><p className="at-muted at-small">加载洞察…</p></div>
  if (error) return <div className="at-card"><p className="at-note" style={{ color: 'var(--color-danger)' }}>{error}</p></div>
  if (!data || data.summary.totalRuns === 0) {
    return (
      <div className="at-card">
        <div className="at-empty">
          <BarChart3 size={28} />
          <div>还没有运行数据</div>
          <div className="at-small at-muted">跑几次用例后，这里会出现通过率趋势、耗时分布与失败热点</div>
        </div>
      </div>
    )
  }

  const { summary, trend, engines, durations, hotspots } = data
  return (
    <div>
      <p className="at-small at-muted" style={{ margin: '4px 2px 12px' }}>
        共 <b className="at-num">{summary.totalRuns}</b> 次运行
        {summary.passRate !== null && (
          <> · 通过率 <b className="at-num">{summary.passRate}%</b>（{summary.finishedRuns} 次有结论）</>
        )}
        {summary.avgDurationMs !== null && (
          <> · 平均耗时 <b className="at-num">{formatDuration(summary.avgDurationMs)}</b></>
        )}
      </p>
      <div className="at-insights-grid">
        <div className="at-card at-viz-card at-viz-span2">
          <h3 className="at-viz-title">通过率趋势（近 14 天）</h3>
          <TrendChart points={trend} />
          <VizTable
            head={['日期', '总数', '通过', '部分', '失败', '中止']}
            rows={trend.map((p) => [p.date, p.total, p.passed, p.partial, p.failed, p.aborted])}
          />
        </div>

        <div className="at-card at-viz-card">
          <h3 className="at-viz-title">引擎分布</h3>
          <HBarList
            rows={engines}
            max={Math.max(1, ...engines.map((e) => e.count))}
            widthOf={(e) => e.count}
            labelOf={(e) => ENGINE_LABEL[e.engine] ?? e.engine}
            valueOf={(e) => `${e.count} 次`}
            tipOf={(e) => [{ label: ENGINE_LABEL[e.engine] ?? e.engine, value: `${e.count} 次` }]}
            barClass="is-series"
          />
          <VizTable head={['引擎', '运行数']} rows={engines.map((e) => [ENGINE_LABEL[e.engine] ?? e.engine, e.count])} />
        </div>

        <div className="at-card at-viz-card">
          <h3 className="at-viz-title">耗时分布</h3>
          <DurationColumns buckets={durations} />
          <VizTable head={['时长区间', '运行数']} rows={durations.map((d) => [d.label, d.count])} />
        </div>

        <div className="at-card at-viz-card at-viz-span2">
          <h3 className="at-viz-title">失败热点排行</h3>
          {hotspots.length === 0 ? (
            <p className="at-muted at-small">暂无失败运行——保持住。</p>
          ) : (
            <>
              <HBarList
                rows={hotspots}
                max={Math.max(1, ...hotspots.map((h) => h.failCount))}
                widthOf={(h) => h.failCount}
                labelOf={(h) => `${h.caseNo} · ${h.title}`}
                valueOf={(h) => `失败 ${h.failCount}/${h.total}`}
                tipOf={(h) => [
                  { label: `${h.caseNo} · ${h.title}`, value: '' },
                  { label: '失败次数', value: `${h.failCount} / ${h.total}` },
                ]}
                barClass="is-critical"
              />
              <VizTable
                head={['编号', '标题', '失败次数', '总次数']}
                rows={hotspots.map((h) => [h.caseNo, h.title, h.failCount, h.total])}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
