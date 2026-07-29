import { Link } from 'react-router-dom'
import { cubicBezier, motion } from 'motion/react'
import type { Variants } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import type { Tool } from '../data/tools'
import { ToolStage } from './tool-stages'

const EASE_OUT_EXPO = cubicBezier(0.16, 1, 0.3, 1)

// 卡片内部编排：外层卡片先落定，随后序号行 → 分割线 → 标题揭示 → 描述 → 舞台入坞
const cardChoreo: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.18 } },
}

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT_EXPO } },
}

const titleReveal: Variants = {
  hidden: { y: '110%' },
  show: { y: '0%', transition: { duration: 0.7, ease: EASE_OUT_EXPO } },
}

// 舞台从卡片底边「入坞」：比文字晚半拍，像迷你应用被插进卡槽
const stageDock: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.75, ease: EASE_OUT_EXPO } },
}

interface ToolCardProps {
  tool: Tool
  index?: number
}

// 扁平大卡片（千问办公式）：序号+标签+分割线、大标题、描述、底部探出实时动画舞台
export function ToolCard({ tool, index = 0 }: ToolCardProps) {
  const Icon = tool.icon
  const isInternal = tool.href.startsWith('/')

  const card = (
    <motion.div
      initial={{ opacity: 0, y: 42, scale: 0.965 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.85, delay: Math.min(index * 0.1, 0.5), ease: EASE_OUT_EXPO }}
      className="h-full will-change-transform"
    >
      <motion.div
        variants={cardChoreo}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '0px 0px -10% 0px' }}
        className="flat-tool-card group p-6 pb-0"
      >
        {/* 序号 + 标签 */}
        <motion.div variants={rise} className="flex items-baseline justify-between">
          <span className="font-mono text-xs font-semibold tabular-nums text-muted">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-muted">
            <Icon className="h-3.5 w-3.5" />
            {tool.tag}
          </span>
        </motion.div>
        <motion.span variants={rise} className="mt-3 block border-t border-border" />

        {/* 标题：整行掩码揭示 */}
        <span className="mt-5 block overflow-hidden">
          <motion.span variants={titleReveal} className="flex items-center justify-between gap-3 will-change-transform">
            <span className="font-display text-[22px] font-bold tracking-[-0.03em] text-fg transition-colors duration-300 group-hover:text-accent">
              {tool.title}
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-all duration-300 group-hover:border-accent group-hover:bg-accent group-hover:text-white">
              <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </motion.span>
        </span>

        {/* 描述 */}
        <motion.p variants={rise} className="mt-2.5 text-[13px] leading-[1.7] text-muted">
          {tool.description}
        </motion.p>

        {/* 实时动画舞台：贴底探出 */}
        <motion.div variants={stageDock} className="mt-auto pt-6">
          <div className="flat-tool-stage" aria-hidden="true">
            <ToolStage id={tool.id} />
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  )

  if (isInternal) {
    return <Link to={tool.href} tabIndex={0} className="block h-full">{card}</Link>
  }

  return <a href={tool.href} tabIndex={0} className="block h-full">{card}</a>
}
