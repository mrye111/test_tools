import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useMemo, useState } from 'react'
import { REPORT_CHART_VIEWPORTS } from '../../constants'
import type { CountStat, ReportTheme, ReportViewModel } from '../../types'
import { getAxisTick, LegendList, ToggleLegendList } from '../ReportPrimitives'
import { ChartTooltip, getCountColor } from './shared'

function toggleLegendKey(current: string[], key: string) {
  if (current.includes(key)) {
    return current.filter((item) => item !== key)
  }
  return [...current, key]
}

type BarRadiusTuple = [number, number, number, number]

function renderRoundedBar(props: {
  fill?: string
  x?: number
  y?: number
  width?: number
  height?: number
  radius?: BarRadiusTuple
}) {
  const { fill, x = 0, y = 0, width = 0, height = 0, radius = [0, 0, 0, 0] } = props
  if (width <= 0 || height <= 0) return null

  const [tl, tr, br, bl] = radius.map((value) => Math.max(0, Math.min(value, width / 2, height / 2)))
  const path = [
    `M${x + tl},${y}`,
    `H${x + width - tr}`,
    tr ? `Q${x + width},${y} ${x + width},${y + tr}` : `L${x + width},${y}`,
    `V${y + height - br}`,
    br ? `Q${x + width},${y + height} ${x + width - br},${y + height}` : `L${x + width},${y + height}`,
    `H${x + bl}`,
    bl ? `Q${x},${y + height} ${x},${y + height - bl}` : `L${x},${y + height}`,
    `V${y + tl}`,
    tl ? `Q${x},${y} ${x + tl},${y}` : `L${x},${y}`,
    'Z',
  ].join(' ')

  return <path d={path} fill={fill} />
}

export function TrendAreaView({ theme, viewModel, height = 300, idPrefix = 'trend' }: {
  theme: ReportTheme
  viewModel: ReportViewModel
  height?: number
  idPrefix?: string
}) {
  const failGradientId = `${idPrefix}-fail-${theme.key}`
  const resolvedGradientId = `${idPrefix}-resolved-${theme.key}`
  const backlogGradientId = `${idPrefix}-backlog-${theme.key}`
  const axisTick = getAxisTick(theme)
  const chartWidth = Math.max(REPORT_CHART_VIEWPORTS.trendMinCanvasWidth, viewModel.dailyTrend.length * REPORT_CHART_VIEWPORTS.trendPointWidth)
  const legendItems = useMemo(() => ([
    { key: 'newBugs', label: '新增 Bug', color: theme.statusColors.fail },
    { key: 'resolvedBugs', label: '解决 Bug', color: theme.statusColors.pass },
    { key: 'backlog', label: '待关闭存量', color: theme.accents.lilac },
  ]), [theme])
  const [activeKeys, setActiveKeys] = useState<string[]>(legendItems.map((item) => item.key))
  const activeLegendSignature = activeKeys.join('-')

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-2">
        <div style={{ width: chartWidth, minWidth: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={viewModel.dailyTrend} margin={{ left: 4, right: 4, top: 6, bottom: 2 }}>
              <defs>
                <linearGradient id={failGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.statusColors.fail} stopOpacity={theme.isDark ? 0.28 : 0.34} />
                  <stop offset="100%" stopColor={theme.statusColors.fail} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={resolvedGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.statusColors.pass} stopOpacity={theme.isDark ? 0.24 : 0.28} />
                  <stop offset="100%" stopColor={theme.statusColors.pass} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={backlogGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.accents.lilac} stopOpacity={theme.isDark ? 0.18 : 0.22} />
                  <stop offset="100%" stopColor={theme.accents.lilac} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" vertical={false} stroke={theme.chart.grid} />
              <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
              <RTooltip content={<ChartTooltip theme={theme} unit=" 个" />} wrapperStyle={{ outline: 'none' }} />
              {activeKeys.includes('newBugs') && (
                <Area
                  key={`newBugs-${activeLegendSignature}`}
                  type="monotone"
                  dataKey="newBugs"
                  stroke={theme.statusColors.fail}
                  strokeWidth={theme.chart.areaStrokeWidth}
                  fill={`url(#${failGradientId})`}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 5, stroke: theme.chart.activeDotStroke, strokeWidth: 3, fill: theme.statusColors.fail }}
                  name="新增 Bug"
                />
              )}
              {activeKeys.includes('resolvedBugs') && (
                <Area
                  key={`resolvedBugs-${activeLegendSignature}`}
                  type="monotone"
                  dataKey="resolvedBugs"
                  stroke={theme.statusColors.pass}
                  strokeWidth={theme.chart.areaStrokeWidth}
                  fill={`url(#${resolvedGradientId})`}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 5, stroke: theme.chart.activeDotStroke, strokeWidth: 3, fill: theme.statusColors.pass }}
                  name="解决 Bug"
                />
              )}
              {activeKeys.includes('backlog') && (
                <Area
                  key={`backlog-${activeLegendSignature}`}
                  type="monotone"
                  dataKey="backlog"
                  stroke={theme.accents.lilac}
                  strokeDasharray="5 6"
                  strokeWidth={2}
                  fill={`url(#${backlogGradientId})`}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, stroke: theme.chart.activeDotStroke, strokeWidth: 2, fill: theme.accents.lilac }}
                  name="待关闭存量"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ToggleLegendList
        theme={theme}
        items={legendItems}
        activeKeys={activeKeys}
        onToggle={(key) => setActiveKeys((current) => toggleLegendKey(current, key))}
      />
    </div>
  )
}

export function DonutSummary({ theme, items, centerValue, centerLabel, unit }: {
  theme: ReportTheme
  items: CountStat[]
  centerValue: string | number
  centerLabel: string
  unit: string
}) {
  const chartItems = items.map((item) => ({ ...item, color: getCountColor(theme, item) }))
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative h-[196px] w-[196px]">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={chartItems}
              dataKey="count"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={56}
              outerRadius={84}
              stroke={theme.chart.pieStroke}
              strokeWidth={theme.chart.pieStrokeWidth}
              paddingAngle={2}
            >
              {chartItems.map((item, index) => <Cell key={index} fill={item.color} />)}
            </Pie>
            <RTooltip content={<ChartTooltip theme={theme} unit={unit} />} wrapperStyle={{ outline: 'none' }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-[36px] font-semibold leading-none tracking-[-0.06em]" style={{ color: theme.text.primary }}>{centerValue}</span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: theme.text.tertiary }}>{centerLabel}</span>
        </div>
      </div>
      <LegendList theme={theme} items={chartItems.map((item) => ({ label: item.label, color: item.color, value: `${item.count}${unit}` }))} />
    </div>
  )
}

export function SeverityBarsView({ theme, viewModel, orientation = 'horizontal', height = 280 }: {
  theme: ReportTheme
  viewModel: ReportViewModel
  orientation?: 'horizontal' | 'vertical'
  height?: number
}) {
  const axisTick = getAxisTick(theme)
  const data = viewModel.severityStats.map((item) => ({ ...item, color: getCountColor(theme, item) }))
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout={orientation === 'horizontal' ? 'vertical' : 'horizontal'}
          margin={{ left: 8, right: 18, top: 4, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="4 8" horizontal={orientation !== 'horizontal'} vertical={orientation === 'horizontal'} stroke={theme.chart.grid} />
          {orientation === 'horizontal' ? (
            <>
              <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={42} tick={getAxisTick(theme, 12)} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={getAxisTick(theme, 12)} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
            </>
          )}
          <RTooltip content={<ChartTooltip theme={theme} unit=" 个" />} wrapperStyle={{ outline: 'none' }} cursor={{ fill: theme.chart.cursor }} />
          <Bar dataKey="count" radius={orientation === 'horizontal' ? [0, theme.chart.barRadius, theme.chart.barRadius, 0] : [theme.chart.barRadius, theme.chart.barRadius, 0, 0]} barSize={24}>
            {data.map((item, index) => <Cell key={index} fill={item.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ModuleBugStackView({ theme, viewModel }: {
  theme: ReportTheme
  viewModel: ReportViewModel
}) {
  const axisTick = getAxisTick(theme)
  const chartHeight = Math.max(REPORT_CHART_VIEWPORTS.moduleMinViewportHeight, viewModel.moduleBugStats.length * REPORT_CHART_VIEWPORTS.moduleRowHeight)
  const legendItems = useMemo(() => ([
    { key: 'fatal', label: '致命', color: theme.severityColors.fatal },
    { key: 'critical', label: '严重', color: theme.severityColors.critical },
    { key: 'major', label: '一般', color: theme.severityColors.major },
    { key: 'minor', label: '轻微', color: theme.severityColors.minor },
  ]), [theme])
  const [activeKeys, setActiveKeys] = useState<string[]>(legendItems.map((item) => item.key))
  const visibleSeries = legendItems.filter((item) => activeKeys.includes(item.key))
  const activeLegendSignature = activeKeys.join('-')
  const getCellRadius = (row: ReportViewModel['moduleBugStats'][number], key: string): BarRadiusTuple => {
    const lastVisibleKey = [...visibleSeries].reverse().find((item) => Number(row[item.key as keyof typeof row]) > 0)?.key
    return lastVisibleKey === key ? [0, theme.chart.barRadius, theme.chart.barRadius, 0] : [0, 0, 0, 0]
  }
  return (
    <div className="space-y-3">
      <div className="overflow-y-auto pr-2" style={{ maxHeight: REPORT_CHART_VIEWPORTS.moduleMinViewportHeight }}>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={viewModel.moduleBugStats} layout="vertical" margin={{ left: 72, right: 14, top: 6, bottom: 6 }}>
              <CartesianGrid strokeDasharray="4 8" horizontal={false} stroke={theme.chart.grid} />
              <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="module" width={68} tick={getAxisTick(theme, 12)} axisLine={false} tickLine={false} />
              <RTooltip content={<ChartTooltip theme={theme} unit=" 个" />} wrapperStyle={{ outline: 'none' }} cursor={{ fill: theme.chart.cursor }} />
              {activeKeys.includes('fatal') && (
                <Bar
                  key={`fatal-${activeLegendSignature}`}
                  dataKey="fatal"
                  stackId="a"
                  fill={theme.severityColors.fatal}
                  name="致命"
                  isAnimationActive={false}
                  shape={(props) => renderRoundedBar({ ...props, radius: getCellRadius(props.payload, 'fatal') })}
                />
              )}
              {activeKeys.includes('critical') && (
                <Bar
                  key={`critical-${activeLegendSignature}`}
                  dataKey="critical"
                  stackId="a"
                  fill={theme.severityColors.critical}
                  name="严重"
                  isAnimationActive={false}
                  shape={(props) => renderRoundedBar({ ...props, radius: getCellRadius(props.payload, 'critical') })}
                />
              )}
              {activeKeys.includes('major') && (
                <Bar
                  key={`major-${activeLegendSignature}`}
                  dataKey="major"
                  stackId="a"
                  fill={theme.severityColors.major}
                  name="一般"
                  isAnimationActive={false}
                  shape={(props) => renderRoundedBar({ ...props, radius: getCellRadius(props.payload, 'major') })}
                />
              )}
              {activeKeys.includes('minor') && (
                <Bar
                  key={`minor-${activeLegendSignature}`}
                  dataKey="minor"
                  stackId="a"
                  fill={theme.severityColors.minor}
                  name="轻微"
                  isAnimationActive={false}
                  shape={(props) => renderRoundedBar({ ...props, radius: getCellRadius(props.payload, 'minor') })}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ToggleLegendList
        theme={theme}
        items={legendItems}
        activeKeys={activeKeys}
        onToggle={(key) => setActiveKeys((current) => toggleLegendKey(current, key))}
      />
    </div>
  )
}

export function AssigneeBarsView({ theme, viewModel, stacked = true, height = 320 }: {
  theme: ReportTheme
  viewModel: ReportViewModel
  stacked?: boolean
  height?: number
}) {
  const axisTick = getAxisTick(theme)
  const chartWidth = Math.max(REPORT_CHART_VIEWPORTS.assigneeMinCanvasWidth, viewModel.assigneeStats.length * REPORT_CHART_VIEWPORTS.assigneeBarWidth)
  const legendItems = useMemo(() => ([
    { key: 'closed', label: '已解决', color: theme.bugStatusColors.closed },
    { key: 'open', label: '未解决', color: theme.bugStatusColors.open },
  ]), [theme])
  const [activeKeys, setActiveKeys] = useState<string[]>(legendItems.map((item) => item.key))
  const visibleSeries = legendItems.filter((item) => activeKeys.includes(item.key))
  const activeLegendSignature = activeKeys.join('-')
  const getCellRadius = (row: ReportViewModel['assigneeStats'][number], key: string): BarRadiusTuple => {
    if (!stacked) return [theme.chart.barRadius, theme.chart.barRadius, 0, 0]
    const topVisibleKey = [...visibleSeries].reverse().find((item) => Number(row[item.key as keyof typeof row]) > 0)?.key
    return topVisibleKey === key ? [theme.chart.barRadius, theme.chart.barRadius, 0, 0] : [0, 0, 0, 0]
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-2">
        <div style={{ width: chartWidth, minWidth: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={viewModel.assigneeStats} margin={{ left: 8, right: 8, top: 6, bottom: 2 }}>
              <CartesianGrid strokeDasharray="4 8" vertical={false} stroke={theme.chart.grid} />
              <XAxis dataKey="assignee" tick={getAxisTick(theme, 12)} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
              <RTooltip content={<ChartTooltip theme={theme} unit=" 个" />} wrapperStyle={{ outline: 'none' }} cursor={{ fill: theme.chart.cursor }} />
              {activeKeys.includes('closed') && (
                <Bar
                  key={`closed-${activeLegendSignature}`}
                  dataKey="closed"
                  stackId={stacked ? 'a' : undefined}
                  fill={theme.bugStatusColors.closed}
                  name="已解决"
                  maxBarSize={30}
                  isAnimationActive={false}
                  shape={(props) => renderRoundedBar({ ...props, radius: getCellRadius(props.payload, 'closed') })}
                />
              )}
              {activeKeys.includes('open') && (
                <Bar
                  key={`open-${activeLegendSignature}`}
                  dataKey="open"
                  stackId={stacked ? 'a' : undefined}
                  fill={theme.bugStatusColors.open}
                  name="未解决"
                  maxBarSize={30}
                  isAnimationActive={false}
                  shape={(props) => renderRoundedBar({ ...props, radius: getCellRadius(props.payload, 'open') })}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ToggleLegendList
        theme={theme}
        items={legendItems}
        activeKeys={activeKeys}
        onToggle={(key) => setActiveKeys((current) => toggleLegendKey(current, key))}
      />
    </div>
  )
}

export function ResolutionBar({ theme, viewModel }: { theme: ReportTheme; viewModel: ReportViewModel }) {
  const total = viewModel.summary.totalBugs || 1
  const items = viewModel.bugStatusStats.map((item) => ({
    ...item,
    color: getCountColor(theme, item),
    width: `${(item.count / total) * 100}%`,
  }))

  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full" style={{ background: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(31,31,29,0.06)' }}>
        {items.map((item) => (
          <div key={item.key} style={{ width: item.width, background: item.color }} />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between rounded-[18px] px-3 py-2 text-[12px]" style={{ background: theme.legend.bg, border: theme.legend.border }}>
            <span className="flex items-center gap-2" style={{ color: theme.text.secondary }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
              {item.label}
            </span>
            <span className="font-mono font-semibold" style={{ color: theme.text.primary }}>{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
