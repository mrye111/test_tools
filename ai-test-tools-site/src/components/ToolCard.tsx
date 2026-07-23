import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, useMotionValue, useSpring } from 'motion/react'
import type { SpringOptions } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import type { Tool } from '../data/tools'

// 更 Q 弹的回弹手感：低阻尼 + 适中刚度
const springValues: SpringOptions = { damping: 16, stiffness: 140, mass: 1 }

// 图标瓷砖渐变色按卡片序号循环（青碧 / 青 / 薄荷 / 天蓝）
const TILE_GRADIENTS = [
  'from-accent via-accent-soft to-accent-blue',
  'from-accent-cyan to-accent-blue',
  'from-accent-mint to-accent',
  'from-accent-blue to-accent-cyan',
]

interface ToolCardProps {
  tool: Tool
  index?: number
}

export function ToolCard({ tool, index = 0 }: ToolCardProps) {
  const Icon = tool.icon
  const isInternal = tool.href.startsWith('/')
  const ref = useRef<HTMLDivElement>(null)

  const rotateX = useSpring(useMotionValue(0), springValues)
  const rotateY = useSpring(useMotionValue(0), springValues)
  const scale = useSpring(1, springValues)

  function handleMouseMove(e: React.MouseEvent<HTMLElement>) {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const offsetX = e.clientX - rect.left - rect.width / 2
    const offsetY = e.clientY - rect.top - rect.height / 2

    rotateX.set((offsetY / (rect.height / 2)) * -3)
    rotateY.set((offsetX / (rect.width / 2)) * 3)
  }

  function handleMouseEnter() {
    scale.set(1.012)
  }

  function handleMouseLeave() {
    scale.set(1)
    rotateX.set(0)
    rotateY.set(0)
  }

  const delayClass = `stagger-${Math.min(index + 1, 8)}`
  const tileGradient = TILE_GRADIENTS[index % TILE_GRADIENTS.length]

  const inner = (
    <motion.div
      ref={ref}
      className={`motion-card motion-card-hover-glow group flex min-h-[140px] flex-col justify-between rounded-[24px] px-5 py-4.5 text-left no-underline outline-none focus-visible:shadow-[0_0_0_4px_oklch(0.56_0.24_208/0.16)] max-sm:min-h-0 max-sm:gap-3 max-sm:rounded-[22px] ${delayClass}`}
      style={{
        perspective: 1000,
        transformStyle: 'preserve-3d',
        rotateX,
        rotateY,
        scale,
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Top row: icon + index */}
      <div className="relative z-[1] flex items-start justify-between gap-4">
        {/* 图标瓷砖：默认浅色底，hover 填充渐变 + 白图标 + 放大 */}
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-accent-muted text-accent shadow-[inset_0_1px_0_oklch(1_0_0/0.6)] transition-all duration-500 ease-[cubic-bezier(0.22,1.15,0.36,1)] group-hover:scale-110 group-hover:text-white group-hover:shadow-[0_14px_30px_-12px_oklch(0.56_0.24_208/0.55)]">
          <span
            className={`absolute inset-0 bg-gradient-to-br ${tileGradient} opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
          />
          <Icon className="relative h-[22px] w-[22px] stroke-[1.8] transition-transform duration-500 ease-[cubic-bezier(0.22,1.15,0.36,1)] group-hover:-rotate-6" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold tabular-nums text-[oklch(0.78_0.02_235)] transition-colors duration-300 group-hover:text-accent-soft">
            {String(index + 1).padStart(2, '0')}
          </span>
          <ArrowUpRight className="h-4 w-4 text-[oklch(0.78_0.02_235)] transition-all duration-500 ease-[cubic-bezier(0.22,1.15,0.36,1)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
        </div>
      </div>

      {/* Bottom row: title + description */}
      <div className="relative z-[1] mt-5 max-sm:mt-2">
        <div className="font-display text-[17px] font-semibold tracking-[-0.035em] text-fg transition-colors duration-300 group-hover:text-accent">
          {tool.title}
        </div>
        <div className="mt-1.5 line-clamp-2 min-h-[3.1em] text-[12.5px] leading-[1.55] text-muted">
          {tool.description}
        </div>
      </div>
    </motion.div>
  )

  if (isInternal) {
    return <Link to={tool.href} tabIndex={0} className="block">{inner}</Link>
  }

  return <a href={tool.href} tabIndex={0} className="block">{inner}</a>
}
