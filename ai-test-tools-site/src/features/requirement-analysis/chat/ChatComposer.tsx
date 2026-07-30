import { useRef, useCallback, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'
import type { AgentTemplate, AgentTemplateMeta } from './agent-templates'

export type ComposerSize = 'large' | 'compact'

interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  template: AgentTemplate
  templates: AgentTemplateMeta[]
  onSubmit: () => void
  disabled?: boolean
  size?: ComposerSize
}

/**
 * 聊天输入框（受控复用）。
 * 大形态用于新聊天首页，紧凑形态用于会话视图。
 * Enter 发送，Shift+Enter 换行；流式中禁用。
 */
export function ChatComposer(props: ChatComposerProps) {
  const { value, onChange, template, templates, onSubmit, disabled = false, size = 'compact' } = props
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 多行文本框自动增高
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !disabled) {
      event.preventDefault()
      if (value.trim()) {
        onSubmit()
      }
    }
  }, [disabled, value, onSubmit])

  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value)
  }, [onChange])

  const currentTemplate = templates.find((t) => t.kind === template)
  const isLarge = size === 'large'

  return (
    <div
      className={`ra-chat-composer ${isLarge ? 'ra-chat-composer-large' : 'ra-chat-composer-compact'}`}
      data-disabled={disabled}
    >
      <textarea
        ref={textareaRef}
        className="ra-chat-composer-input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="输入你要分析的需求，或粘贴需求文档文本"
        rows={isLarge ? 4 : 2}
        disabled={disabled}
        aria-label="需求分析输入框"
      />

      <div className="ra-chat-composer-footer">
        <div className="ra-chat-composer-meta">
          {currentTemplate ? (
            <>
              <span className={`ra-chat-composer-dot bg-gradient-to-r ${currentTemplate.gradient}`} />
              <span className="ra-chat-composer-template-name">{currentTemplate.label}</span>
            </>
          ) : (
            <span className="ra-chat-composer-template-name">智能助手</span>
          )}
        </div>

        <button
          type="button"
          className="ra-chat-composer-send"
          aria-label="发送"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
        >
          {disabled ? (
            <Loader2 className="ra-chat-composer-send-icon animate-spin" />
          ) : (
            <Send className="ra-chat-composer-send-icon" />
          )}
        </button>
      </div>
    </div>
  )
}
