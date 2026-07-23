import type { CSSProperties, ElementType, ReactNode } from 'react'
import type { ChipTone, MetricAccent, ReportTheme, RiskLevel } from '../types'
import { hexToRgba } from '../themes'

export function getAxisTick(theme: ReportTheme, fontSize = 11) {
  return { fontSize, fill: theme.chart.axis, fontWeight: 520 }
}

export function getRiskMeta(theme: ReportTheme, riskLevel: RiskLevel) {
  if (riskLevel === 'high') {
    return {
      label: '高风险',
      accent: theme.accents.coral,
      chipBg: hexToRgba(theme.accents.coral, theme.isDark ? 0.2 : 0.14),
      textColor: theme.isDark ? '#ffb6c7' : '#c24d36',
    }
  }
  if (riskLevel === 'medium') {
    return {
      label: '中风险',
      accent: theme.accents.amber,
      chipBg: hexToRgba(theme.accents.amber, theme.isDark ? 0.2 : 0.16),
      textColor: theme.isDark ? '#ffd98a' : '#ab6d12',
    }
  }
  return {
    label: '低风险',
    accent: theme.accents.green,
    chipBg: hexToRgba(theme.accents.green, theme.isDark ? 0.2 : 0.16),
    textColor: theme.isDark ? '#92f4ff' : '#4c7f18',
  }
}

function getMetricAccentStyle(theme: ReportTheme, accent: MetricAccent) {
  const colorMap: Record<MetricAccent, string> = {
    green: theme.accents.green,
    amber: theme.accents.amber,
    coral: theme.accents.coral,
    lilac: theme.accents.lilac,
    dark: theme.accents.dark,
  }
  const color = colorMap[accent]
  return {
    bar: color,
    halo: hexToRgba(color, theme.isDark ? 0.22 : 0.18),
    iconBg: hexToRgba(color, theme.isDark ? 0.18 : 0.14),
    iconColor: color,
  }
}

export function SurfacePanel({
  theme,
  variant = 'card',
  className = '',
  children,
  style,
}: {
  theme: ReportTheme
  variant?: 'hero' | 'card' | 'nested' | 'risk' | 'strong' | 'metric'
  className?: string
  children: ReactNode
  style?: CSSProperties
}) {
  const palette = {
    hero: { background: theme.surface.hero, border: theme.surface.border, boxShadow: theme.surface.heroShadow },
    card: { background: theme.surface.card, border: theme.surface.border, boxShadow: theme.surface.shadow },
    nested: { background: theme.surface.nested, border: theme.surface.softBorder, boxShadow: theme.surface.nestedShadow },
    risk: { background: theme.surface.risk, border: theme.surface.border, boxShadow: theme.surface.riskShadow },
    strong: { background: theme.surface.strong, border: theme.surface.softBorder, boxShadow: theme.surface.nestedShadow },
    metric: { background: theme.surface.metric, border: theme.surface.border, boxShadow: theme.surface.shadow },
  }[variant]

  return (
    <div
      className={className}
      style={{ ...palette, ...style }}
    >
      {children}
    </div>
  )
}

export function SoftChip({ theme, icon: Icon, label, tone = 'light' }: {
  theme: ReportTheme
  icon?: ElementType
  label: string
  tone?: ChipTone
}) {
  const styles = {
    light: { background: theme.chips.lightBg, color: theme.chips.lightText, border: theme.chips.lightBorder },
    dark: { background: theme.chips.darkBg, color: theme.chips.darkText, border: theme.chips.darkBorder },
    accent: { background: theme.chips.accentBg, color: theme.chips.accentText, border: theme.chips.accentBorder },
  }[tone]

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-[0.02em]"
      style={styles}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </span>
  )
}

export function SectionHeading({ theme, icon: Icon, title, subtitle }: {
  theme: ReportTheme
  icon?: ElementType
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5">
      {Icon && (
        <div
          className="flex h-7 w-7 items-center justify-center rounded-2xl"
          style={{ background: theme.icon.sectionBg, color: theme.icon.sectionText, boxShadow: theme.surface.nestedShadow }}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      )}
      <span className="text-[14px] font-semibold tracking-[-0.02em]" style={{ color: theme.text.primary }}>{title}</span>
      {subtitle && <span className="text-[12px]" style={{ color: theme.text.secondary }}>{subtitle}</span>}
    </div>
  )
}

export function CardHeader({ theme, icon: Icon, title, subtitle, trailing }: {
  theme: ReportTheme
  icon?: ElementType
  title: string
  subtitle?: string
  trailing?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-2xl"
            style={{ background: theme.icon.tileBg, color: theme.icon.tileText }}
          >
            <Icon className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-[-0.03em]" style={{ color: theme.text.primary }}>{title}</div>
          {subtitle && <div className="mt-1 text-[12px]" style={{ color: theme.text.secondary }}>{subtitle}</div>}
        </div>
      </div>
      {trailing}
    </div>
  )
}

export function MetricTile({ theme, icon: Icon, label, value, suffix, accent }: {
  theme: ReportTheme
  icon: ElementType
  label: string
  value: number | string
  suffix?: string
  accent: MetricAccent
}) {
  const accentStyle = getMetricAccentStyle(theme, accent)

  return (
    <SurfacePanel theme={theme} variant="metric" className="motion-card relative overflow-hidden rounded-[28px] px-5 pb-5 pt-5">
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accentStyle.bar }} />
      <div className="absolute -right-8 top-4 h-24 w-24 rounded-full blur-3xl" style={{ background: accentStyle.halo }} />
      <div className="relative z-[1] flex items-start gap-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: accentStyle.iconBg, color: accentStyle.iconColor }}
        >
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: theme.text.tertiary }}>{label}</div>
          <div className="mt-3 flex items-end gap-1.5">
            <span className="font-display text-[40px] leading-none tracking-[-0.07em]" style={{ color: theme.text.primary }}>{value}</span>
            {suffix && <span className="pb-1 text-[12px]" style={{ color: theme.text.secondary }}>{suffix}</span>}
          </div>
        </div>
      </div>
    </SurfacePanel>
  )
}

export function InsightRow({ theme, label, value, detail, accent }: {
  theme: ReportTheme
  label: string
  value: string
  detail: string
  accent: string
}) {
  return (
    <SurfacePanel theme={theme} variant="strong" className="rounded-[24px] px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: theme.text.tertiary }}>{label}</span>
      </div>
      <div className="text-[15px] font-semibold tracking-[-0.03em]" style={{ color: theme.text.primary }}>{value}</div>
      <div className="mt-1 text-[12px]" style={{ color: theme.text.secondary }}>{detail}</div>
    </SurfacePanel>
  )
}

export function LegendList({ theme, items }: { theme: ReportTheme; items: Array<{ label: string; color: string; value: string }> }) {
  return (
    <div className="grid w-full min-w-[160px] gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-2.5 rounded-full px-3 py-2 text-[12px]"
          style={{ background: theme.legend.bg, border: theme.legend.border }}
        >
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
          <span className="min-w-[48px]" style={{ color: theme.text.secondary }}>{item.label}</span>
          <span className="ml-auto font-mono font-semibold tabular-nums" style={{ color: theme.text.primary }}>{item.value}</span>
        </div>
      ))}
    </div>
  )
}

export function ToggleLegendList({
  theme,
  items,
  activeKeys,
  onToggle,
}: {
  theme: ReportTheme
  items: Array<{ key: string; label: string; color: string; value?: string }>
  activeKeys: string[]
  onToggle: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = activeKeys.includes(item.key)
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onToggle(item.key)}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-[12px] transition-opacity focus:outline-none focus-visible:outline-none"
            style={{
              background: theme.legend.bg,
              border: theme.legend.border,
              color: active ? theme.text.primary : theme.text.secondary,
              opacity: active ? 1 : 0.55,
            }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
            <span>{item.label}</span>
            {item.value && <span className="font-mono font-semibold tabular-nums">{item.value}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function ProgressRow({ theme, label, value, percent, accent, detail }: {
  theme: ReportTheme
  label: string
  value: string
  percent: number
  accent: string
  detail?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <div className="min-w-0">
          <div className="truncate font-medium" style={{ color: theme.text.primary }}>{label}</div>
          {detail && <div style={{ color: theme.text.secondary }}>{detail}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-semibold" style={{ color: theme.text.primary }}>{value}</div>
          <div className="text-[11px]" style={{ color: theme.text.secondary }}>{percent}%</div>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: hexToRgba(theme.accents.dark, theme.isDark ? 0.18 : 0.08) }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(percent, 100)}%`, background: accent }} />
      </div>
    </div>
  )
}
