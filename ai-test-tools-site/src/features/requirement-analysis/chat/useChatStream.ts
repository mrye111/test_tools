/**
 * 聊天流式状态核心 hook。
 * 维护本地消息视图、SSE 消费、重试与历史加载。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
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
  agentTemplate: AgentTemplate
  files: Array<SessionFileSummary & { savedToLibrary: boolean }>
}

/** 用于记录每一轮用户请求所选的模板,retry 时需要从残骸中还原。 */
interface RoundMeta {
  userMessageId: string
  template: AgentTemplate
}

interface State {
  messages: ChatMessageView[]
  rounds: RoundMeta[]
  streaming: boolean
  error: string | null
  lastSessionId: string | null
}

type Action =
  | { type: 'appendUser'; message: ChatMessageView; template: AgentTemplate }
  | { type: 'appendAssistant'; message: ChatMessageView }
  | { type: 'streamAppend'; kind: 'content' | 'reasoning' | 'notice'; text: string }
  | { type: 'appendFile'; file: ChatMessageView['files'][number] }
  | { type: 'finalize'; status: MessageStatus }
  | { type: 'setError'; error: string }
  | { type: 'setMessages'; messages: ChatMessageView[]; rounds?: RoundMeta[] }
  | { type: 'setSessionId'; sessionId: string }

function createUserMessage(text: string, template: AgentTemplate): ChatMessageView {
  return {
    id: `local_${crypto.randomUUID()}`,
    role: 'user',
    content: text,
    reasoning: null,
    status: 'done',
    agentTemplate: template,
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
    agentTemplate: 'mindmap',
    files: [],
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'appendUser': {
      const round: RoundMeta = { userMessageId: action.message.id, template: action.template }
      return {
        ...state,
        messages: [...state.messages, action.message],
        rounds: [...state.rounds, round],
        streaming: true,
        error: null,
      }
    }
    case 'appendAssistant': {
      const lastRound = state.rounds[state.rounds.length - 1]
      const assistant: ChatMessageView = lastRound
        ? { ...action.message, agentTemplate: lastRound.template }
        : action.message
      const nextMessages = [...state.messages, assistant]
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
        ? state.messages.map((m, i) => (i === index ? { ...m, status: 'error' as const } : m))
        : state.messages
      return { ...state, messages: nextMessages, streaming: false, error: action.error }
    }
    case 'setMessages':
      return {
        ...state,
        messages: action.messages,
        rounds: action.rounds ?? [],
        streaming: false,
        error: null,
      }
    case 'setSessionId':
      return {
        ...state,
        lastSessionId: action.sessionId,
      }
    default:
      return state
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '请求失败')
}

function mapServerMessageToView(
  message: {
    id: string
    role: MessageRole
    content: string
    reasoning: string | null
    status: MessageStatus
    files: Array<{ sessionFileId: string; kind: AgentTemplate; title: string }>
  },
  defaultTemplate: AgentTemplate,
): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
    status: message.status,
    agentTemplate: defaultTemplate,
    files: message.files.map((f) => ({ ...f, savedToLibrary: false })),
  }
}

export interface UseChatStreamReturn {
  messages: ChatMessageView[]
  streaming: boolean
  error: string | null
  lastSessionId: string | null
  send: (text: string, template: AgentTemplate) => Promise<void>
  retry: (messageId: string) => Promise<void>
  loadHistory: () => Promise<void>
}

export function useChatStream(sessionId?: string): UseChatStreamReturn {
  const [state, dispatch] = useReducer(reducer, {
    messages: [],
    rounds: [],
    streaming: false,
    error: null,
    lastSessionId: null,
  })

  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const aiConfigRef = useRef<RuntimeAiConfig | null>(null)

  const ensureAiConfig = useCallback((): RuntimeAiConfig => {
    if (aiConfigRef.current) return aiConfigRef.current
    const stored = loadStoredModelConfig()
    if (!stored) throw new Error('请先在模型设置中配置统一供应商')
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
    } else if (event.type === 'session') {
      dispatch({ type: 'setSessionId', sessionId: event.id })
    }
  }, [])

  const sendRound = useCallback(async (text: string, template: AgentTemplate) => {
    const config = ensureAiConfig()

    const userMessage = createUserMessage(text, template)
    const assistantMessage = createAssistantPlaceholder()

    dispatch({ type: 'appendUser', message: userMessage, template })
    dispatch({ type: 'appendAssistant', message: assistantMessage })

    try {
      const turnResult = await chatStream(
        { sessionId: sessionIdRef.current, agentTemplate: template, text },
        config,
        handleEvent,
      )
      if (turnResult.sessionId) {
        dispatch({ type: 'setSessionId', sessionId: turnResult.sessionId })
      }
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
    const round = state.rounds.find((r) => r.userMessageId === userMessage.id)
    await sendRound(userMessage.content, round?.template ?? 'mindmap')
  }, [sendRound, state.messages, state.rounds])

  const loadHistory = useCallback(async () => {
    if (!sessionIdRef.current) return
    try {
      const data = await getSession(sessionIdRef.current)
      const defaultTemplate = data.session.agentTemplate
      const messages = data.messages.map((m) => mapServerMessageToView(m, defaultTemplate))
      // 服务端历史没有 template 记录，按 session.agentTemplate 兜底重建 rounds，
      // 保证后续 retry 能取到模板。
      const rounds: RoundMeta[] = messages
        .filter((m) => m.role === 'user')
        .map((m) => ({ userMessageId: m.id, template: defaultTemplate }))
      dispatch({ type: 'setMessages', messages, rounds })
    } catch (error: unknown) {
      dispatch({ type: 'setError', error: getErrorMessage(error) })
    }
  }, [])

  return useMemo(() => ({
    messages: state.messages,
    streaming: state.streaming,
    error: state.error,
    lastSessionId: state.lastSessionId,
    send,
    retry,
    loadHistory,
  }), [state.messages, state.streaming, state.error, state.lastSessionId, send, retry, loadHistory])
}
