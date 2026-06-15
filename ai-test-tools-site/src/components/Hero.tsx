import { ArrowDown, Zap, Shield, Cpu } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative mx-auto max-w-[1200px] px-6 pb-12 pt-20 max-lg:px-4 max-lg:pt-14 max-sm:px-3 max-sm:pb-8 max-sm:pt-10">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-52 w-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,oklch(0.62_0.18_265/0.12)_0%,transparent_64%)] blur-xl" />

      <div className="relative z-[1] mx-auto max-w-[780px] text-center">
        {/* Status badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[oklch(0.62_0.18_265/0.16)] bg-white/68 px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.1em] text-accent shadow-[0_16px_35px_-30px_oklch(0.18_0.02_262/0.4)] backdrop-blur">
          <span className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
          AI 测试工具平台
        </div>

        {/* Main headline */}
        <h1 className="mb-5 font-display text-[clamp(48px,7vw,80px)] font-[780] leading-[0.92] tracking-[-0.075em] text-fg">
          <span className="relative inline-block">
            AI测试工具
            <span className="absolute -inset-x-4 -inset-y-2 -z-[1] rounded-2xl bg-[radial-gradient(ellipse,oklch(0.62_0.18_265/0.08)_0%,transparent_70%)]" />
          </span>
          <span className="mt-1 block bg-gradient-to-r from-accent via-[oklch(0.55_0.22_280)] to-[oklch(0.62_0.2_250)] bg-clip-text text-transparent drop-shadow-[0_18px_34px_oklch(0.62_0.18_265/0.14)]">
            一站生成
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mb-10 max-w-[560px] text-[17px] leading-[1.75] text-muted">
          面向测试团队的专业 AI 工具集合，覆盖 JMeter 脚本生成、测试用例设计、
          数据可视化与智能分析，无需安装，即开即用。
        </p>

        {/* Feature highlights */}
        <div className="mb-10 flex flex-wrap items-center justify-center gap-3">
          {[
            { icon: Zap, label: 'AI 驱动', desc: '智能脚本生成' },
            { icon: Shield, label: '质量保障', desc: '专家级用例覆盖' },
            { icon: Cpu, label: '高性能', desc: '57+ JMeter 工具' },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-2xl border border-[oklch(0.92_0.008_260/0.7)] bg-white/62 px-4 py-3 shadow-[0_4px_14px_-8px_oklch(0.18_0.02_262/0.06)] backdrop-blur transition-all duration-300 hover:border-[oklch(0.62_0.18_265/0.3)] hover:bg-white/88 hover:shadow-[0_8px_24px_-12px_oklch(0.62_0.18_265/0.18)] max-sm:flex-1"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[oklch(0.62_0.18_265/0.07)] text-accent">
                <item.icon className="h-4.5 w-4.5 stroke-[1.8]" />
              </div>
              <div className="text-left">
                <div className="text-[13px] font-semibold text-fg">{item.label}</div>
                <div className="text-[11px] text-muted">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Scroll indicator */}
        <div className="flex flex-col items-center gap-2 text-muted">
          <span className="text-xs tracking-widest uppercase">探索工具</span>
          <ArrowDown className="h-4 w-4 animate-bounce" />
        </div>
      </div>
    </section>
  )
}
