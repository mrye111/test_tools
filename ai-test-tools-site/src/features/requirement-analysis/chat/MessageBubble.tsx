/**
 * 消息气泡：用户渐变气泡 / 助手正文 + 折叠 reasoning + 文件卡片。
 */

import { useState } from 'react'
import { FileCard } from './FileCard'
import type { ChatMessageView } from './useChatStream'

interface MessageBubbleProps {
  message: ChatMessageView
  onRetry?: (messageId: string) => void
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const hasReasoning = !!message.reasoning
  const isError = message.status === 'error'
  const isStreaming = message.status === 'streaming'
  const [showReasoning, setShowReasoning] = useState(false)

  return (
    <div
      className={`ra-chat-bubble ${isUser ? 'ra-chat-bubble-user' : 'ra-chat-bubble-assistant'} ${isError ? 'ra-chat-bubble-error' : ''}`}
      data-status={message.status}
    >
      <div className="ra-chat-bubble-content">
        {isUser ? (
          <div className="ra-chat-bubble-user-text">{message.content}</div>
        ) : (
          <>
            <div className="ra-chat-bubble-assistant-text">
              {message.content}
              {isStreaming && <span className="ra-chat-bubble-cursor" />}
            </div>

            {hasReasoning && (
              <details
                className="ra-chat-bubble-reasoning"
                open={showReasoning}
                onToggle={(event) => setShowReasoning(event.currentTarget.open)}
              >
                <summary className="ra-chat-bubble-reasoning-summary">思考过程</summary>
                <div className="ra-chat-bubble-reasoning-body">{message.reasoning}</div>
              </details>
            )}

            {isError && (
              <div className="ra-chat-bubble-error-bar">
                <span className="ra-chat-bubble-error-text">生成中断</span>
                {onRetry && (
                  <button
                    type="button"
                    className="ra-chat-bubble-retry"
                    onClick={() => onRetry(message.id)}
                  >
                    重试
                  </button>
                )}
              </div>
            )}

            {message.files.length > 0 && (
              <div className="ra-chat-bubble-files">
                {message.files.map((file) => (
                  <FileCard key={file.sessionFileId} file={file} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
