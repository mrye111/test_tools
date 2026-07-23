import { tools } from '../data/tools'
import { ToolCard } from './ToolCard'

export function ToolsSection() {
  return (
    <section id="tools" className="relative mx-auto max-w-[1080px] scroll-mt-28 px-6 pb-24 max-lg:px-4 max-sm:px-3">
      {/* 顶部青光：Hero 舞台光晕在浅色区的回声，衔接上下两个区域 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 left-1/2 h-[340px] w-[760px] -translate-x-1/2 bg-[radial-gradient(ellipse,oklch(0.74_0.13_192/0.15),transparent_65%)]"
      />

      {/* Section 头部 */}
      <div className="relative mx-auto mb-12 max-w-[640px] text-center">
        <span className="glass-chip mb-5 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          工具矩阵
        </span>
        <h2 className="font-display text-[clamp(30px,4.5vw,44px)] font-bold leading-[1.15] tracking-[-0.04em] text-fg">
          测试全流程
          <span className="text-gradient text-gradient-animated">一站搞定</span>
        </h2>
        <p className="mt-4 text-[15px] leading-[1.8] text-muted">
          从脚本生成到报告分析，每个环节都有 AI 搭把手，点开即用。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-5 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {tools.map((tool, index) => (
          <ToolCard key={tool.id} tool={tool} index={index} />
        ))}
      </div>
    </section>
  )
}
