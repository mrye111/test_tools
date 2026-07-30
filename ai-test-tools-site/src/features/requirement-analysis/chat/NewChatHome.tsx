import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStream } from './useChatStream'
import { ChatComposer } from './ChatComposer'
import { AgentTemplateChips } from './AgentTemplateChips'
import { TemplateCenterModal } from '../TemplateCenterModal'
import { AGENT_TEMPLATES, type AgentTemplate } from './agent-templates'

interface ExampleItem {
  title: string
  prompt: string
}

const EXAMPLES: ExampleItem[] = [
  {
    title: '电商下单流程的异常场景分析',
    prompt: '分析电商下单流程中库存不足、支付失败、地址异常等场景，并输出因果图。',
  },
  {
    title: '登录功能的等价类与边界值',
    prompt: '为登录功能设计等价类划分与边界值分析，生成判定表与测试用例。',
  },
  {
    title: '订单状态迁移流程图',
    prompt: '梳理订单从创建到完成/取消的状态迁移，绘制主流程图。',
  },
  {
    title: '接口测试场景脑图',
    prompt: '围绕接口测试场景，梳理参数校验、性能、安全等维度，生成思维导图。',
  },
]

/**
 * 新聊天首页：问候语 + 大输入框 + 智能体模板 chips + 示例卡片。
 * 提交后由 useChatStream 的 lastSessionId 导航到会话视图。
 */
export function NewChatHome() {
  const navigate = useNavigate()
  const { send, streaming, lastSessionId } = useChatStream()
  const [text, setText] = useState('')
  const [template, setTemplate] = useState<AgentTemplate>('mindmap')
  const [modalOpen, setModalOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // 由于 send 触发 re-render，闭包中的 lastSessionId 可能 stale，
  // 用 ref 跟踪最新 hook 状态，确保发送完成后能立即拿到 sessionId。
  const lastSessionIdRef = useRef(lastSessionId)
  useEffect(() => {
    lastSessionIdRef.current = lastSessionId
  }, [lastSessionId])

  const handleSubmit = useCallback(async () => {
    if (!text.trim() || streaming) return
    setSubmitError(null)
    try {
      await send(text.trim(), template)
      const sessionId = lastSessionIdRef.current
      if (sessionId) {
        navigate(`/requirement-analysis/chat/${sessionId}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '发送失败，请重试'
      setSubmitError(message)
    }
  }, [text, streaming, send, template, navigate])

  const handleExampleClick = useCallback((prompt: string) => {
    setText(prompt)
  }, [])

  const handleTemplateSelect = useCallback((next: AgentTemplate) => {
    setTemplate(next)
  }, [])

  return (
    <div className="ra-newchat">
      <div className="ra-newchat-hero">
        <h1 className="ra-newchat-title">你好，开始一次需求分析</h1>
        <p className="ra-newchat-subtitle">选择智能体模板，输入需求，AI 为你产出测试设计图表</p>
      </div>

      <div className="ra-newchat-composer">
        <AgentTemplateChips
          selected={template}
          onSelect={handleTemplateSelect}
          onMore={() => setModalOpen(true)}
        />
        <ChatComposer
          value={text}
          onChange={setText}
          template={template}
          templates={AGENT_TEMPLATES}
          onSubmit={handleSubmit}
          disabled={streaming}
          size="large"
        />
      </div>

      <div className="ra-newchat-examples">
        <p className="ra-newchat-examples-title">试试这些示例</p>
        <div className="ra-newchat-examples-grid" role="list">
          {EXAMPLES.map((example) => (
            <button
              key={example.title}
              type="button"
              role="listitem"
              className="ra-example-card"
              onClick={() => handleExampleClick(example.prompt)}
            >
              <span className="ra-example-card-title">{example.title}</span>
            </button>
          ))}
        </div>
      </div>

      {submitError && <p className="ra-newchat-error">{submitError}</p>}

      <TemplateCenterModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
