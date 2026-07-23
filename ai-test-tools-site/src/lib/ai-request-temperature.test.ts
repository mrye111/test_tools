import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  callChatCompletion,
  streamChatCompletion,
} from '../../server/src/features/testcase/ai'

const successResponse = () => new Response(JSON.stringify({
  choices: [{ message: { content: 'ok' } }],
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})

function requestBody(fetchMock: ReturnType<typeof vi.spyOn>, callIndex = 0) {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

describe('AI 请求温度参数兼容', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Kimi Coding 非流式请求只发送模型允许的 temperature=1', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(successResponse())

    await callChatCompletion({
      apiKey: 'test-key',
      baseUrl: 'https://api.kimi.com/coding/v1',
      endpointType: 'openai_chat',
      model: 'kimi-k2.7-code',
      provider: 'codex',
    }, {
      messages: [{ role: 'user', content: '生成登录测试用例' }],
      temperature: 0.7,
    })

    expect(requestBody(fetchMock).temperature).toBe(1)
  })

  it('Kimi Coding 流式请求同样只发送 temperature=1', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    const chunks: string[] = []
    for await (const chunk of streamChatCompletion({
      apiKey: 'test-key',
      baseUrl: 'https://api.kimi.com/coding/v1',
      endpointType: 'openai_chat',
      model: 'kimi-k2.7-code',
      provider: 'codex',
    }, {
      messages: [{ role: 'user', content: '生成登录测试用例' }],
      temperature: 0.7,
    })) {
      chunks.push(chunk)
    }

    expect(chunks.join('')).toBe('ok')
    expect(requestBody(fetchMock).temperature).toBe(1)
  })

  it('流式响应只包含 reasoning_content 时不得静默完成', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"reasoning_content":"正在分析需求"}}]}\n\n'
        + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'
        + 'data: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    const consume = async () => {
      for await (const _chunk of streamChatCompletion({
        apiKey: 'test-key',
        baseUrl: 'https://api.kimi.com/coding/v1',
        endpointType: 'openai_chat',
        model: 'kimi-k2.7-code',
        provider: 'codex',
      }, {
        messages: [{ role: 'user', content: '生成登录测试用例' }],
      })) {
        // 消费完整流，验证结束时的空正文判定。
      }
    }

    await expect(consume()).rejects.toThrow(/未返回.*正文/)
  })

  it('OpenAI 兼容非流式响应正文为空时抛出错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '', reasoning_content: '只有推理内容' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(callChatCompletion({
      apiKey: 'test-key',
      baseUrl: 'https://api.kimi.com/coding/v1',
      endpointType: 'openai_chat',
      model: 'kimi-k2.7-code',
      provider: 'codex',
    }, {
      messages: [{ role: 'user', content: '生成登录测试用例' }],
    })).rejects.toThrow(/未返回.*正文/)
  })

  it('Kimi Coding Responses 请求也发送 temperature=1', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: 'ok',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callChatCompletion({
      apiKey: 'test-key',
      baseUrl: 'https://api.kimi.com/coding/v1',
      endpointType: 'openai_responses',
      model: 'kimi-k2.7-code',
      provider: 'codex',
    }, {
      messages: [{ role: 'user', content: '生成登录测试用例' }],
      temperature: 0.7,
    })

    expect(requestBody(fetchMock).temperature).toBe(1)
  })

  it('普通 OpenAI 兼容模型保留调用方指定的 temperature', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(successResponse())

    await callChatCompletion({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com/v1',
      endpointType: 'openai_chat',
      model: 'general-chat-model',
      provider: 'codex',
    }, {
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
    })

    expect(requestBody(fetchMock).temperature).toBe(0.7)
  })
})
