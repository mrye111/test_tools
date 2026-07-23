import { useRef, useState } from 'react'
import { generateJmeterWithAiStream, getPreferredAiConfig, type AiGenerateResponse, type AiGenerateStreamEvent } from '../lib/jmeter-api'
import { normalizeErrorMessage } from '../lib/app-error'
import { toGeneratedPlanResult, type GeneratedPlanResult } from '../lib/jmeter-builders'
import { formatAiToolStep } from '../components/jmeter/aiStepFlow'
import type { StoredModelConfig } from '../shared/api-types'

export type AiGenerationEvent = {
  id: string
  type: 'status' | 'tool' | 'error' | 'done'
  phase: 'start' | 'done'
  title: string
  content: string
  toolName?: string
  arguments?: Record<string, unknown>
}

export type AiGenerationPlaybackTab = 'process' | 'result'

export const STEP_MIN_VISIBLE_MS = 560
export const DONE_TRANSITION_DELAY_MS = 980

type StreamGenerate = typeof generateJmeterWithAiStream

interface UseAiGenerationPlaybackOptions {
  /** 流式生成入口，测试中可注入脚本化的事件源 */
  streamGenerate?: StreamGenerate
}

interface StartGenerationArgs {
  prompt: string
  modelConfig: StoredModelConfig
}

function toAiEvents(response: AiGenerateResponse): AiGenerationEvent[] {
  return [
    ...response.toolCalls.map((call, index) => ({
      id: `tool-${index + 1}`,
      type: 'tool' as const,
      phase: 'done' as const,
      title: formatAiToolStep(call.name, call.arguments),
      content: call.result,
      toolName: call.name,
      arguments: call.arguments,
    })),
    { id: 'validate', type: 'tool' as const, phase: 'done' as const, title: '校验测试计划', content: response.validation, toolName: 'validate_test_plan', arguments: {} },
    { id: 'save', type: 'tool' as const, phase: 'done' as const, title: '保存测试计划', content: response.saveResult, toolName: 'save_test_plan', arguments: { path: response.outputPath } },
    { id: 'tree', type: 'tool' as const, phase: 'done' as const, title: '读取测试计划树', content: response.tree, toolName: 'list_test_plan_tree', arguments: {} },
    { id: 'done', type: 'done' as const, phase: 'done' as const, title: '生成完成', content: response.outputPath },
  ]
}

function toAiEvent(streamEvent: AiGenerateStreamEvent): AiGenerationEvent {
  if (streamEvent.type === 'tool') {
    return {
      id: streamEvent.stepId,
      type: 'tool',
      phase: streamEvent.phase,
      title: formatAiToolStep(streamEvent.toolName, streamEvent.arguments),
      content: streamEvent.content,
      toolName: streamEvent.toolName,
      arguments: streamEvent.arguments,
    }
  }

  if (streamEvent.type === 'done') {
    return {
      id: 'done',
      type: 'done',
      phase: 'done',
      title: '生成完成',
      content: streamEvent.content,
    }
  }

  if (streamEvent.type === 'error') {
    return {
      id: streamEvent.stepId ?? 'error',
      type: 'error',
      phase: 'done',
      title: '生成失败',
      content: streamEvent.content,
    }
  }

  return {
    id: streamEvent.stepId,
    type: 'status',
    phase: streamEvent.phase,
    title: streamEvent.title,
    content: streamEvent.content,
  }
}

/** AI 生成过程的事件播放：队列、节奏、过期令牌守卫与结果状态 */
export function useAiGenerationPlayback(options: UseAiGenerationPlaybackOptions = {}) {
  const streamGenerate = options.streamGenerate ?? generateJmeterWithAiStream
  const [events, setEvents] = useState<AiGenerationEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GeneratedPlanResult | null>(null)
  const [running, setRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<AiGenerationPlaybackTab>('process')
  const eventQueueRef = useRef<AiGenerationEvent[]>([])
  const eventStartTimeRef = useRef<Map<string, number>>(new Map())
  const queueDrainPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const generationTokenRef = useRef(0)

  const wait = (ms: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })

  const appendEvent = (event: AiGenerationEvent) => {
    setEvents((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === event.id)
      if (existingIndex >= 0) {
        const next = [...prev]
        next[existingIndex] = event
        return next
      }
      return [...prev, event]
    })
  }

  const resetEventPlayback = () => {
    eventQueueRef.current = []
    eventStartTimeRef.current = new Map()
    queueDrainPromiseRef.current = Promise.resolve()
  }

  const enqueueEvent = (event: AiGenerationEvent) => {
    eventQueueRef.current.push(event)
    queueDrainPromiseRef.current = queueDrainPromiseRef.current.then(async () => {
      const nextEvent = eventQueueRef.current.shift()
      if (!nextEvent) return

      const now = Date.now()
      const startedAt = eventStartTimeRef.current.get(nextEvent.id)

      if (nextEvent.phase === 'done' && startedAt) {
        const elapsed = now - startedAt
        if (elapsed < STEP_MIN_VISIBLE_MS) {
          await wait(STEP_MIN_VISIBLE_MS - elapsed)
        }
      }

      if (nextEvent.phase === 'start') {
        eventStartTimeRef.current.set(nextEvent.id, Date.now())
      }

      appendEvent(nextEvent)

      if (nextEvent.phase === 'done' || nextEvent.type === 'error' || nextEvent.type === 'done') {
        eventStartTimeRef.current.delete(nextEvent.id)
      }
    })

    return queueDrainPromiseRef.current
  }

  const start = async ({ prompt, modelConfig }: StartGenerationArgs) => {
    setRunning(true)
    setError(null)
    setResult(null)
    setEvents([])
    setActiveTab('process')
    resetEventPlayback()
    const generationToken = generationTokenRef.current + 1
    generationTokenRef.current = generationToken

    try {
      // 输出文件名由服务端统一生成（server/generated 下），前端不再计算 output_path。
      const preferredConfig = getPreferredAiConfig(modelConfig)
      if (!preferredConfig) {
        throw new Error('当前统一供应商缺少可用模型配置')
      }
      const generated = await streamGenerate({
        prompt,
        ai_config: preferredConfig,
      }, (streamEvent) => {
        return enqueueEvent(toAiEvent(streamEvent))
      })
      await queueDrainPromiseRef.current
      setResult(toGeneratedPlanResult(generated))
      setEvents((prev) => (prev.length > 0 ? prev : toAiEvents(generated)))
      await wait(DONE_TRANSITION_DELAY_MS)
      if (generationTokenRef.current === generationToken) {
        setActiveTab('result')
      }
    } catch (err) {
      await queueDrainPromiseRef.current
      const message = normalizeErrorMessage(err, { fallbackMessage: 'AI 生成失败，请稍后重试。' })
      setError(message)
      const streamErrorHandled = typeof err === 'object' && err !== null && '__streamEventEmitted' in err
      if (!streamErrorHandled) {
        await enqueueEvent({
          id: 'error',
          type: 'error',
          phase: 'done',
          title: '生成失败',
          content: message,
        })
      }
    } finally {
      await queueDrainPromiseRef.current
      if (generationTokenRef.current === generationToken) {
        setRunning(false)
      }
    }
  }

  const reset = () => {
    // 递增令牌使进行中的生成失效，并清空展示状态
    generationTokenRef.current += 1
    resetEventPlayback()
    setEvents([])
    setResult(null)
    setError(null)
    setRunning(false)
    setActiveTab('process')
  }

  return {
    events,
    result,
    error,
    running,
    activeTab,
    setActiveTab,
    setError,
    start,
    reset,
  }
}

export type AiGenerationPlayback = ReturnType<typeof useAiGenerationPlayback>
