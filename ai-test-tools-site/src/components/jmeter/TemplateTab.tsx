import { useState } from 'react'
import { jmeterTemplates, type JmeterTemplate } from '../../data/jmeter-templates'
import { TemplateConfig } from './TemplateConfig'

export function TemplateTab() {
  const [selected, setSelected] = useState<JmeterTemplate | null>(null)

  if (selected) {
    return <TemplateConfig template={selected} onBack={() => setSelected(null)} />
  }

  const common = jmeterTemplates.filter((t) => t.category === 'common')
  const advanced = jmeterTemplates.filter((t) => t.category === 'advanced')
  const blank = jmeterTemplates.filter((t) => t.category === 'blank')

  return (
    <div>
      <h2 className="mb-6 font-display text-xl font-semibold tracking-[-0.035em] text-fg">
        选择测试模板
      </h2>

      {/* Common Templates */}
      <div className="mb-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted">常用模板</h3>
        <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {common.map((t) => (
            <TemplateCard key={t.id} template={t} onClick={() => setSelected(t)} />
          ))}
        </div>
      </div>

      {/* Advanced Templates */}
      <div className="mb-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted">高级模板</h3>
        <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {advanced.map((t) => (
            <TemplateCard key={t.id} template={t} onClick={() => setSelected(t)} />
          ))}
        </div>
      </div>

      {/* Blank Template */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted">空白模板</h3>
        <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {blank.map((t) => (
            <TemplateCard key={t.id} template={t} onClick={() => setSelected(t)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TemplateCard({ template, onClick }: { template: JmeterTemplate; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="motion-card group flex items-start gap-3 rounded-2xl p-4 text-left"
    >
      <span className="relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(37,99,235,0.08)] font-mono text-[11px] font-bold tracking-[-0.04em] text-accent transition-all duration-300 group-hover:bg-accent group-hover:text-white">
        {template.icon}
      </span>
      <div className="min-w-0">
        <div className="relative z-[1] text-sm font-semibold text-fg transition-colors group-hover:text-accent">
          {template.name}
        </div>
        <div className="relative z-[1] mt-1 text-xs leading-relaxed text-muted">
          {template.description}
        </div>
        <div className="relative z-[1] mt-2 inline-block rounded-full bg-[rgba(37,99,235,0.08)] px-2 py-0.5 text-[10px] font-medium text-accent">
          {template.samplerType}
        </div>
      </div>
    </button>
  )
}
