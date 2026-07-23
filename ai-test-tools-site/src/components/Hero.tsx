import { ArrowDown, Sparkles, Zap, Gauge, Rocket } from 'lucide-react'
import { Lightfall } from './Lightfall'

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
    <section className="hero-dark relative -mt-[72px] flex min-h-[92vh] flex-col items-center justify-center overflow-hidden px-6 pb-16 pt-[152px] max-lg:px-4 max-sm:min-h-[86vh] max-sm:px-3 max-sm:pb-12 max-sm:pt-[128px]">
      {/* Lightfall 光雨背景（WebGL 全屏着色器，鼠标跟随光晕）。
          画布向上延伸铺满导航区，流光从页面最顶部散发；参数对齐官方 demo 的稀疏感 */}
      <Lightfall
        className="absolute inset-0"
        colors={['#7dd3fc', '#22d3ee', '#2dd4bf', '#6ee7b7']}
        backgroundColor="#0e7490"
        speed={0.8}
        streakCount={3}
        streakWidth={1}
        streakLength={1}
        glow={1}
        density={0.6}
        twinkle={1}
        zoom={2}
        backgroundGlow={1}
        opacity={1}
        mouseInteraction
        mouseStrength={1.1}
        mouseRadius={0.35}
        dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1.5}
      />

      {/* 内容暗色衬底：提升文字在光雨上的可读性，不改变效果本身 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_58%_50%_at_50%_46%,rgba(3,15,20,0.74),transparent_70%)]"
      />

      <div className="relative z-[2] mx-auto flex w-full max-w-[820px] flex-col items-center text-center">
        {/* 徽章 */}
        <div className="glass-chip glass-chip-dark mb-7 px-4 py-1.5 text-[13px] font-medium text-[#a5f3fc]">
          <span className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-[#22d3ee]" />
          AI 测试工具平台
        </div>

        {/* 主标题：第一行 solid，第二行渐变 */}
        <h1 className="mb-6 text-center font-display text-[clamp(48px,8vw,88px)] font-[800] leading-[1.06] tracking-[-0.045em] text-white">
          AI测试工具
          <br />
          <span className="text-gradient-bright text-gradient-animated">一站生成</span>
        </h1>

        {/* 副标题 */}
        <p className="mx-auto mb-9 max-w-[560px] text-balance text-[17px] leading-[1.75] text-white/75">
          面向测试团队的专业 AI 工具集合：让 AI 帮你写脚本、设计用例、
          分析数据，无需安装，即开即用。
        </p>

        {/* CTA */}
        <div className="mb-10 flex items-center justify-center gap-4 max-sm:w-full max-sm:flex-col">
          <a href="#tools" className="primary-action px-7 py-3 text-[15px] max-sm:w-full">
            立即开始
            <ArrowDown className="h-4 w-4" />
          </a>
          <a href="#tools" className="secondary-action secondary-action-dark px-7 py-3 text-[15px] max-sm:w-full">
            了解功能
            <Sparkles className="h-4 w-4" />
          </a>
        </div>

        {/* 特性 chips */}
        <div className="mb-11 flex flex-wrap items-center justify-center gap-2.5">
          {featureChips.map((chip) => (
            <span
              key={chip.label}
              className="glass-chip glass-chip-dark px-3.5 py-1.5 text-xs font-medium text-white/75"
            >
              <chip.icon className="h-3.5 w-3.5 text-[#67e8f9]" />
              {chip.label}
            </span>
          ))}
        </div>

        {/* 数据统计行 */}
        <div className="mb-12 flex items-center max-sm:gap-5">
          {stats.map((s, i) => (
            <div key={s.label} className="flex items-center">
              {i > 0 && (
                <span className="mx-8 h-9 w-px bg-gradient-to-b from-transparent via-white/25 to-transparent max-sm:mx-5" />
              )}
              <div className="text-center">
                <div className="font-display text-[28px] font-bold leading-none tracking-tight text-white">
                  {s.value}
                </div>
                <div className="mt-1.5 text-xs text-white/60">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 滚动提示 */}
        <a
          href="#tools"
          aria-label="向下滚动探索工具"
          className="flex flex-col items-center gap-2 text-white/60 no-underline transition-colors duration-300 hover:text-[#67e8f9]"
        >
          <span className="text-[11px] uppercase tracking-[0.2em]">探索工具</span>
          <ArrowDown className="h-4 w-4 animate-bounce" />
        </a>
      </div>
    </section>
  )
}
