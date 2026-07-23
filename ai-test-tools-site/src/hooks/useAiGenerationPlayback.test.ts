import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DONE_TRANSITION_DELAY_MS,
  STEP_MIN_VISIBLE_MS,
  useAiGenerationPlayback,
} from './useAiGenerationPlayback'
import type { AiGenerateResponse, generateJmeterWithAiStream } from '../lib/jmeter-api'
import type { StoredModelConfig } from '../shared/api-types'

type StreamGenerate = typeof generateJmeterWithAiStream

const modelConfig: StoredModelConfig = {
  id: 'test-provider',
  name: '测试供应商',
  providerType: 'newapi',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'gpt-5.5',
  apiFormat: 'openai_responses',
}

function createResponse(overrides: Partial<AiGenerateResponse> = {}): AiGenerateResponse {
  return {
    ok: true,
    model: 'gpt-5.5',
    summary: '生成成功',
    planName: 'Demo 测试计划',
    outputPath: 'server/generated/ai-generated-demo.jmx',
    downloadUrl: '/files?path=server/generated/ai-generated-demo.jmx',
    toolCalls: [],
    validation: '校验通过',
    saveResult: 'Test plan saved: server/generated/ai-generated-demo.jmx',
    tree: 'Demo 测试计划树',
    ...overrides,
  }
}

describe('useAiGenerationPlayback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('按到达顺序播放事件，同 id 的完成事件原位更新', async () => {
    const response = createResponse()
    const streamGenerate: StreamGenerate = async (_args, onEvent) => {
      await onEvent({ type: 'status', stepId: 'submit', phase: 'start', title: '提交生成请求', content: '' })
      await onEvent({ type: 'tool', stepId: 'tool-1', phase: 'start', title: '创建测试计划', content: '', toolName: 'create_test_plan', arguments: { name: 'Demo' } })
      await onEvent({ type: 'tool', stepId: 'tool-1', phase: 'done', title: '创建测试计划', content: '计划已创建', toolName: 'create_test_plan', arguments: { name: 'Demo' } })
      await onEvent({ type: 'done', title: '生成完成', content: response.outputPath, result: response })
      return response
    }
    const { result } = renderHook(() => useAiGenerationPlayback({ streamGenerate }))

    let startPromise: Promise<void>
    act(() => {
      startPromise = result.current.start({ prompt: '生成 demo 计划', modelConfig })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_MIN_VISIBLE_MS + DONE_TRANSITION_DELAY_MS)
      await startPromise
    })

    expect(result.current.events.map((event) => `${event.id}:${event.phase}`)).toEqual([
      'submit:start',
      'tool-1:done',
      'done:done',
    ])
    expect(result.current.events[1]).toMatchObject({ content: '计划已创建', toolName: 'create_test_plan' })
    expect(result.current.result?.savedPath).toBe(response.outputPath)
    expect(result.current.activeTab).toBe('result')
    expect(result.current.running).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('步骤从开始到完成至少展示 STEP_MIN_VISIBLE_MS', async () => {
    const response = createResponse()
    const streamGenerate: StreamGenerate = async (_args, onEvent) => {
      // 不等待队列排空，连续入队 start/done
      void onEvent({ type: 'tool', stepId: 'tool-1', phase: 'start', title: '创建测试计划', content: '', toolName: 'create_test_plan', arguments: {} })
      void onEvent({ type: 'tool', stepId: 'tool-1', phase: 'done', title: '创建测试计划', content: '计划已创建', toolName: 'create_test_plan', arguments: {} })
      return response
    }
    const { result } = renderHook(() => useAiGenerationPlayback({ streamGenerate }))

    let startPromise: Promise<void>
    act(() => {
      startPromise = result.current.start({ prompt: '生成 demo 计划', modelConfig })
    })

    // start 事件先被排空展示，done 事件进入最小展示等待
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.events).toEqual([
      expect.objectContaining({ id: 'tool-1', phase: 'start' }),
    ])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_MIN_VISIBLE_MS - 1)
    })
    expect(result.current.events).toEqual([
      expect.objectContaining({ id: 'tool-1', phase: 'start' }),
    ])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.events).toEqual([
      expect.objectContaining({ id: 'tool-1', phase: 'done' }),
    ])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DONE_TRANSITION_DELAY_MS)
      await startPromise
    })
    expect(result.current.running).toBe(false)
  })

  it('过期生成不切换页签也不结束新一轮运行的状态', async () => {
    const resolvers: Array<() => void> = []
    const streamGenerate: StreamGenerate = () => {
      const index = resolvers.length
      return new Promise<AiGenerateResponse>((resolve) => {
        resolvers.push(() => resolve(createResponse({ outputPath: `server/generated/ai-generated-${index + 1}.jmx` })))
      })
    }
    const { result } = renderHook(() => useAiGenerationPlayback({ streamGenerate }))

    let firstStart: Promise<void>
    act(() => {
      firstStart = result.current.start({ prompt: '第一次生成', modelConfig })
    })
    let secondStart: Promise<void>
    act(() => {
      secondStart = result.current.start({ prompt: '第二次生成', modelConfig })
    })

    // 第一轮（已过期）完成：不应切换页签，也不应把 running 置回 false
    await act(async () => {
      resolvers[0]()
      await vi.advanceTimersByTimeAsync(DONE_TRANSITION_DELAY_MS)
      await firstStart
    })
    expect(result.current.running).toBe(true)
    expect(result.current.activeTab).toBe('process')

    // 第二轮（当前）完成：正常切换页签并结束运行
    await act(async () => {
      resolvers[1]()
      await vi.advanceTimersByTimeAsync(DONE_TRANSITION_DELAY_MS)
      await secondStart
    })
    expect(result.current.running).toBe(false)
    expect(result.current.activeTab).toBe('result')
    expect(result.current.result?.savedPath).toBe('server/generated/ai-generated-2.jmx')
  })

  it('生成抛错时设置 error 并追加失败事件', async () => {
    const streamGenerate: StreamGenerate = async () => {
      throw new Error('生成中断，请检查模型服务')
    }
    const { result } = renderHook(() => useAiGenerationPlayback({ streamGenerate }))

    let startPromise: Promise<void>
    act(() => {
      startPromise = result.current.start({ prompt: '生成 demo 计划', modelConfig })
    })
    await act(async () => {
      await startPromise
    })

    expect(result.current.error).toBe('生成中断，请检查模型服务')
    expect(result.current.events).toEqual([
      expect.objectContaining({ id: 'error', type: 'error', title: '生成失败', content: '生成中断，请检查模型服务' }),
    ])
    expect(result.current.result).toBeNull()
    expect(result.current.running).toBe(false)
  })

  it('流式 error 事件后抛错只保留一个失败事件', async () => {
    const streamGenerate: StreamGenerate = async (_args, onEvent) => {
      await onEvent({ type: 'error', title: '生成失败', content: '模型返回内容为空' })
      throw new Error('模型返回内容为空')
    }
    const { result } = renderHook(() => useAiGenerationPlayback({ streamGenerate }))

    let startPromise: Promise<void>
    act(() => {
      startPromise = result.current.start({ prompt: '生成 demo 计划', modelConfig })
    })
    await act(async () => {
      await startPromise
    })

    expect(result.current.error).toBe('模型返回内容为空')
    expect(result.current.events.filter((event) => event.type === 'error')).toHaveLength(1)
    expect(result.current.running).toBe(false)
  })

  it('流未产生任何事件时用响应合成完整步骤', async () => {
    const response = createResponse({
      toolCalls: [
        { name: 'create_test_plan', arguments: { name: 'Demo' }, result: '计划已创建' },
      ],
    })
    const streamGenerate: StreamGenerate = async () => response
    const { result } = renderHook(() => useAiGenerationPlayback({ streamGenerate }))

    let startPromise: Promise<void>
    act(() => {
      startPromise = result.current.start({ prompt: '生成 demo 计划', modelConfig })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DONE_TRANSITION_DELAY_MS)
      await startPromise
    })

    expect(result.current.events.map((event) => event.id)).toEqual(['tool-1', 'validate', 'save', 'tree', 'done'])
    expect(result.current.events[0]).toMatchObject({
      type: 'tool',
      phase: 'done',
      title: '创建测试计划 · Demo',
      content: '计划已创建',
    })
    expect(result.current.result?.savedPath).toBe(response.outputPath)
    expect(result.current.activeTab).toBe('result')
  })

  it('reset 清空状态并使进行中的生成失效', async () => {
    let resolveStream: (response: AiGenerateResponse) => void
    const streamGenerate: StreamGenerate = () => {
      return new Promise<AiGenerateResponse>((resolve) => {
        resolveStream = resolve
      })
    }
    const { result } = renderHook(() => useAiGenerationPlayback({ streamGenerate }))

    let startPromise: Promise<void>
    act(() => {
      startPromise = result.current.start({ prompt: '生成 demo 计划', modelConfig })
    })
    expect(result.current.running).toBe(true)

    act(() => {
      result.current.reset()
    })
    expect(result.current.running).toBe(false)
    expect(result.current.events).toEqual([])

    // 已过期的生成完成后不得把页签切到结果页
    await act(async () => {
      resolveStream(createResponse())
      await vi.advanceTimersByTimeAsync(DONE_TRANSITION_DELAY_MS)
      await startPromise
    })
    expect(result.current.activeTab).toBe('process')
    expect(result.current.running).toBe(false)
  })
})
