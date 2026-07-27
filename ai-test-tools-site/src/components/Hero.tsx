import { ArrowDown, Sparkles, Zap, Gauge, Rocket } from 'lucide-react'
import { AuroraBackground } from './ui/aurora-background'

// 特性标签（glass-chip 行）
const featureChips = [
  { icon: Zap, label: 'AI 驱动' },
  { icon: Gauge, label: '57+ JMeter 工具' },
  { icon: Rocket, label: '即开即用' },
]

// 数据统计行
const stats = [
  { value: '6+', label: '测试工具' },
  { value: '57+', label: 'JMeter 模板' },
  { value: '100%', label: '即开即用' },
]

export function Hero() {
  return (
    <AuroraBackground
      role="region"
      aria-label="产品介绍"
      className="-mt-[72px] min-h-[88vh] overflow-hidden px-6 pb-16 pt-[128px] max-lg:px-4 max-sm:min-h-[82vh] max-sm:px-3 max-sm:pb-12 max-sm:pt-[112px]"
    >
      <div className="relative z-[1] mx-auto flex w-full max-w-[820px] flex-col items-center text-center">
        {/* 徽章 */}
        <div className="glass-chip mb-7 px-4 py-1.5 text-[13px] font-medium text-accent">
          <span className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
          AI 测试工具平台
        </div>

        {/* 主标题：纯黑 solid（BigModel 式极简） */}
        <h1 className="mb-6 text-center font-display text-[clamp(48px,8vw,88px)] font-[800] leading-[1.06] tracking-[-0.045em] text-fg">
          AI测试工具
          <br />
          一站生成
        </h1>

        {/* 副标题 */}
        <p className="mx-auto mb-9 max-w-[560px] text-balance text-[17px] leading-[1.75] text-muted">
          面向测试团队的专业 AI 工具集合：让 AI 帮你写脚本、设计用例、
          分析数据，无需安装，即开即用。
        </p>

        {/* CTA */}
        <div className="mb-10 flex items-center justify-center gap-4 max-sm:w-full max-sm:flex-col">
          <a href="#tools" className="primary-action px-7 py-3 text-[15px] max-sm:w-full">
            立即开始
            <ArrowDown className="h-4 w-4" />
          </a>
          <a href="#tools" className="secondary-action px-7 py-3 text-[15px] max-sm:w-full">
            了解功能
            <Sparkles className="h-4 w-4" />
          </a>
        </div>

        {/* 特性 chips */}
        <div className="mb-11 flex flex-wrap items-center justify-center gap-2.5">
          {featureChips.map((chip) => (
            <span
              key={chip.label}
              className="glass-chip px-3.5 py-1.5 text-xs font-medium text-fg-soft"
            >
              <chip.icon className="h-3.5 w-3.5 text-accent" />
              {chip.label}
            </span>
          ))}
        </div>

        {/* 数据统计行 */}
        <div className="mb-12 flex items-center max-sm:gap-5">
          {stats.map((s, i) => (
            <div key={s.label} className="flex items-center">
              {i > 0 && (
                <span className="mx-8 h-9 w-px bg-gradient-to-b from-transparent via-border-strong to-transparent max-sm:mx-5" />
              )}
              <div className="text-center">
                <div className="font-display text-[28px] font-bold leading-none tracking-tight text-fg">
                  {s.value}
                </div>
                <div className="mt-1.5 text-xs text-muted">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 滚动提示 */}
        <a
          href="#tools"
          aria-label="向下滚动探索工具"
          className="flex flex-col items-center gap-2 text-muted no-underline transition-colors duration-300 hover:text-accent"
        >
          <span className="text-[11px] uppercase tracking-[0.2em]">探索工具</span>
          <ArrowDown className="h-4 w-4 animate-bounce" />
        </a>
      </div>
    </AuroraBackground>
  )
}
