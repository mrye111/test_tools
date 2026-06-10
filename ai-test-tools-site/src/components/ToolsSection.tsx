import { tools } from '../data/tools'
import { ToolCard } from './ToolCard'

export function ToolsSection() {
  return (
    <section id="tools" className="mx-auto max-w-[1080px] px-6 pb-16 max-lg:px-4 max-sm:px-3">
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {tools.map((tool, index) => (
          <ToolCard key={tool.id} tool={tool} index={index} />
        ))}
      </div>
    </section>
  )
}
