import { useCallback, useEffect, useRef, useState } from 'react'
import { updateAnalysisRecord } from '../../../lib/requirement-analysis-api'
import { serializeBoard } from './persistence'
import type { Board } from './types'

const SAVE_DEBOUNCE_MS = 1500
const RETRY_INTERVAL_MS = 10000

/**
 * 白板变更自动持久化到分析记录。
 * - board 引用变化后防抖 1.5s 触发 updateAnalysisRecord(recordId, { board })
 * - 失败时返回 saveError 文案，下一次 board 变更或 10s 后重试
 */
export function useBoardPersistence(recordId: string, board: Board): { saveError: string | null } {
  const [saveError, setSaveError] = useState<string | null>(null)
  const boardRef = useRef(board)
  const retryTimerRef = useRef<number | null>(null)
  const pendingRef = useRef(false)
  const saveRef = useRef<() => Promise<void>>(async () => {})

  const save = useCallback(async () => {
    if (!recordId) return
    try {
      await updateAnalysisRecord(recordId, { board: serializeBoard(boardRef.current) })
      setSaveError(null)
      pendingRef.current = false
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : '自动保存失败，将在下次变更后重试')
      pendingRef.current = true
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current)
      }
      retryTimerRef.current = window.setTimeout(() => {
        if (pendingRef.current) saveRef.current()
      }, RETRY_INTERVAL_MS)
    }
  }, [recordId])

  useEffect(() => {
    saveRef.current = save
  }, [save])

  useEffect(() => {
    boardRef.current = board
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    const timer = window.setTimeout(() => {
      void saveRef.current()
    }, SAVE_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [board, recordId, saveRef])

  return { saveError }
}
