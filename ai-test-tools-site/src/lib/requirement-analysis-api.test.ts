import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeRequirement, type RequirementAnalysisStreamEvent } from './requirement-analysis-api'
import type { RuntimeAiConfig } from '../shared/api-types'

const aiConfig: RuntimeAiConfig = {
  provider: 'codex',
  endpointType: 'openai_responses',
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

const sampleResult = {
  title: '登录需求',
  tree: { id: 'root', title: '登录需求', children: [] },
  findings: [],
  sourceText: '需求原文',
  truncated: false,
  warnings: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('analyzeRequirement SSE 消费', () => {
  it('服务端返回错误时，抛出服务端原始错误消息而不是 JSON 解析错误', async () => {
    // 回归：旧版 end 帧 data 为裸文本 "error"，消费端 JSON.parse 崩溃，
    // 把真正的服务端错误（如此处的 api_key 缺失）顶掉。
    mockFetchOnce(sseResponse(
      'event: stage\n'
      + 'data: {"stage":"parsing"}\n\n'
      + 'event: error\n'
      + 'data: {"message":"ai_config.api_key is required."}\n\n'
      + 'event: end\n'
      + 'data: error\n\n',
    ))

    const events: RequirementAnalysisStreamEvent[] = []
    await expect(analyzeRequirement({ kind: 'text', text: '需求' }, aiConfig, (e) => { events.push(e) }))
      .rejects.toThrow('ai_config.api_key is required.')
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })

  it('成功路径：end 帧为裸文本 done 时也能正常返回结果', async () => {
    mockFetchOnce(sseResponse(
      'event: stage\n'
      + 'data: {"stage":"parsing"}\n\n'
      + 'event: result\n'
      + `data: ${JSON.stringify(sampleResult)}\n\n`
      + 'event: end\n'
      + 'data: done\n\n',
    ))

    const result = await analyzeRequirement({ kind: 'text', text: '需求' }, aiConfig, () => {})
    expect(result.title).toBe('登录需求')
  })

  it('成功路径：end 帧为 JSON（新服务端格式）时正常返回结果', async () => {
    mockFetchOnce(sseResponse(
      'event: result\n'
      + `data: ${JSON.stringify(sampleResult)}\n\n`
      + 'event: end\n'
      + 'data: {"ok":true}\n\n',
    ))

    const result = await analyzeRequirement({ kind: 'text', text: '需求' }, aiConfig, () => {})
    expect(result.tree.id).toBe('root')
  })

  it('流中出现无法解析的帧时跳过该帧，不中断整个消费', async () => {
    mockFetchOnce(sseResponse(
      'event: stage\n'
      + 'data: {不是合法JSON\n\n'
      + 'event: result\n'
      + `data: ${JSON.stringify(sampleResult)}\n\n`
      + 'event: end\n'
      + 'data: {"ok":true}\n\n',
    ))

    const result = await analyzeRequirement({ kind: 'text', text: '需求' }, aiConfig, () => {})
    expect(result.title).toBe('登录需求')
  })

  it('解析 stream 事件：reasoning/content/notice 三种 kind 连同文本转发', async () => {
    mockFetchOnce(sseResponse(
      'event: stream\n'
      + 'data: {"kind":"reasoning","text":"先拆解需求"}\n\n'
      + 'event: stream\n'
      + 'data: {"kind":"content","text":"{\\"title\\":"}\n\n'
      + 'event: stream\n'
      + 'data: {"kind":"notice","text":"当前模型格式不支持过程输出，请耐心等待"}\n\n'
      + 'event: result\n'
      + `data: ${JSON.stringify(sampleResult)}\n\n`
      + 'event: end\n'
      + 'data: {"ok":true}\n\n',
    ))

    const events: RequirementAnalysisStreamEvent[] = []
    await analyzeRequirement({ kind: 'text', text: '需求' }, aiConfig, (e) => { events.push(e) })

    expect(events.slice(0, 3)).toEqual([
      { type: 'stream', kind: 'reasoning', text: '先拆解需求' },
      { type: 'stream', kind: 'content', text: '{"title":' },
      { type: 'stream', kind: 'notice', text: '当前模型格式不支持过程输出，请耐心等待' },
    ])
  })

  it('解析 attempt 事件：重试分隔原因原样转发', async () => {
    mockFetchOnce(sseResponse(
      'event: stream\n'
      + 'data: {"kind":"content","text":"不是 JSON"}\n\n'
      + 'event: attempt\n'
      + 'data: {"reason":"输出无法解析，正在修复重试"}\n\n'
      + 'event: result\n'
      + `data: ${JSON.stringify(sampleResult)}\n\n`
      + 'event: end\n'
      + 'data: {"ok":true}\n\n',
    ))

    const events: RequirementAnalysisStreamEvent[] = []
    await analyzeRequirement({ kind: 'text', text: '需求' }, aiConfig, (e) => { events.push(e) })

    expect(events.some((e) => e.type === 'attempt' && e.reason === '输出无法解析，正在修复重试')).toBe(true)
  })

  it('非法 stream/attempt 帧（未知 kind、空文本）被跳过，不中断消费', async () => {
    mockFetchOnce(sseResponse(
      'event: stream\n'
      + 'data: {"kind":"unknown","text":"x"}\n\n'
      + 'event: stream\n'
      + 'data: {"kind":"reasoning","text":""}\n\n'
      + 'event: attempt\n'
      + 'data: {"reason":""}\n\n'
      + 'event: result\n'
      + `data: ${JSON.stringify(sampleResult)}\n\n`
      + 'event: end\n'
      + 'data: {"ok":true}\n\n',
    ))

    const events: RequirementAnalysisStreamEvent[] = []
    const result = await analyzeRequirement({ kind: 'text', text: '需求' }, aiConfig, (e) => { events.push(e) })

    expect(result.title).toBe('登录需求')
    expect(events.every((e) => e.type === 'result')).toBe(true)
  })
})

// 追加到 requirement-analysis-api.test.ts
describe('generateBoardChart & updateAnalysisRecord', () => {
  it('generateBoardChart POST 到 records/:id/board/generate 并返回 draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, draft: { nodes: [], edges: [] } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { generateBoardChart } = await import('./requirement-analysis-api')
    const draft = await generateBoardChart('rec_1', { nodeId: 'n1', chartKind: 'cause-effect' }, aiConfig)
    expect(draft).toEqual({ nodes: [], edges: [] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/requirement-analysis/records/rec_1/board/generate')
    expect(init.method).toBe('POST')
    vi.unstubAllGlobals()
  })

  it('updateAnalysisRecord 支持 board 字段透传', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, record: { id: 'rec_1' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { updateAnalysisRecord } = await import('./requirement-analysis-api')
    await updateAnalysisRecord('rec_1', { board: { version: 1, elements: [] } })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.board).toEqual({ version: 1, elements: [] })
    vi.unstubAllGlobals()
  })
})
