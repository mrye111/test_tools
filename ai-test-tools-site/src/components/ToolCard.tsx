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
  const delayClass = `stagger-${Math.min(index + 1, 6)}`

  const className =
    `motion-card group flex min-h-[124px] flex-col justify-between rounded-[22px] px-5 py-4 text-left no-underline outline-none focus-visible:shadow-[0_0_0_4px_rgba(37,99,235,0.16)] max-sm:min-h-0 max-sm:gap-3 max-sm:rounded-[20px] ${delayClass}`

  const content = (
    <>
      <div className="relative z-[1] flex items-start justify-between gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(37,99,235,0.08)] text-accent transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04] group-hover:bg-accent group-hover:text-white">
          <Icon className="h-[21px] w-[21px] stroke-[1.8]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-slate-300">0{index + 1}</span>
          <ArrowUpRight className="h-4 w-4 text-slate-300 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
        </div>
      </div>

      <div className="relative z-[1] mt-4 max-sm:mt-1">
        <div className="font-display text-[16px] font-semibold tracking-[-0.03em] text-fg">
          {tool.title}
        </div>
        <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
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
