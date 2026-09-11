import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeErrorMessage } from '../../../lib/app-error'

const SAVE_DEBOUNCE_MS = 1500
const RETRY_INTERVAL_MS = 10000

/**
 * 画板变更自动持久化到外部保存函数（泛型：调用方传入可序列化快照）。
 * - value 引用变化后防抖 1.5s 触发 saveFn(value)
 * - 失败时返回 saveError 文案，下一次变更或 10s 后重试
 */
export function useBoardPersistence<T>(
  saveFn: (value: T) => Promise<void>,
  value: T,
): { saveError: string | null } {
  const [saveError, setSaveError] = useState<string | null>(null)
  const valueRef = useRef(value)
  const retryTimerRef = useRef<number | null>(null)
  const pendingRef = useRef(false)
  const saveRef = useRef<() => Promise<void>>(async () => {})

  const save = useCallback(async () => {
    try {
      await saveFn(valueRef.current)
      setSaveError(null)
      pendingRef.current = false
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    } catch (err: unknown) {
      setSaveError(normalizeErrorMessage(err, { fallbackMessage: '自动保存失败，将在下次变更后重试' }))
      pendingRef.current = true
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current)
      }
      retryTimerRef.current = window.setTimeout(() => {
        if (pendingRef.current) saveRef.current()
      }, RETRY_INTERVAL_MS)
    }
  }, [saveFn])

  useEffect(() => {
    saveRef.current = save
  }, [save])

  useEffect(() => {
    valueRef.current = value
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
  }, [value, saveFn, saveRef])

  return { saveError }
}
