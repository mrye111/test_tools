import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_TEMPLATES } from './agent-templates'
import {
  chatStream,
  deleteLibraryFile,
  deleteSession,
  getLibraryCount,
  getLibraryFile,
  getSession,
  getSessionFile,
  listLibraryFiles,
  listSessions,
  renameSession,
  saveToLibrary,
  updateLibraryFileBoard,
  updateSessionFileBoard,
  type AgentTemplate,
  type ChatStreamEvent,
} from './chat-api'

const aiConfig = {
  provider: 'codex' as const,
  endpointType: 'openai_responses' as const,
  baseUrl: 'http://localhost:1',
  apiKey: 'test-key',
  model: 'test-model',
}

/** 构造一次性 SSE 响应体：整段文本作为一个 chunk 推给 reader。 */
function sseResponse(sseText: string): Response {
  const chunk = new TextEncoder().encode(sseText)
  let delivered = false
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (delivered) return { value: undefined, done: true }
          delivered = true
          return { value: chunk, done: false }
        },
      }),
    },
  } as unknown as Response
}

function mockFetchOnce(response: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => response))
}

function mockJsonFetchOnce(response: { ok: true; json: unknown } | { ok: false; status: number; json: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: response.ok,
    status: 'status' in response ? response.status : 200,
    json: async () => response.json,
  })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AGENT_TEMPLATES 常量', () => {
  it('包含五项模板且首项为 mindmap', () => {
    expect(AGENT_TEMPLATES).toHaveLength(5)
    expect(AGENT_TEMPLATES[0].kind).toBe('mindmap')
    const kinds = AGENT_TEMPLATES.map((t) => t.kind)
    expect(kinds).toEqual([
      'mindmap',
      'cause-effect',
      'decision-table',
      'orthogonal',
      'flowchart',
    ])
  })

  it('每项均包含 label、description、icon 与 gradient', () => {
    for (const template of AGENT_TEMPLATES) {
      expect(typeof template.label).toBe('string')
      expect(typeof template.description).toBe('string')
      expect(template.icon).toBeDefined()
      expect(typeof template.gradient).toBe('string')
    }
  })
})

describe('chatStream SSE 消费', () => {
  it('分发 session / stage / stream / file / message 事件并聚合返回结果', async () => {
    const sseText = [
      'event: session',
      'data: {"id":"sess_1","title":"新会话","agentTemplate":"mindmap"}',
      '',
      'event: stage',
      'data: {"stage":"analyzing"}',
      '',
      'event: stream',
      'data: {"kind":"reasoning","text":"思考中"}',
      '',
      'event: stream',
      'data: {"kind":"content","text":"生成内容"}',
      '',
      'event: file',
      'data: {"sessionFileId":"sf_1","kind":"mindmap","title":"登录需求"}',
      '',
      'event: message',
      'data: {"id":"msg_1","role":"assistant","status":"done"}',
      '',
      'event: end',
      'data: {"ok":true}',
      '',
    ].join('\n')
    mockFetchOnce(sseResponse(sseText))

    const events: ChatStreamEvent[] = []
    const result = await chatStream(
      { agentTemplate: 'mindmap', text: '用户登录' },
      aiConfig,
      (e) => { events.push(e) },
    )

    expect(result).toEqual({
      sessionId: 'sess_1',
      messageId: 'msg_1',
      file: { sessionFileId: 'sf_1', kind: 'mindmap', title: '登录需求' },
    })
    expect(events.map((e) => e.type)).toEqual([
      'session', 'stage', 'stream', 'stream', 'file', 'message',
    ])
  })

  it('服务端返回 error 事件时抛出错误消息', async () => {
    const sseText = [
      'event: stage',
      'data: {"stage":"analyzing"}',
      '',
      'event: error',
      'data: {"message":"AI 配置错误"}',
      '',
      'event: end',
      'data: {"ok":false}',
      '',
    ].join('\n')
    mockFetchOnce(sseResponse(sseText))

    const events: ChatStreamEvent[] = []
    await expect(chatStream(
      { agentTemplate: 'mindmap', text: '需求' },
      aiConfig,
      (e) => { events.push(e) },
    )).rejects.toThrow('AI 配置错误')
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })
})

describe('REST 会话接口', () => {
  it('listSessions 走正确 URL 并返回会话列表', async () => {
    mockJsonFetchOnce({ ok: true, json: { success: true, sessions: [{ id: 's1' }] } })
    const sessions = await listSessions()
    expect(sessions).toHaveLength(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/sessions',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getSession 返回会话及消息', async () => {
    mockJsonFetchOnce({
      ok: true,
      json: {
        success: true,
        session: { id: 's1', title: 'T', agentTemplate: 'mindmap' },
        messages: [],
      },
    })
    const result = await getSession('s1')
    expect(result.session.id).toBe('s1')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/sessions/s1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('renameSession 发送 title 并返回会话', async () => {
    mockJsonFetchOnce({
      ok: true,
      json: { success: true, session: { id: 's1', title: '新标题' } },
    })
    await renameSession('s1', '新标题')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/sessions/s1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: '新标题' }),
      }),
    )
  })

  it('deleteSession 发送 DELETE 请求', async () => {
    mockJsonFetchOnce({ ok: true, json: { success: true } })
    await deleteSession('s1')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/sessions/s1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

describe('REST 文件与文件库接口', () => {
  it('getSessionFile 返回文件', async () => {
    mockJsonFetchOnce({ ok: true, json: { success: true, file: { id: 'sf1' } } })
    const file = await getSessionFile('sf1')
    expect(file.id).toBe('sf1')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/session-files/sf1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('updateSessionFileBoard 发送 board 并返回文件', async () => {
    mockJsonFetchOnce({ ok: true, json: { success: true, file: { id: 'sf1', payload: { a: 1 } } } })
    await updateSessionFileBoard('sf1', { a: 1 })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/session-files/sf1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ board: { a: 1 } }),
      }),
    )
  })

  it('saveToLibrary 返回 libraryFileId 与 libraryCount', async () => {
    mockJsonFetchOnce({
      ok: true,
      json: { success: true, libraryFileId: 'lf1', libraryCount: 3 },
    })
    const result = await saveToLibrary('sf1')
    expect(result).toEqual({ libraryFileId: 'lf1', libraryCount: 3 })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/session-files/sf1/save-to-library',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('listLibraryFiles 返回文件列表', async () => {
    mockJsonFetchOnce({ ok: true, json: { success: true, files: [{ id: 'lf1' }] } })
    const files = await listLibraryFiles()
    expect(files).toHaveLength(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/library/files',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getLibraryFile 返回文件', async () => {
    mockJsonFetchOne({ ok: true, json: { success: true, file: { id: 'lf1' } } })
    const file = await getLibraryFile('lf1')
    expect(file.id).toBe('lf1')
  })

  it('updateLibraryFileBoard 更新文件 board', async () => {
    mockJsonFetchOne({ ok: true, json: { success: true, file: { id: 'lf1', payload: { b: 2 } } } })
    await updateLibraryFileBoard('lf1', { b: 2 })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/library/files/lf1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ board: { b: 2 } }),
      }),
    )
  })

  it('deleteLibraryFile 发送 DELETE 请求', async () => {
    mockJsonFetchOne({ ok: true, json: { success: true } })
    await deleteLibraryFile('lf1')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3000/api/requirement-analysis/library/files/lf1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('getLibraryCount 返回数量', async () => {
    mockJsonFetchOne({ ok: true, json: { success: true, count: 5 } })
    const count = await getLibraryCount()
    expect(count).toBe(5)
  })
})

describe('REST 失败响应', () => {
  it('success 为 false 时抛出 error 字段', async () => {
    mockJsonFetchOne({ ok: false, status: 500, json: { success: false, error: '服务器开小差了' } })
    await expect(listSessions()).rejects.toThrow('服务器开小差了')
  })
})

// 修复 mockJsonFetchOnce 的拼写错误；测试里误用 mockJsonFetchOne 会导致引用失败，先保留两者以便实现前测试失败暴露问题。
function mockJsonFetchOne(response: { ok: true; json: unknown } | { ok: false; status: number; json: unknown }) {
  mockJsonFetchOnce(response)
}
