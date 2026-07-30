/**
 * 需求分析 Chat 域前端 API 封装。
 * 包含 SSE 对话流 chatStream 与 REST 会话 / 文件库接口。
 */

import { buildUrl, parseJson } from '../../../lib/httpClient'
import type { RuntimeAiConfig } from '../../../shared/api-types'
import type { AgentTemplate } from './agent-templates'

/** 消息角色 */
export type MessageRole = 'user' | 'assistant'

/** 消息状态 */
export type MessageStatus = 'streaming' | 'done' | 'error'

/** 会话 */
export interface ChatSession {
  id: string
  title: string
  agentTemplate: AgentTemplate
  createdAt: Date
  updatedAt: Date
}

/** 会话中的消息（服务端 dates 序列化为 ISO 字符串，前端消费为 Date）。 */
export interface ChatMessage {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  reasoning: string | null
  status: MessageStatus
  createdAt: Date
}

/** 与会话消息关联的文件摘要 */
export interface SessionFileSummary {
  sessionFileId: string
  kind: AgentTemplate
  title: string
}

/** 会话文件详情 */
export interface SessionFile {
  id: string
  sessionId: string
  messageId: string
  kind: AgentTemplate
  title: string
  payload: unknown
  savedToLibrary: boolean
  createdAt: Date
  updatedAt: Date
}

/** 文件库文件 */
export interface LibraryFile {
  id: string
  kind: AgentTemplate
  title: string
  payload: unknown
  sourceSessionTitle: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ChatSessionWithMessages {
  session: ChatSession
  messages: Array<ChatMessage & { files: SessionFileSummary[] }>
}

export type ChatStreamChunkKind = 'reasoning' | 'content' | 'notice'

export type ChatStreamEvent =
  | { type: 'session'; id: string; title: string; agentTemplate: AgentTemplate }
  | { type: 'stage'; stage: string }
  | { type: 'stream'; kind: ChatStreamChunkKind; text: string }
  | { type: 'attempt'; reason: string }
  | { type: 'file'; sessionFileId: string; kind: AgentTemplate; title: string }
  | { type: 'message'; id: string; role: MessageRole; status: MessageStatus }
  | { type: 'error'; message: string }

export interface ChatTurnResult {
  sessionId: string
  messageId: string
  file: SessionFileSummary | null
}

export interface SaveToLibraryResult {
  libraryFileId: string
  libraryCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') return new Date(value)
  return new Date()
}

function normalizeSession(value: unknown): ChatSession {
  const record = isRecord(value) ? value : {}
  return {
    id: String(record.id ?? ''),
    title: String(record.title ?? ''),
    agentTemplate: String(record.agentTemplate ?? 'mindmap') as AgentTemplate,
    createdAt: toDate(record.createdAt),
    updatedAt: toDate(record.updatedAt),
  }
}

function normalizeMessage(value: unknown): ChatMessage {
  const record = isRecord(value) ? value : {}
  return {
    id: String(record.id ?? ''),
    sessionId: String(record.sessionId ?? ''),
    role: String(record.role ?? 'assistant') as MessageRole,
    content: String(record.content ?? ''),
    reasoning: typeof record.reasoning === 'string' ? record.reasoning : null,
    status: String(record.status ?? 'done') as MessageStatus,
    createdAt: toDate(record.createdAt),
  }
}

function normalizeSessionWithMessages(value: unknown): ChatSessionWithMessages {
  const record = isRecord(value) ? value : {}
  const session = normalizeSession(record.session)
  const messages = Array.isArray(record.messages)
    ? record.messages.map((m) => {
        const message = normalizeMessage(m)
        const files = isRecord(m) && Array.isArray(m.files)
          ? m.files.map((f: unknown) => normalizeSessionFileSummary(f))
          : []
        return { ...message, files }
      })
    : []
  return { session, messages }
}

function normalizeSessionFile(value: unknown): SessionFile {
  const record = isRecord(value) ? value : {}
  return {
    id: String(record.id ?? ''),
    sessionId: String(record.sessionId ?? ''),
    messageId: String(record.messageId ?? ''),
    kind: String(record.kind ?? 'mindmap') as AgentTemplate,
    title: String(record.title ?? ''),
    payload: record.payload,
    savedToLibrary: Boolean(record.savedToLibrary),
    createdAt: toDate(record.createdAt),
    updatedAt: toDate(record.updatedAt),
  }
}

function normalizeSessionFileSummary(value: unknown): SessionFileSummary {
  const record = isRecord(value) ? value : {}
  return {
    sessionFileId: String(record.sessionFileId ?? record.id ?? ''),
    kind: String(record.kind ?? 'mindmap') as AgentTemplate,
    title: String(record.title ?? ''),
  }
}

function normalizeLibraryFile(value: unknown): LibraryFile {
  const record = isRecord(value) ? value : {}
  return {
    id: String(record.id ?? ''),
    kind: String(record.kind ?? 'mindmap') as AgentTemplate,
    title: String(record.title ?? ''),
    payload: record.payload,
    sourceSessionTitle: typeof record.sourceSessionTitle === 'string' ? record.sourceSessionTitle : null,
    createdAt: toDate(record.createdAt),
    updatedAt: toDate(record.updatedAt),
  }
}

async function httpJson<T>(
  url: string,
  init: RequestInit = { method: 'GET' },
  normalize: (value: unknown) => T,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const envelope = await parseJson<{ success: boolean; error?: string } & Record<string, unknown>>(response)
  if (!envelope.success || envelope.error) {
    throw new Error(envelope.error ?? '请求失败')
  }
  return normalize(envelope)
}

export async function listSessions(): Promise<ChatSession[]> {
  const result = await httpJson(
    buildUrl('/api/requirement-analysis/sessions'),
    { method: 'GET' },
    (value) => (isRecord(value) && Array.isArray(value.sessions) ? value.sessions.map(normalizeSession) : []),
  )
  return result
}

export async function getSession(id: string): Promise<ChatSessionWithMessages> {
  return httpJson(
    buildUrl(`/api/requirement-analysis/sessions/${id}`),
    { method: 'GET' },
    normalizeSessionWithMessages,
  )
}

export async function renameSession(id: string, title: string): Promise<ChatSession> {
  return httpJson(
    buildUrl(`/api/requirement-analysis/sessions/${id}`),
    { method: 'PATCH', body: JSON.stringify({ title }) },
    (value) => normalizeSession(isRecord(value) ? value.session : value),
  )
}

export async function deleteSession(id: string): Promise<void> {
  await httpJson(
    buildUrl(`/api/requirement-analysis/sessions/${id}`),
    { method: 'DELETE' },
    () => undefined,
  )
}

export async function getSessionFile(id: string): Promise<SessionFile> {
  return httpJson(
    buildUrl(`/api/requirement-analysis/session-files/${id}`),
    { method: 'GET' },
    (value) => normalizeSessionFile(isRecord(value) ? value.file : value),
  )
}

export async function updateSessionFileBoard(id: string, board: unknown): Promise<SessionFile> {
  return httpJson(
    buildUrl(`/api/requirement-analysis/session-files/${id}`),
    { method: 'PATCH', body: JSON.stringify({ board }) },
    (value) => normalizeSessionFile(isRecord(value) ? value.file : value),
  )
}

export async function saveToLibrary(sessionFileId: string): Promise<SaveToLibraryResult> {
  return httpJson(
    buildUrl(`/api/requirement-analysis/session-files/${sessionFileId}/save-to-library`),
    { method: 'POST' },
    (value) => {
      const record = isRecord(value) ? value : {}
      return {
        libraryFileId: String(record.libraryFileId ?? ''),
        libraryCount: Number(record.libraryCount ?? 0),
      }
    },
  )
}

export async function listLibraryFiles(): Promise<LibraryFile[]> {
  return httpJson(
    buildUrl('/api/requirement-analysis/library/files'),
    { method: 'GET' },
    (value) => (isRecord(value) && Array.isArray(value.files) ? value.files.map(normalizeLibraryFile) : []),
  )
}

export async function getLibraryFile(id: string): Promise<LibraryFile> {
  return httpJson(
    buildUrl(`/api/requirement-analysis/library/files/${id}`),
    { method: 'GET' },
    (value) => normalizeLibraryFile(isRecord(value) ? value.file : value),
  )
}

export async function updateLibraryFileBoard(id: string, board: unknown): Promise<LibraryFile> {
  return httpJson(
    buildUrl(`/api/requirement-analysis/library/files/${id}`),
    { method: 'PATCH', body: JSON.stringify({ board }) },
    (value) => normalizeLibraryFile(isRecord(value) ? value.file : value),
  )
}

export async function deleteLibraryFile(id: string): Promise<void> {
  await httpJson(
    buildUrl(`/api/requirement-analysis/library/files/${id}`),
    { method: 'DELETE' },
    () => undefined,
  )
}

export async function getLibraryCount(): Promise<number> {
  return httpJson(
    buildUrl('/api/requirement-analysis/library/count'),
    { method: 'GET' },
    (value) => Number(isRecord(value) ? value.count : 0),
  )
}

function parseChatStreamEvent(eventName: string, dataText: string): ChatStreamEvent | null {
  if (eventName === 'end') return null
  if (eventName === 'session') {
    try {
      const data = JSON.parse(dataText) as Record<string, unknown>
      return {
        type: 'session',
        id: String(data.id ?? ''),
        title: String(data.title ?? ''),
        agentTemplate: String(data.agentTemplate ?? 'mindmap') as AgentTemplate,
      }
    } catch {
      return null
    }
  }
  if (eventName === 'stage') {
    try {
      const data = JSON.parse(dataText) as Record<string, unknown>
      return { type: 'stage', stage: String(data.stage ?? '') }
    } catch {
      return null
    }
  }
  if (eventName === 'stream') {
    try {
      const data = JSON.parse(dataText) as Record<string, unknown>
      const kind = String(data.kind ?? 'notice') as ChatStreamChunkKind
      return { type: 'stream', kind, text: String(data.text ?? '') }
    } catch {
      return null
    }
  }
  if (eventName === 'attempt') {
    try {
      const data = JSON.parse(dataText) as Record<string, unknown>
      return { type: 'attempt', reason: String(data.reason ?? '') }
    } catch {
      return null
    }
  }
  if (eventName === 'file') {
    try {
      const data = JSON.parse(dataText) as Record<string, unknown>
      return {
        type: 'file',
        sessionFileId: String(data.sessionFileId ?? ''),
        kind: String(data.kind ?? 'mindmap') as AgentTemplate,
        title: String(data.title ?? ''),
      }
    } catch {
      return null
    }
  }
  if (eventName === 'message') {
    try {
      const data = JSON.parse(dataText) as Record<string, unknown>
      return {
        type: 'message',
        id: String(data.id ?? ''),
        role: String(data.role ?? 'assistant') as MessageRole,
        status: String(data.status ?? 'done') as MessageStatus,
      }
    } catch {
      return null
    }
  }
  if (eventName === 'error') {
    try {
      const data = JSON.parse(dataText) as Record<string, unknown>
      return { type: 'error', message: String(data.message ?? '请求失败') }
    } catch {
      return { type: 'error', message: dataText || '请求失败' }
    }
  }
  return null
}

export async function chatStream(
  body: { sessionId?: string; agentTemplate: AgentTemplate; text: string },
  aiConfig: RuntimeAiConfig,
  onEvent: (event: ChatStreamEvent) => void | Promise<void>,
): Promise<ChatTurnResult> {
  const response = await fetch(buildUrl('/api/requirement-analysis/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, aiConfig }),
  })
  if (!response.ok || !response.body) {
    let message = `对话请求失败：${response.status}`
    try {
      const data = await response.json() as { error?: string }
      if (data.error) message = data.error
    } catch {
      // 非 JSON 错误体，保留默认提示
    }
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: ChatTurnResult | null = null
  let streamError: string | null = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const rawBlock = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)

      const lines = rawBlock.split(/\r?\n/)
      const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? ''
      const dataText = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')

      const event = parseChatStreamEvent(eventName, dataText)
      if (event) {
        if (event.type === 'session') {
          result = {
            sessionId: event.id,
            messageId: '',
            file: null,
          }
        }
        if (event.type === 'message') {
          if (!result) {
            result = { sessionId: body.sessionId ?? '', messageId: event.id, file: null }
          } else {
            result = { ...result, messageId: event.id }
          }
        }
        if (event.type === 'file') {
          if (!result) {
            result = { sessionId: body.sessionId ?? '', messageId: '', file: { sessionFileId: event.sessionFileId, kind: event.kind, title: event.title } }
          } else {
            result = { ...result, file: { sessionFileId: event.sessionFileId, kind: event.kind, title: event.title } }
          }
        }
        if (event.type === 'error') streamError = event.message
        await onEvent(event)
      }

      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('对话未返回有效结果，请重试。')
  return result
}

export type {
  AgentTemplate,
}

// Re-export AgentTemplate 类型，以便业务组件只用引用 chat-api 即可获得模板类型。
