import { useRef } from 'react'
import { cubicBezier, motion, useScroll, useSpring, useTransform } from 'motion/react'
import type { Variants } from 'motion/react'
import { ArrowRight, Database, FileSearch, Sparkles } from 'lucide-react'
import { AuroraBackground } from './ui/aurora-background'
import { HeroVisual3D } from './HeroVisual3D'

// 全站统一的出场曲线：easeOutExpo，起势快、落点稳
const EASE_OUT_EXPO = cubicBezier(0.16, 1, 0.3, 1)

// 特性三件套：图标 + 标签 + 一句说明
const traits = [
  { icon: Sparkles, label: '智能生成', description: 'AI 自动生成测试脚本' },
  { icon: FileSearch, label: '需求分析', description: 'AI 拆解需求与风险' },
  { icon: Database, label: '数据工厂', description: '测试数据一站生成' },
]

// 入场编排：延迟 0.2s 开场，子元素每 0.1s 依次登台
const choreo: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } },
}

const riseUp: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.85, ease: EASE_OUT_EXPO } },
}

const badgeIn: Variants = {
  hidden: { opacity: 0, scale: 0.88, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.7, ease: EASE_OUT_EXPO } },
}

// 标题行掩码揭示：整行从遮罩下连贯升起（非逐字打字机）
const lineReveal: Variants = {
  hidden: { y: '112%' },
  show: { y: '0%', transition: { duration: 0.95, ease: EASE_OUT_EXPO } },
}

// Hero 左右分栏：左文案（徽章/标题/特性/描述/按钮），右动态视觉。
// 背景（极光）与动效体系（入场编排 + 滚动退出）保持不变
export function Hero() {
  const heroRef = useRef<HTMLElement>(null)

  // 滚动叙事：Hero 离屏过程中内容上浮、淡出并轻微内缩，
  // 进度经弹簧抹平，滚轮步进不会带来顿挫
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 })
  const exitOpacity = useTransform(smooth, [0, 0.7], [1, 0])
  const exitY = useTransform(smooth, [0, 1], [0, -72])
  const exitScale = useTransform(smooth, [0, 1], [1, 0.965])

  return (
    <motion.section
      ref={heroRef}
      className="hero"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.55, ease: 'easeOut' }}
    >
      {/* 高度账目：100dvh 撑满首屏 + 72px 补偿上探导航 + 64px 给 marquee 的 -mt-16 交叠；
          pt/pb 不对称（上小下大）让内容中心区上移，缩小与导航栏的空隙 */}
      <AuroraBackground
        role="region"
        aria-label="产品介绍"
        className="-mt-[72px] min-h-[calc(100dvh+136px)] overflow-hidden px-6 pb-[108px] pt-[84px] max-lg:px-4 max-sm:px-3 max-sm:pb-[84px] max-sm:pt-[76px]"
      >
        {/* 滚动退出层：仅 transform/opacity，合成器驱动 */}
        <motion.div
          className="relative z-[1] mx-auto grid w-full max-w-shell grid-cols-[1.02fr_0.98fr] items-center gap-12 max-lg:grid-cols-1 max-lg:gap-10"
          style={{ opacity: exitOpacity, y: exitY, scale: exitScale }}
        >
          {/* 左栏：入场编排层，与滚动层分离 */}
          <motion.div
            className="flex flex-col items-start text-left max-lg:items-center max-lg:text-center"
            variants={choreo}
            initial="hidden"
            animate="show"
          >
            {/* 徽章 */}
            <motion.div variants={badgeIn} className="glass-chip mb-7 px-4 py-1.5 text-[13px] font-medium text-accent">
              <span className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
              AI 测试工具平台
            </motion.div>

            {/* 主标题：AI 蓝色渐变 + 其余近黑，逐行掩码升起 */}
            <h1 className="mb-7 font-display text-[clamp(46px,6.4vw,76px)] font-[800] leading-[1.08] tracking-[-0.045em] text-fg">
              <span className="block overflow-hidden pb-[0.06em]">
                <motion.span variants={lineReveal} className="block will-change-transform">
                  <span className="bg-gradient-to-r from-[oklch(0.5_0.2_262)] to-[oklch(0.68_0.15_262)] bg-clip-text text-transparent">AI</span>测试工具
                </motion.span>
              </span>
              <span className="block overflow-hidden pb-[0.08em]">
                <motion.span variants={lineReveal} className="block will-change-transform">
                  一站生成
                </motion.span>
              </span>
            </h1>

            {/* 特性三件套：白底卡片与极光背景拉开对比 */}
            <motion.div variants={riseUp} className="mb-7 flex flex-wrap items-center gap-x-7 gap-y-3 rounded-2xl border border-white/70 bg-white/85 px-5 py-4 shadow-[0_20px_44px_-28px_oklch(0.45_0.1_262/0.4)] max-lg:justify-center">
              {traits.map((t) => (
                <span key={t.label} className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-muted text-accent">
                    <t.icon className="h-4 w-4 stroke-[1.8]" />
                  </span>
                  <span className="text-left">
                    <span className="block text-[13px] font-semibold text-fg">{t.label}</span>
                    <span className="block text-[11.5px] text-fg-soft">{t.description}</span>
                  </span>
                </span>
              ))}
            </motion.div>

            {/* 一句描述 */}
            <motion.p variants={riseUp} className="mb-9 max-w-[480px] text-[16px] leading-[1.8] text-fg-soft">
              让 AI 帮你写脚本、设计用例、分析数据，无需安装，即开即用。
            </motion.p>

            {/* CTA：扁平化双按钮 */}
            <motion.div variants={riseUp} className="flex items-center gap-4 max-sm:w-full max-sm:flex-col">
              <a href="#tools" className="primary-action px-7 py-3 text-[15px] max-sm:w-full">
                立即开始
                <ArrowRight className="h-4 w-4" />
              </a>
              <a href="#tools" className="secondary-action px-7 py-3 text-[15px] max-sm:w-full">
                了解功能
                <Sparkles className="h-4 w-4" />
              </a>
            </motion.div>
          </motion.div>

          {/* 右栏：动态视觉，最后登场（缩放+上浮，与编排同一曲线） */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.55, ease: EASE_OUT_EXPO }}
            className="max-lg:mx-auto max-lg:w-full max-lg:max-w-[520px]"
          >
            <HeroVisual3D />
          </motion.div>
        </motion.div>
      </AuroraBackground>
    </motion.section>
  )
}
