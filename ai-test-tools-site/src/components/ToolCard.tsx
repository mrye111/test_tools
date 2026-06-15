import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { Tool } from '../data/tools'

interface ToolCardProps {
  tool: Tool
  index?: number
}

export function ToolCard({ tool, index = 0 }: ToolCardProps) {
  const Icon = tool.icon
  const isInternal = tool.href.startsWith('/')
  const delayClass = `stagger-${Math.min(index + 1, 8)}`

  const className =
    `motion-card motion-card-hover-glow group flex min-h-[140px] flex-col justify-between rounded-[24px] px-5 py-4.5 text-left no-underline outline-none focus-visible:shadow-[0_0_0_4px_oklch(0.62_0.18_265/0.16)] max-sm:min-h-0 max-sm:gap-3 max-sm:rounded-[22px] ${delayClass}`

  const content = (
    <>
      {/* Top row: icon + index */}
      <div className="relative z-[1] flex items-start justify-between gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[oklch(0.62_0.18_265/0.07)] text-accent transition-all duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06] group-hover:bg-accent group-hover:text-white group-hover:shadow-[0_12px_28px_-16px_oklch(0.62_0.18_265/0.8)]">
          <Icon className="h-[22px] w-[22px] stroke-[1.8]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold tabular-nums text-[oklch(0.78_0.02_260)] transition-colors duration-300 group-hover:text-[oklch(0.62_0.18_265/0.5)]">
            {String(index + 1).padStart(2, '0')}
          </span>
          <ArrowUpRight className="h-4 w-4 text-[oklch(0.78_0.02_260)] transition-all duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
        </div>
      </div>

      {/* Bottom row: title + description */}
      <div className="relative z-[1] mt-5 max-sm:mt-2">
        <div className="font-display text-[17px] font-semibold tracking-[-0.035em] text-fg transition-colors duration-300 group-hover:text-accent">
          {tool.title}
        </div>
        <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-[1.55] text-muted">
          {tool.description}
        </div>
      </div>
    </>
  )

  if (isInternal) {
    return (
      <Link to={tool.href} className={className} tabIndex={0}>
        {content}
      </Link>
    )
  }

  return (
    <a href={tool.href} className={className} tabIndex={0}>
      {content}
    </a>
  )
}
