import { useCallback, useEffect, useRef, useState } from 'react'
import type { RequirementAnalysisStreamEvent } from '../../lib/requirement-analysis-api'

/**
 * 分析过程面板的有序块模型：reasoning 为推理链、content 为正文流、
 * notice 为提示信息行、attempt 为重试分隔提示条。
 */
export type AnalysisProcessBlock =
  | { kind: 'reasoning' | 'content' | 'notice'; text: string }
  | { kind: 'attempt'; reason: string }

/** 前端合帧窗口：流式 chunk 先进缓冲，按窗口合并进 React state，避免几百次 setState。 */
const PROCESS_FLUSH_INTERVAL_MS = 100

function appendBlock(current: AnalysisProcessBlock[], block: AnalysisProcessBlock): AnalysisProcessBlock[] {
  const last = current[current.length - 1]
  // 相邻同 kind 的文本块合并，attempt 永远是独立分隔条。
  if (block.kind !== 'attempt' && last && last.kind === block.kind) {
    const merged = [...current]
    merged[merged.length - 1] = { kind: last.kind, text: `${last.text}${block.text}` }
    return merged
  }
  return [...current, block]
}

/**
 * 需求分析过程流：把 analyzeRequirement 的 stream/attempt 事件累积成有序块列表。
 * 小 chunk 在 ref 缓冲里按 ~100ms 合帧后再进 state；finish() 强制 flush 残余缓冲。
 */
export function useAnalysisProcessStream() {
  const [blocks, setBlocks] = useState<AnalysisProcessBlock[]>([])
  const bufferRef = useRef<Array<{ kind: 'reasoning' | 'content'; text: string }>>([])
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const flush = useCallback(() => {
    clearTimer()
    const buffered = bufferRef.current
    if (!buffered.length) return
    bufferRef.current = []
    setBlocks((current) => buffered.reduce(appendBlock, current))
  }, [clearTimer])

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      flush()
    }, PROCESS_FLUSH_INTERVAL_MS)
  }, [flush])

  const handleEvent = useCallback((event: RequirementAnalysisStreamEvent) => {
    if (event.type === 'stream') {
      // notice 立即成块（先 flush 缓冲，保持顺序），reasoning/content 进合帧缓冲。
      if (event.kind === 'notice') {
        flush()
        setBlocks((current) => appendBlock(current, { kind: 'notice', text: event.text }))
        return
      }
      const buffered = bufferRef.current
      const last = buffered[buffered.length - 1]
      if (last && last.kind === event.kind) last.text += event.text
      else buffered.push({ kind: event.kind, text: event.text })
      scheduleFlush()
      return
    }
    if (event.type === 'attempt') {
      // 重试分隔：先 flush 上一次尝试的缓冲，再插入分隔提示条。
      flush()
      setBlocks((current) => appendBlock(current, { kind: 'attempt', reason: event.reason }))
    }
  }, [flush, scheduleFlush])

  const reset = useCallback(() => {
    clearTimer()
    bufferRef.current = []
    setBlocks([])
  }, [clearTimer])

  useEffect(() => clearTimer, [clearTimer])

  return { blocks, handleEvent, finish: flush, reset }
}
