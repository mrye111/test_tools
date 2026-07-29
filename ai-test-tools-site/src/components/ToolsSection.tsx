import { cubicBezier, motion } from 'motion/react'
import type { Variants } from 'motion/react'
import { tools } from '../data/tools'
import { ToolCard } from './ToolCard'

const EASE_OUT_EXPO = cubicBezier(0.16, 1, 0.3, 1)

// 头部编排：chip → 标题两行掩码揭示 → 副文案，滚动进入视口触发一次
const headerChoreo: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.11, delayChildren: 0.05 } },
}

const riseUp: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.75, ease: EASE_OUT_EXPO } },
}

const lineReveal: Variants = {
  hidden: { y: '112%' },
  show: { y: '0%', transition: { duration: 0.85, ease: EASE_OUT_EXPO } },
}

export function ToolsSection() {
  return (
    <section id="tools" className="relative mx-auto max-w-shell scroll-mt-28 px-6 pb-24 max-lg:px-4 max-sm:px-3">
      {/* 顶部青光：Hero 舞台光晕在浅色区的回声，衔接上下两个区域 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 left-1/2 h-[340px] w-[760px] -translate-x-1/2 bg-[radial-gradient(ellipse,oklch(0.74_0.13_262/0.15),transparent_65%)]"
      />

      {/* Section 头部 */}
      <motion.div
        className="relative mx-auto mb-12 max-w-[640px] text-center"
        variants={headerChoreo}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '0px 0px -18% 0px' }}
      >
        <motion.div variants={riseUp}>
          <span className="glass-chip mb-5 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            工具矩阵
          </span>
        </motion.div>
        <h2 className="font-display text-[clamp(30px,4.5vw,44px)] font-bold leading-[1.15] tracking-[-0.04em] text-fg">
          <span className="block overflow-hidden pb-[0.08em]">
            <motion.span variants={lineReveal} className="block will-change-transform">
              测试全流程
            </motion.span>
          </span>
          <span className="block overflow-hidden pb-[0.1em]">
            <motion.span variants={lineReveal} className="block will-change-transform">
              一站搞定
            </motion.span>
          </span>
        </h2>
        <motion.p variants={riseUp} className="mt-4 text-[15px] leading-[1.8] text-muted">
          从脚本生成到报告分析，每个环节都有 AI 搭把手，点开即用。
        </motion.p>
      </motion.div>

      <div className="grid grid-cols-3 gap-5 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {tools.map((tool, index) => (
          <ToolCard key={tool.id} tool={tool} index={index} />
        ))}
      </div>
    </section>
  )
}
