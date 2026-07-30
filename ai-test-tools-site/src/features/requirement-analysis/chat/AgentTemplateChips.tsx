import { ChevronRight } from 'lucide-react'
import { AGENT_TEMPLATES, type AgentTemplate, type AgentTemplateMeta } from './agent-templates'

interface AgentTemplateChipsProps {
  selected: AgentTemplate
  onSelect: (template: AgentTemplate) => void
  onMore: () => void
  templates?: AgentTemplateMeta[]
}

/**
 * 智能体模板胶囊列表。
 * 展示默认五项模板，支持选中态高亮；末尾“更多智能体”打开模板中心。
 */
export function AgentTemplateChips({
  selected,
  onSelect,
  onMore,
  templates = AGENT_TEMPLATES,
}: AgentTemplateChipsProps) {
  return (
    <div className="ra-chat-chips" role="list" aria-label="智能体模板">
      {templates.map((template) => {
        const Icon = template.icon
        const isSelected = selected === template.kind
        return (
          <button
            key={template.kind}
            type="button"
            role="listitem"
            className={`ra-chat-chip${isSelected ? ' is-selected' : ''}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(template.kind)}
          >
            <span className={`ra-chat-chip-icon bg-gradient-to-r ${template.gradient}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="ra-chat-chip-label">{template.label}</span>
          </button>
        )
      })}

      <button
        type="button"
        className="ra-chat-chip ra-chat-chip-more"
        onClick={onMore}
        aria-label="更多智能体"
      >
        <span className="ra-chat-chip-label">更多智能体</span>
        <ChevronRight className="ra-chat-chip-more-icon" />
      </button>
    </div>
  )
}
