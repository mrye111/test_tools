import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Legend,
  Area, AreaChart,
} from 'recharts'
import {
  ArrowLeft, FileText, Layers, AlertTriangle, TrendingUp,
  Shield, CheckCircle2, XCircle, Activity, Flame,
} from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import type {
  ReportData, StatusCount, SeverityCount,
  ModuleBugCount, AssigneeBugCount, DailyTrend,
} from '../data/test-report-types'

// ── 色板（oklch 微调，更沉稳） ──
const C = {
  pass: '#16a34a', fail: '#dc2626', blocked: '#d97706', unexecuted: '#9ca3af',
  fatal: '#b91c1c', critical: '#ea580c', major: '#ca8a04', minor: '#6b7280',
  closed: '#16a34a', resolved: '#2563eb', inProgress: '#d97706', open: '#dc2626',
}

const STATUS_LABELS: Record<string, string> = { pass: '通过', fail: '失败', blocked: '阻塞', unexecuted: '未执行' }
const SEVERITY_LABELS: Record<string, string> = { fatal: '致命', critical: '严重', major: '一般', minor: '轻微' }
const BUG_STATUS_LABELS: Record<string, string> = { closed: '已关闭', resolved: '已解决', in_progress: '处理中', open: '未解决' }

const SEVERITY_COLORS: Record<string, string> = { fatal: C.fatal, critical: C.critical, major: C.major, minor: C.minor }
const BUG_STATUS_COLORS: Record<string, string> = { closed: C.closed, resolved: C.resolved, in_progress: C.inProgress, open: C.open }

// ── 风险等级 ──
function getRiskLevel(fatal: number, critical: number, openBugs: number, passRate: number): {
  label: string; color: string; bg: string; ring: string; icon: typeof Shield
} {
  if (fatal > 0 || passRate < 70) return { label: '高风险', color: 'text-[#dc2626]', bg: 'bg-[#dc2626]/8', ring: 'ring-[#dc2626]/20', icon: Flame }
  if (critical > 3 || openBugs > 10 || passRate < 85) return { label: '中风险', color: 'text-[#d97706]', bg: 'bg-[#d97706]/8', ring: 'ring-[#d97706]/20', icon: AlertTriangle }
  return { label: '低风险', color: 'text-[#16a34a]', bg: 'bg-[#16a34a]/8', ring: 'ring-[#16a34a]/20', icon: Shield }
}

export function ReportViewPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<ReportData | null>(null)

  useEffect(() => {
    const raw = sessionStorage.getItem('test-report-data')
    if (!raw) { navigate('/testreport'); return }
    try { setData(JSON.parse(raw)) } catch { navigate('/testreport') }
  }, [navigate])

  // ── 统计 ──
  const caseStats = useMemo<StatusCount[]>(() => {
    if (!data) return []
    const c: Record<string, number> = { pass: 0, fail: 0, blocked: 0, unexecuted: 0 }
    data.testCases.forEach((t) => { c[t.status] = (c[t.status] || 0) + 1 })
    const colors: Record<string, string> = { pass: C.pass, fail: C.fail, blocked: C.blocked, unexecuted: C.unexecuted }
    return Object.entries(c).map(([k, v]) => ({ status: k, count: v, label: STATUS_LABELS[k], color: colors[k] }))
  }, [data])

  const passRate = useMemo(() => {
    if (!data || !data.testCases.length) return 0
    return Math.round((data.testCases.filter((t) => t.status === 'pass').length / data.testCases.length) * 1000) / 10
  }, [data])

  const bugStatusStats = useMemo(() => {
    if (!data) return []
    const c: Record<string, number> = { closed: 0, resolved: 0, in_progress: 0, open: 0 }
    data.bugs.forEach((b) => { c[b.status] = (c[b.status] || 0) + 1 })
    return Object.entries(c).map(([k, v]) => ({ status: k, count: v, label: BUG_STATUS_LABELS[k], color: BUG_STATUS_COLORS[k] }))
  }, [data])

  const severityStats = useMemo<SeverityCount[]>(() => {
    if (!data) return []
    const c: Record<string, number> = { fatal: 0, critical: 0, major: 0, minor: 0 }
    data.bugs.forEach((b) => { c[b.severity] = (c[b.severity] || 0) + 1 })
    return Object.entries(c).map(([k, v]) => ({ severity: k, count: v, label: SEVERITY_LABELS[k], color: SEVERITY_COLORS[k] }))
  }, [data])

  const moduleBugStats = useMemo<ModuleBugCount[]>(() => {
    if (!data) return []
    const m = new Map<string, ModuleBugCount>()
    data.bugs.forEach((b) => {
      if (!m.has(b.module)) m.set(b.module, { module: b.module, fatal: 0, critical: 0, major: 0, minor: 0, total: 0 })
      const r = m.get(b.module)!; r[b.severity as keyof Omit<ModuleBugCount, 'module' | 'total'>]++; r.total++
    })
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [data])

  const assigneeStats = useMemo<AssigneeBugCount[]>(() => {
    if (!data) return []
    const m = new Map<string, AssigneeBugCount>()
    data.bugs.forEach((b) => {
      if (!m.has(b.assignee)) m.set(b.assignee, { assignee: b.assignee, closed: 0, open: 0, total: 0 })
      const a = m.get(b.assignee)!
      if (b.status === 'closed' || b.status === 'resolved') a.closed++; else a.open++; a.total++
    })
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [data])

  const dailyTrend = useMemo<DailyTrend[]>(() => {
    if (!data) return []
    const nm = new Map<string, number>(), rm = new Map<string, number>()
    data.bugs.forEach((b) => {
      nm.set(b.createdAt, (nm.get(b.createdAt) || 0) + 1)
      if (b.resolvedAt) rm.set(b.resolvedAt, (rm.get(b.resolvedAt) || 0) + 1)
    })
    const all = new Set([...nm.keys(), ...rm.keys()])
    return [...all].sort().map((d) => ({ date: d.slice(5), newBugs: nm.get(d) || 0, resolvedBugs: rm.get(d) || 0 }))
  }, [data])

  if (!data) return null

  const totalCases = data.testCases.length
  const totalBugs = data.bugs.length
  const openBugs = data.bugs.filter((b) => b.status === 'open' || b.status === 'in_progress').length
  const closedBugs = data.bugs.filter((b) => b.status === 'closed' || b.status === 'resolved').length
  const fatalCount = data.bugs.filter((b) => b.severity === 'fatal').length
  const criticalCount = data.bugs.filter((b) => b.severity === 'critical').length
  const fatalCritical = fatalCount + criticalCount
  const risk = getRiskLevel(fatalCount, criticalCount, openBugs, passRate)
  const RiskIcon = risk.icon
  const closedRate = totalBugs ? Math.round((closedBugs / totalBugs) * 100) : 0

  return (
    <div className="page-shell max-w-[1200px]">

      {/* ── Header ── */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Tooltip content="返回导入页">
            <button onClick={() => navigate('/testreport')} className="icon-action h-10 w-10 rounded-xl">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Tooltip>
          <div>
            <h1 className="page-title">{data.title}</h1>
            <p className="page-subtitle">
              数据来源：{data.platform} &middot; 生成时间：{new Date(data.generatedAt).toLocaleString('zh-CN')}
            </p>
          </div>
        </div>
      </div>

      {/* ── 风险总评 ── */}
      <section className="mb-6">
        <div className={`motion-card stagger-1 flex items-center gap-4 rounded-[22px] px-6 py-5 ring-1 ${risk.ring} ${risk.bg}`}>
          <div className="relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/80 shadow-sm">
            <RiskIcon className={`h-6 w-6 ${risk.color}`} />
          </div>
          <div className="relative z-[1] flex-1">
            <div className="flex items-center gap-2.5">
              <span className={`text-[18px] font-bold tracking-tight ${risk.color}`}>{risk.label}</span>
              <span className="rounded-full bg-white/60 px-2.5 py-0.5 text-[11px] font-semibold text-muted">
                {closedRate}% Bug 已关闭
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {fatalCount > 0 ? `含 ${fatalCount} 个致命缺陷，` : ''}{criticalCount > 0 ? `${criticalCount} 个严重缺陷，` : ''}还有 {openBugs} 个 Bug 待处理
            </p>
          </div>
          <div className="relative z-[1] hidden h-[52px] w-[120px] shrink-0 sm:block">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={bugStatusStats} dataKey="count" cx="50%" cy="50%" innerRadius={18} outerRadius={26} strokeWidth={0} startAngle={90} endAngle={-270}>
                  {bugStatusStats.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ── 指标卡片 ── */}
      <section className="mb-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroMetric icon={FileText} label="用例总数" value={totalCases} suffix="条" accent="blue" />
          <HeroMetric icon={CheckCircle2} label="整体通过率" value={passRate} suffix="%" accent={passRate >= 90 ? 'green' : passRate >= 70 ? 'yellow' : 'red'} />
          <HeroMetric icon={Activity} label="BUG 总数" value={totalBugs} suffix="个" accent="slate" />
          <HeroMetric icon={XCircle} label="未关闭 BUG" value={openBugs} suffix="个" accent={openBugs === 0 ? 'green' : openBugs > 5 ? 'red' : 'yellow'} />
        </div>
      </section>

      {/* ── 用例执行 + Bug 状态 双环 ── */}
      <section className="mb-6 grid gap-5 lg:grid-cols-2">
        <ChartCard stagger={2} title="用例执行结果" icon={FileText}>
          <div className="flex items-center gap-6">
            <div className="relative h-[200px] w-[200px] shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={caseStats} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={56} outerRadius={88} strokeWidth={0} paddingAngle={2}>
                    {caseStats.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <RTooltip formatter={(v, name) => [`${v} 条`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[28px] font-extrabold leading-none tracking-tight text-fg">{passRate}%</span>
                <span className="mt-1 text-[10px] font-medium uppercase tracking-widest text-muted">通过率</span>
              </div>
            </div>
            <LegendList items={caseStats.map((s) => ({ ...s, value: `${s.count} 条` }))} />
          </div>
        </ChartCard>

        <ChartCard stagger={3} title="Bug 解决状态" icon={AlertTriangle}>
          <div className="flex items-center gap-6">
            <div className="relative h-[200px] w-[200px] shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={bugStatusStats} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={52} outerRadius={84} strokeWidth={0} paddingAngle={2}>
                    {bugStatusStats.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <RTooltip formatter={(v, name) => [`${v} 个`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[28px] font-extrabold leading-none tracking-tight text-fg">{closedRate}%</span>
                <span className="mt-1 text-[10px] font-medium uppercase tracking-widest text-muted">关闭率</span>
              </div>
            </div>
            <LegendList items={bugStatusStats.map((s) => ({ ...s, value: `${s.count} 个` }))} />
          </div>
        </ChartCard>
      </section>

      {/* ── 缺陷深度剖析 ── */}
      <section className="mb-6">
        <SectionHeader icon={Layers} title="缺陷深度剖析" subtitle="定位系统薄弱环节" />
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard stagger={4} title="严重程度分布" icon={Flame}>
            <div className="h-[240px]">
              <ResponsiveContainer>
                <BarChart data={severityStats} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.04)" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" width={40} tick={{ fontSize: 12, fontWeight: 500 }} />
                  <RTooltip formatter={(v) => [`${v} 个`]} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                  <Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={24}>
                    {severityStats.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {fatalCritical > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#dc2626]/6 px-3.5 py-2.5 text-[12px] font-medium text-[#b91c1c] ring-1 ring-[#dc2626]/12">
                <Flame className="h-3.5 w-3.5 shrink-0" />
                致命 + 严重共 <span className="font-bold">{fatalCritical}</span> 个，需优先修复
              </div>
            )}
          </ChartCard>

          <ChartCard stagger={5} title="各模块 Bug 分布" icon={Layers}>
            <div style={{ height: Math.max(240, moduleBugStats.length * 42) }}>
              <ResponsiveContainer>
                <BarChart data={moduleBugStats} layout="vertical" margin={{ left: 64, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.04)" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="module" width={60} tick={{ fontSize: 12, fontWeight: 500 }} />
                  <RTooltip cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                  <Bar dataKey="fatal" stackId="a" fill={C.fatal} name="致命" />
                  <Bar dataKey="critical" stackId="a" fill={C.critical} name="严重" />
                  <Bar dataKey="major" stackId="a" fill={C.major} name="一般" />
                  <Bar dataKey="minor" stackId="a" fill={C.minor} name="轻微" radius={[0, 4, 4, 0]} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      </section>

      {/* ── Bug 归属人 ── */}
      <section className="mb-6">
        <ChartCard stagger={6} title="Bug 归属人分布" icon={FileText} subtitle="已解决 vs 未解决">
          <div className="h-[260px]">
            <ResponsiveContainer>
              <BarChart data={assigneeStats} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.04)" />
                <XAxis dataKey="assignee" tick={{ fontSize: 12, fontWeight: 500 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <RTooltip cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="closed" stackId="a" fill={C.closed} name="已解决" radius={[4, 4, 0, 0]} />
                <Bar dataKey="open" stackId="a" fill={C.open} name="未解决" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </section>

      {/* ── 质量趋势 ── */}
      <section className="mb-8">
        <SectionHeader icon={TrendingUp} title="质量趋势" subtitle="Bug 每日新增与解决走势" />
        <ChartCard stagger={7} title="每日 Bug 趋势" icon={Activity}>
          <div className="h-[300px]">
            <ResponsiveContainer>
              <AreaChart data={dailyTrend} margin={{ left: 8, right: 8 }}>
                <defs>
                  <linearGradient id="gFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.fail} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={C.fail} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gPass" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.pass} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={C.pass} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <RTooltip />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="newBugs" stroke={C.fail} strokeWidth={2.5} fill="url(#gFail)" dot={{ r: 3, fill: C.fail }} name="新增 Bug" />
                <Area type="monotone" dataKey="resolvedBugs" stroke={C.pass} strokeWidth={2.5} fill="url(#gPass)" dot={{ r: 3, fill: C.pass }} name="解决 Bug" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {dailyTrend.length === 0 && (
            <div className="py-16 text-center text-[13px] text-muted">暂无趋势数据</div>
          )}
        </ChartCard>
      </section>
    </div>
  )
}

// ════════════════════════════════════════════════════════
// 子组件
// ════════════════════════════════════════════════════════

/** 大号指标卡，带图标 + 渐变 accent bar */
function HeroMetric({ icon: Icon, label, value, suffix, accent }: {
  icon: React.ElementType; label: string; value: number | string; suffix?: string
  accent: 'blue' | 'green' | 'yellow' | 'red' | 'slate'
}) {
  const bar = {
    blue: 'bg-gradient-to-r from-blue-500 to-blue-400',
    green: 'bg-gradient-to-r from-emerald-500 to-emerald-400',
    yellow: 'bg-gradient-to-r from-amber-500 to-amber-400',
    red: 'bg-gradient-to-r from-red-500 to-red-400',
    slate: 'bg-gradient-to-r from-slate-500 to-slate-400',
  }[accent]

  const iconBg = {
    blue: 'bg-blue-50 text-blue-500', green: 'bg-emerald-50 text-emerald-500',
    yellow: 'bg-amber-50 text-amber-500', red: 'bg-red-50 text-red-500',
    slate: 'bg-slate-100 text-slate-500',
  }[accent]

  const numColor = {
    blue: 'text-blue-600', green: 'text-emerald-600', yellow: 'text-amber-600',
    red: 'text-red-600', slate: 'text-slate-700',
  }[accent]

  return (
    <div className="motion-card relative overflow-hidden rounded-[20px] bg-white ring-1 ring-black/[0.04]">
      <div className={`absolute inset-x-0 top-0 h-[3px] ${bar}`} />
      <div className="px-4 pb-4 pt-5">
        <div className="relative z-[1] flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className={`text-[30px] font-extrabold leading-none tracking-tight ${numColor}`}>{value}</span>
              {suffix && <span className="text-[13px] font-medium text-muted">{suffix}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 图表卡片容器 */
function ChartCard({ stagger, title, icon: Icon, subtitle, children }: {
  stagger: number; title: string; icon: React.ElementType; subtitle?: string; children: React.ReactNode
}) {
  return (
    <div className={`motion-card stagger-${stagger} rounded-[22px] bg-white p-5 ring-1 ring-black/[0.04]`}>
      <div className="relative z-[1] mb-4 flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/8">
          <Icon className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-[14px] font-semibold text-fg">{title}</span>
        {subtitle && <span className="text-[12px] text-muted">— {subtitle}</span>}
      </div>
      <div className="relative z-[1]">{children}</div>
    </div>
  )
}

/** 章节标题 */
function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10">
        <Icon className="h-3.5 w-3.5 text-accent" />
      </div>
      <span className="text-[15px] font-bold tracking-tight text-fg">{title}</span>
      {subtitle && <span className="text-[12px] text-muted">— {subtitle}</span>}
    </div>
  )
}

/** 图例列表 */
function LegendList({ items }: { items: Array<{ label: string; color: string; value: string }> }) {
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3 text-[13px]">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
          <span className="min-w-[48px] text-muted">{it.label}</span>
          <span className="font-bold tabular-nums text-fg">{it.value}</span>
        </div>
      ))}
    </div>
  )
}
