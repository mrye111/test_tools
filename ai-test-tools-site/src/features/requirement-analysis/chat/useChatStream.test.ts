import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTemplate } from './chat-api'
import type { RuntimeAiConfig } from '../../../shared/api-types'
import { chatStream, getSession } from './chat-api'
import { useChatStream } from './useChatStream'

vi.mock('./chat-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./chat-api')>()
  return {
    ...original,
    chatStream: vi.fn(original.chatStream),
    getSession: vi.fn(original.getSession),
  }
})

const mockChatStream = vi.mocked(chatStream)
const mockGetSession = vi.mocked(getSession)

const fakeAiConfig: RuntimeAiConfig = {
  provider: 'codex',
  endpointType: 'openai_chat',
  baseUrl: 'http://localhost',
  apiKey: 'test-key',
  model: 'gpt-test',
}

function setupModelConfig() {
  const state = JSON.stringify({
    models: [{
      id: 'model-1',
      name: 'Test Provider',
      providerType: 'openai',
      baseUrl: fakeAiConfig.baseUrl,
      apiKey: fakeAiConfig.apiKey,
      model: fakeAiConfig.model,
      apiFormat: fakeAiConfig.endpointType,
    }],
    activeModelId: 'model-1',
  })
  localStorage.setItem('nexuskit_model_configs', state)
}

function createStreamEmitter() {
  let handler: ((event: import('./chat-api').ChatStreamEvent) => void | Promise<void>) | null = null
  let resolve: (value: import('./chat-api').ChatTurnResult) => void = () => {}
  let reject: (reason: unknown) => void = () => {}

  const promise = new Promise<import('./chat-api').ChatTurnResult>((res, rej) => {
    resolve = res
    reject = rej
  })

  mockChatStream.mockImplementation(async (_body, _config, onEvent) => {
    handler = onEvent
    return promise
  })

  return {
    emit: (event: import('./chat-api').ChatStreamEvent) => handler?.(event),
    done: (result: import('./chat-api').ChatTurnResult) => resolve(result),
    fail: (reason: unknown) => reject(reason),
  }
}

beforeEach(() => {
  localStorage.clear()
  setupModelConfig()
})

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('useChatStream', () => {
  it('send 后插入 user 乐观消息与 assistant 占位', async () => {
    const stream = createStreamEmitter()
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      const sendPromise = result.current.send('hello', 'mindmap')
      await Promise.resolve()
      stream.done({ sessionId: 's-1', messageId: 'm-1', file: null })
      await sendPromise
    })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0].role).toBe('user')
    expect(result.current.messages[0].content).toBe('hello')
    expect(result.current.messages[1].role).toBe('assistant')
    expect(result.current.messages[1].status).toBe('streaming')
  })

  it('逐 stream 事件追加 content、reasoning 与 notice', async () => {
    const stream = createStreamEmitter()
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      const sendPromise = result.current.send('hello', 'mindmap')
      await Promise.resolve()
      stream.emit({ type: 'stream', kind: 'content', text: 'A' })
      stream.emit({ type: 'stream', kind: 'reasoning', text: 'R1' })
      stream.emit({ type: 'stream', kind: 'reasoning', text: 'R2' })
      stream.emit({ type: 'stream', kind: 'content', text: 'B' })
      stream.emit({ type: 'stream', kind: 'notice', text: 'N1' })
      stream.emit({ type: 'stream', kind: 'notice', text: 'N2' })
      stream.emit({ type: 'message', id: 'm-1', role: 'assistant', status: 'done' })
      stream.done({ sessionId: 's-1', messageId: 'm-1', file: null })
      await sendPromise
    })

    const assistant = result.current.messages[1]
    expect(assistant.content).toBe('AB\n\nN1\n\nN2')
    expect(assistant.reasoning).toBe('R1R2')
    expect(assistant.status).toBe('done')
    expect(result.current.streaming).toBe(false)
  })

  it('file 事件追加到 assistant 消息的 files 数组', async () => {
    const stream = createStreamEmitter()
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      const sendPromise = result.current.send('hello', 'mindmap')
      await Promise.resolve()
      stream.emit({ type: 'stream', kind: 'content', text: 'file coming' })
      stream.emit({ type: 'file', sessionFileId: 'sf-1', kind: 'mindmap', title: '思维导图' })
      stream.emit({ type: 'message', id: 'm-1', role: 'assistant', status: 'done' })
      stream.done({ sessionId: 's-1', messageId: 'm-1', file: { sessionFileId: 'sf-1', kind: 'mindmap', title: '思维导图' } })
      await sendPromise
    })

    const assistant = result.current.messages[1]
    expect(assistant.files).toHaveLength(1)
    expect(assistant.files[0]).toEqual({ sessionFileId: 'sf-1', kind: 'mindmap', title: '思维导图', savedToLibrary: false })
  })

  it('error 事件将 assistant 标为 error 并写入 error 状态', async () => {
    const stream = createStreamEmitter()
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      const sendPromise = result.current.send('hello', 'mindmap')
      await Promise.resolve()
      stream.emit({ type: 'stream', kind: 'content', text: 'x' })
      stream.emit({ type: 'error', message: '模型超时' })
      stream.done({ sessionId: 's-1', messageId: 'm-1', file: null })
      await sendPromise
    })

    const assistant = result.current.messages[1]
    expect(assistant.status).toBe('error')
    expect(result.current.error).toBe('模型超时')
    expect(result.current.streaming).toBe(false)
  })

  it('fetch 异常将 assistant 标为 error 并写入错误信息', async () => {
    mockChatStream.mockRejectedValueOnce(new Error('网络断开'))
    const { result } = renderHook(() => useChatStream())

    await act(async () => {
      try {
        await result.current.send('hello', 'mindmap')
      } catch {
        // 调用方不应依赖抛错，但这里允许异常
      }
    })

    expect(result.current.messages[1].status).toBe('error')
    expect(result.current.error).toBe('网络断开')
    expect(result.current.streaming).toBe(false)
  })

  it('retry 用前一条 user 消息重新发送一轮', async () => {
    const stream = createStreamEmitter()
    const { result } = renderHook(() => useChatStream('s-1'))

    await act(async () => {
      const sendPromise = result.current.send('hello', 'mindmap')
      await Promise.resolve()
      stream.emit({ type: 'error', message: '失败' })
      stream.done({ sessionId: 's-1', messageId: 'm-1', file: null })
      await sendPromise
    })

    const errorAssistantId = result.current.messages[1].id

    await act(async () => {
      const retryPromise = result.current.retry(errorAssistantId)
      await Promise.resolve()
      stream.emit({ type: 'message', id: 'm-2', role: 'assistant', status: 'done' })
      stream.done({ sessionId: 's-1', messageId: 'm-2', file: null })
      await retryPromise
    })

    expect(result.current.messages).toHaveLength(4)
    expect(result.current.messages[2].role).toBe('user')
    expect(result.current.messages[2].content).toBe('hello')
    expect(result.current.messages[3].role).toBe('assistant')
    expect(result.current.messages[3].status).toBe('done')
  })

  it('loadHistory 将服务端消息映射为视图模型并保留 error 残骸', async () => {
    mockGetSession.mockResolvedValueOnce({
      session: { id: 's-1', title: 'T', agentTemplate: 'mindmap', createdAt: new Date(), updatedAt: new Date() },
      messages: [
        { id: 'u-1', sessionId: 's-1', role: 'user', content: 'hi', reasoning: null, status: 'done', createdAt: new Date(), files: [] },
        { id: 'a-1', sessionId: 's-1', role: 'assistant', content: 'err', reasoning: null, status: 'error', createdAt: new Date(), files: [] },
      ],
    })

    const { result } = renderHook(() => useChatStream('s-1'))
    await act(async () => {
      await result.current.loadHistory()
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.messages[0].status).toBe('done')
    expect(result.current.messages[1].status).toBe('error')
  })

  it('无模型配置时 send 抛出可读错误', async () => {
    localStorage.clear()
    const { result } = renderHook(() => useChatStream())

    await expect(result.current.send('hello', 'mindmap')).rejects.toThrow('模型配置')
  })
})
