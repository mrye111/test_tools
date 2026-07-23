import type { CountStat, ReportTheme } from '../../types'

export function ChartTooltip({ active, payload, label, unit = '', theme }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: { label?: string } }>
  label?: string
  unit?: string
  theme: ReportTheme
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        borderRadius: 18,
        border: theme.chart.tooltipBorder,
        background: theme.chart.tooltipBg,
        boxShadow: theme.chart.tooltipShadow,
        backdropFilter: 'blur(16px)',
        padding: '10px 12px',
      }}
    >
      {label && <div className="mb-2 text-[11px] font-semibold" style={{ color: theme.text.secondary }}>{label}</div>}
      <div className="space-y-1.5">
        {payload.map((item, index) => (
          <div key={`${item.name ?? item.payload?.label ?? index}`} className="flex min-w-[132px] items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-2" style={{ color: theme.text.secondary }}>
              <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
              {item.payload?.label ?? item.name}
            </span>
            <span className="font-mono font-semibold tabular-nums" style={{ color: theme.text.primary }}>{item.value}{unit}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function getCountColor(theme: ReportTheme, item: CountStat) {
  if (item.key in theme.statusColors) return theme.statusColors[item.key as keyof typeof theme.statusColors]
  if (item.key in theme.bugStatusColors) return theme.bugStatusColors[item.key as keyof typeof theme.bugStatusColors]
  return theme.severityColors[item.key as keyof typeof theme.severityColors]
}

export function getTrackColor(theme: ReportTheme, alpha = theme.isDark ? 0.12 : 0.08) {
  return theme.isDark ? `rgba(255,255,255,${alpha})` : `rgba(31,31,29,${alpha})`
}

export function getRatio(value: number, total: number) {
  if (!total) return 0
  return Math.max(0, Math.min(100, Number(((value / total) * 100).toFixed(1))))
}

export function buildConicGradient(items: Array<{ count: number; color: string }>) {
  const total = items.reduce((sum, item) => sum + item.count, 0)
  if (!total) return 'conic-gradient(from -90deg, transparent 0deg 360deg)'

  let start = 0
  const segments = items.map((item) => {
    const end = start + (item.count / total) * 360
    const segment = `${item.color} ${start}deg ${end}deg`
    start = end
    return segment
  })

  return `conic-gradient(from -90deg, ${segments.join(', ')})`
}
