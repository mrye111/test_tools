/**
 * 会话视图：消息流 + 沉底输入框 + 文件卡片。
 */

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useChatStream } from './useChatStream'
import { ChatComposer } from './ChatComposer'
import { MessageBubble } from './MessageBubble'
import { AGENT_TEMPLATES } from './agent-templates'
import type { AgentTemplate } from './agent-templates'

export function ChatView() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const { messages, streaming, send, retry, loadHistory } = useChatStream(sessionId)

  const [text, setText] = useState('')
  // useChatStream 未暴露会话 agentTemplate，默认 'mindmap'；T14 再做模板切换。
  const selectedTemplate = useState<AgentTemplate>('mindmap')[0]
  const messagesRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const prevMessageCountRef = useRef(messages.length)

  // 挂载或 sessionId 变化时加载历史
  useEffect(() => {
    loadHistory()
  }, [loadHistory, sessionId])

  // 自动滚动到底部：新增消息或流式中，且用户未上翻超过 100px
  useEffect(() => {
    const container = messagesRef.current
    const bottom = bottomRef.current
    if (!container || !bottom) return

    const isNearBottom = () => {
      return container.scrollHeight - container.scrollTop - container.clientHeight <= 100
    }

    if (messages.length !== prevMessageCountRef.current || streaming) {
      if (nearBottomRef.current) {
        bottom.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }
      prevMessageCountRef.current = messages.length
    }

    const handleScroll = () => {
      nearBottomRef.current = isNearBottom()
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [messages.length, streaming])

  const handleSubmit = async () => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setText('')
    await send(trimmed, selectedTemplate)
  }

  return (
    <div className="ra-chat-view flex h-full flex-col">
      <div
        ref={messagesRef}
        className="ra-chat-messages flex-1 overflow-y-auto px-4 py-6"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onRetry={message.status === 'error' ? retry : undefined}
          />
        ))}
        <div ref={bottomRef} className="ra-chat-messages-anchor" />
      </div>

      <div className="ra-chat-composer-wrapper">
        <ChatComposer
          value={text}
          onChange={setText}
          template={selectedTemplate}
          templates={AGENT_TEMPLATES}
          onSubmit={handleSubmit}
          disabled={streaming}
          size="compact"
        />
      </div>
    </div>
  )
}
