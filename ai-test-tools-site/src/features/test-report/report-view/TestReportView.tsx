import {
  Flame,
  Layers,
  PieChart,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react'
import { AssigneeBarsView, DonutSummary, ModuleBugStackView, SeverityBarsView, TrendAreaView } from './components/ReportCharts'
import { CardHeader, SoftChip, SurfacePanel, getRiskMeta } from './components/ReportPrimitives'
import type { ReportTheme, ReportViewModel } from './types'

export function TestReportView({ theme, viewModel }: { theme: ReportTheme; viewModel: ReportViewModel }) {
  const { summary, statusStats } = viewModel
  const risk = getRiskMeta(theme, summary.riskLevel)

  return (
    <>
      {/* ── Hero 区域：全宽仪表盘风格 ── */}
      <section className="mb-5">
        <SurfacePanel theme={theme} variant="hero" className="motion-card stagger-1 relative overflow-hidden rounded-[32px] p-6">
          <div className="absolute -left-12 top-0 h-56 w-56 rounded-full blur-3xl" style={{ background: theme.heroGlows[0] }} />
          <div className="absolute right-0 bottom-0 h-48 w-48 rounded-full blur-3xl" style={{ background: theme.heroGlows[1] }} />

          <div className="relative z-[1]">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <SoftChip theme={theme} icon={Sparkles} label={risk.label} tone="dark" />
              <SoftChip theme={theme} label={`更新于 ${summary.generatedLabel}`} tone="light" />
            </div>

            <h2 className="mb-2 font-display text-[32px] font-semibold leading-tight tracking-[-0.06em]" style={{ color: theme.text.primary }}>
              测试质量一屏总览
            </h2>
            <p className="mb-6 max-w-[640px] text-[14px] leading-7" style={{ color: theme.text.secondary }}>
              {summary.qualitySummary}
            </p>

            {/* 大数字指标行 */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[24px] px-5 py-4" style={{ background: theme.surface.strong, border: theme.surface.softBorder }}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: theme.text.tertiary }}>整体通过率</div>
                <div className="mt-2 flex items-end gap-1">
                  <span className="font-display text-[52px] leading-none tracking-[-0.08em]" style={{ color: theme.text.primary }}>{summary.passRate}</span>
                  <span className="pb-2 text-[20px] font-medium" style={{ color: theme.text.tertiary }}>%</span>
                </div>
              </div>
              <div className="rounded-[24px] px-5 py-4" style={{ background: theme.surface.strong, border: theme.surface.softBorder }}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: theme.text.tertiary }}>Bug 关闭率</div>
                <div className="mt-2 flex items-end gap-1">
                  <span className="font-display text-[52px] leading-none tracking-[-0.08em]" style={{ color: theme.text.primary }}>{summary.closedRate}</span>
                  <span className="pb-2 text-[20px] font-medium" style={{ color: theme.text.tertiary }}>%</span>
                </div>
              </div>
              <div className="rounded-[24px] px-5 py-4" style={{ background: theme.surface.strong, border: theme.surface.softBorder }}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: theme.text.tertiary }}>用例总数</div>
                <div className="mt-2 font-display text-[52px] leading-none tracking-[-0.08em]" style={{ color: theme.text.primary }}>{summary.totalCases}</div>
              </div>
              <div className="rounded-[24px] px-5 py-4" style={{ background: theme.surface.strong, border: theme.surface.softBorder }}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: theme.text.tertiary }}>未关闭 Bug</div>
                <div className="mt-2 font-display text-[52px] leading-none tracking-[-0.08em]" style={{ color: summary.openBugs > 0 ? theme.accents.coral : theme.accents.green }}>{summary.openBugs}</div>
              </div>
            </div>
          </div>
        </SurfacePanel>
      </section>

      {/* ── 趋势区域：全宽面积图 ── */}
      <section className="mb-5">
        <SurfacePanel theme={theme} variant="nested" className="motion-card stagger-2 rounded-[28px] p-5">
          <CardHeader
            theme={theme}
            icon={TrendingUp}
            title="质量走势"
            subtitle="图表支持横向滚动，可查看全部趋势数据"
            trailing={<SoftChip theme={theme} label={`未关闭 ${summary.openBugs}`} tone="dark" />}
          />
          <TrendAreaView theme={theme} viewModel={viewModel} height={260} idPrefix="classic-hero" />
        </SurfacePanel>
      </section>

      {/* ── 环形图 + 严重程度：两列 ── */}
      <section className="mb-5 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <SurfacePanel theme={theme} variant="card" className="motion-card stagger-3 rounded-[28px] p-5">
          <CardHeader theme={theme} icon={PieChart} title="用例执行结果" />
          <DonutSummary theme={theme} items={statusStats} centerValue={`${summary.passRate}%`} centerLabel="Pass Rate" unit=" 条" />
        </SurfacePanel>

        <SurfacePanel theme={theme} variant="card" className="motion-card stagger-4 rounded-[28px] p-5">
          <CardHeader theme={theme} icon={Flame} title="严重程度分布" subtitle="优先处理高等级缺陷" />
          <SeverityBarsView theme={theme} viewModel={viewModel} orientation="horizontal" height={280} />
        </SurfacePanel>
      </section>

      {/* ── 模块 + 处理人：两列 ── */}
      <section className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <SurfacePanel theme={theme} variant="card" className="motion-card stagger-5 rounded-[28px] p-5">
          <CardHeader theme={theme} icon={Layers} title="各模块 Bug 分布" subtitle="图表支持纵向滚动，可查看全部模块数据" />
          <ModuleBugStackView theme={theme} viewModel={viewModel} />
        </SurfacePanel>

        <SurfacePanel theme={theme} variant="card" className="motion-card stagger-6 rounded-[28px] p-5">
          <CardHeader theme={theme} icon={Users} title="Bug 归属人分布" subtitle="图表支持横向滚动，可查看全部责任人数据" />
          <AssigneeBarsView theme={theme} viewModel={viewModel} height={280} />
        </SurfacePanel>
      </section>

      {/* ── 风险判断：全宽 ── */}
      <section className="mb-4">
        <SurfacePanel theme={theme} variant="risk" className="motion-card stagger-7 rounded-[28px] p-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: theme.text.tertiary }}>Release Risk</div>
              <div className="mt-2 text-[28px] font-semibold tracking-[-0.05em]" style={{ color: risk.textColor }}>{risk.label}</div>
              <p className="mt-3 max-w-[480px] text-[13px] leading-6" style={{ color: theme.text.secondary }}>
                当前存在 {summary.fatalCount} 个致命缺陷、{summary.criticalCount} 个严重缺陷，仍有 {summary.openBugs} 个问题待关闭。
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="rounded-[20px] px-4 py-3 text-center" style={{ background: theme.surface.strong, border: theme.surface.softBorder }}>
                <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: theme.text.tertiary }}>致命</div>
                <div className="mt-1 font-mono text-[22px] font-semibold" style={{ color: theme.severityColors.fatal }}>{summary.fatalCount}</div>
              </div>
              <div className="rounded-[20px] px-4 py-3 text-center" style={{ background: theme.surface.strong, border: theme.surface.softBorder }}>
                <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: theme.text.tertiary }}>严重</div>
                <div className="mt-1 font-mono text-[22px] font-semibold" style={{ color: theme.severityColors.critical }}>{summary.criticalCount}</div>
              </div>
              <div className="rounded-[20px] px-4 py-3 text-center" style={{ background: theme.surface.strong, border: theme.surface.softBorder }}>
                <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: theme.text.tertiary }}>阻塞</div>
                <div className="mt-1 font-mono text-[22px] font-semibold" style={{ color: theme.accents.amber }}>{summary.blockedCases}</div>
              </div>
            </div>
          </div>
        </SurfacePanel>
      </section>
    </>
  )
}
