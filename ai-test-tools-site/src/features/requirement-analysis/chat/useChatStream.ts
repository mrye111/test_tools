/**
 * 聊天流式状态核心 hook。
 * 维护本地消息视图、SSE 消费、重试与历史加载。
 */

import { useCallback, useMemo, useReducer, useRef } from 'react'
import { chatStream, getSession } from './chat-api'
import type { AgentTemplate, ChatStreamEvent, MessageRole, MessageStatus, SessionFileSummary } from './chat-api'
import { loadStoredModelConfig } from '../../../lib/model-config-store'
import { toAiConfig } from '../../../shared/api-types'
import type { RuntimeAiConfig } from '../../../shared/api-types'

export interface ChatMessageView {
  id: string
  role: MessageRole
  content: string
  reasoning: string | null
  status: MessageStatus
  files: Array<SessionFileSummary & { savedToLibrary: boolean }>
}

interface State {
  messages: ChatMessageView[]
  streaming: boolean
  error: string | null
}

type Action =
  | { type: 'appendUser'; message: ChatMessageView }
  | { type: 'appendAssistant'; message: ChatMessageView }
  | { type: 'streamAppend'; kind: 'content' | 'reasoning' | 'notice'; text: string }
  | { type: 'appendFile'; file: ChatMessageView['files'][number] }
  | { type: 'finalize'; status: MessageStatus }
  | { type: 'setError'; error: string }
  | { type: 'setMessages'; messages: ChatMessageView[] }

function createUserMessage(text: string): ChatMessageView {
  return {
    id: `local_${crypto.randomUUID()}`,
    role: 'user',
    content: text,
    reasoning: null,
    status: 'done',
    files: [],
  }
}

function createAssistantPlaceholder(): ChatMessageView {
  return {
    id: `local_${crypto.randomUUID()}`,
    role: 'assistant',
    content: '',
    reasoning: null,
    status: 'streaming',
    files: [],
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'appendUser':
      return { ...state, messages: [...state.messages, action.message], streaming: true, error: null }
    case 'appendAssistant': {
      const nextMessages = [...state.messages, action.message]
      return { ...state, messages: nextMessages }
    }
    case 'streamAppend': {
      const index = state.messages.findLastIndex((m) => m.role === 'assistant')
      if (index < 0) return state
      const target = state.messages[index]
      let nextContent = target.content
      let nextReasoning = target.reasoning
      if (action.kind === 'content') {
        nextContent = nextContent + action.text
      } else if (action.kind === 'reasoning') {
        nextReasoning = (nextReasoning ?? '') + action.text
      } else if (action.kind === 'notice') {
        nextContent = nextContent ? `${nextContent}\n\n${action.text}` : action.text
      }
      const updated: ChatMessageView = { ...target, content: nextContent, reasoning: nextReasoning }
      return { ...state, messages: state.messages.map((m, i) => (i === index ? updated : m)) }
    }
    case 'appendFile': {
      const index = state.messages.findLastIndex((m) => m.role === 'assistant')
      if (index < 0) return state
      const target = state.messages[index]
      const updated: ChatMessageView = { ...target, files: [...target.files, action.file] }
      return { ...state, messages: state.messages.map((m, i) => (i === index ? updated : m)) }
    }
    case 'finalize': {
      const index = state.messages.findLastIndex((m) => m.role === 'assistant')
      if (index < 0) return state
      const updated: ChatMessageView = { ...state.messages[index], status: action.status }
      return { ...state, messages: state.messages.map((m, i) => (i === index ? updated : m)), streaming: false }
    }
    case 'setError': {
      const index = state.messages.findLastIndex((m) => m.role === 'assistant')
      const nextMessages = index >= 0
        ? state.messages.map((m, i) => (i === index ? { ...m, status: 'error' as MessageStatus } : m))
        : state.messages
      return { ...state, messages: nextMessages, streaming: false, error: action.error }
    }
    case 'setMessages':
      return { ...state, messages: action.messages, streaming: false, error: null }
    default:
      return state
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '请求失败')
}

function mapServerMessageToView(message: {
  id: string
  role: MessageRole
  content: string
  reasoning: string | null
  status: MessageStatus
  files: Array<{ sessionFileId: string; kind: AgentTemplate; title: string }>
}): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
    status: message.status,
    files: message.files.map((f) => ({ ...f, savedToLibrary: false })),
  }
}

export interface UseChatStreamReturn {
  messages: ChatMessageView[]
  streaming: boolean
  error: string | null
  send: (text: string, template: AgentTemplate) => Promise<void>
  retry: (messageId: string) => Promise<void>
  loadHistory: () => Promise<void>
}

export function useChatStream(sessionId?: string): UseChatStreamReturn {
  const [state, dispatch] = useReducer(reducer, {
    messages: [],
    streaming: false,
    error: null,
  })

  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const aiConfigRef = useRef<RuntimeAiConfig | null>(null)

  const ensureAiConfig = useCallback((): RuntimeAiConfig => {
    if (aiConfigRef.current) return aiConfigRef.current
    const stored = loadStoredModelConfig()
    if (!stored) throw new Error('模型配置未找到，请先在设置中配置模型')
    aiConfigRef.current = toAiConfig(stored)
    return aiConfigRef.current
  }, [])

  const handleEvent = useCallback((event: ChatStreamEvent) => {
    if (event.type === 'stream') {
      dispatch({ type: 'streamAppend', kind: event.kind, text: event.text })
    } else if (event.type === 'file') {
      dispatch({ type: 'appendFile', file: { sessionFileId: event.sessionFileId, kind: event.kind, title: event.title, savedToLibrary: false } })
    } else if (event.type === 'message') {
      dispatch({ type: 'finalize', status: event.status })
    } else if (event.type === 'error') {
      dispatch({ type: 'setError', error: event.message })
    }
  }, [])

  const sendRound = useCallback(async (text: string, template: AgentTemplate) => {
    const config = ensureAiConfig()

    const userMessage = createUserMessage(text)
    const assistantMessage = createAssistantPlaceholder()

    dispatch({ type: 'appendUser', message: userMessage })
    dispatch({ type: 'appendAssistant', message: assistantMessage })

    try {
      await chatStream(
        { sessionId: sessionIdRef.current, agentTemplate: template, text },
        config,
        handleEvent,
      )
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      dispatch({ type: 'setError', error: message })
    }
  }, [ensureAiConfig, handleEvent])

  const send = useCallback(async (text: string, template: AgentTemplate) => {
    await sendRound(text, template)
  }, [sendRound])

  const retry = useCallback(async (messageId: string) => {
    const index = state.messages.findIndex((m) => m.id === messageId)
    if (index < 0) return

    // 找到该 error assistant 消息前一条 user 消息
    let userIndex = -1
    for (let i = index - 1; i >= 0; i--) {
      if (state.messages[i].role === 'user') {
        userIndex = i
        break
      }
    }
    if (userIndex < 0) return

    const userMessage = state.messages[userIndex]
    // 记录重发所用的模板：无法从残骸中复原，需外部约定。
    // 这里使用 'mindmap' 作为兜底，后续由 ChatView 维护最后选择的模板。
    await sendRound(userMessage.content, 'mindmap')
  }, [sendRound, state.messages])

  const loadHistory = useCallback(async () => {
    if (!sessionIdRef.current) return
    const data = await getSession(sessionIdRef.current)
    const messages = data.messages.map(mapServerMessageToView)
    dispatch({ type: 'setMessages', messages })
  }, [])

  return useMemo(() => ({
    messages: state.messages,
    streaming: state.streaming,
    error: state.error,
    send,
    retry,
    loadHistory,
  }), [state, send, retry, loadHistory])
}
