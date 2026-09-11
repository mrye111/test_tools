/** 快照栈撤销/重做（地图 #13 决策）：语义变更入栈，拖拽中间态合并为一条 */

import { useCallback, useRef, useState } from 'react'
import type { BoardGraph } from './rf-types'

/** 变更语义级别：commit 入栈；transient 为拖拽中间态（合并）；silent 不动历史（选择/测量） */
export type HistoryKind = 'commit' | 'transient' | 'silent'

const HISTORY_LIMIT = 100

export interface GraphHistory {
  /** 变更落图前调用：prev 为变更前的图 */
  record(prev: BoardGraph, kind: HistoryKind): void
  /** 撤销：返回上一快照（调用方负责 setGraph），无可撤销返回 null */
  undo(current: BoardGraph): BoardGraph | null
  /** 重做：返回下一快照，无可重做返回 null */
  redo(current: BoardGraph): BoardGraph | null
  canUndo: boolean
  canRedo: boolean
  /** 外部加载新图（如打开另一文件）时清空历史 */
  reset(): void
}

export function useGraphHistory(): GraphHistory {
  const undoStack = useRef<BoardGraph[]>([])
  const redoStack = useRef<BoardGraph[]>([])
  /** 拖拽突发开始前的快照；非 null 表示正处于 transient 流中 */
  const transientBase = useRef<BoardGraph | null>(null)
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false })

  const syncFlags = useCallback(() => {
    setFlags({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 })
  }, [])

  const record = useCallback(
    (prev: BoardGraph, kind: HistoryKind) => {
      if (kind === 'silent') return
      if (kind === 'transient') {
        if (transientBase.current === null) transientBase.current = prev
        return
      }
      // commit：transient 流结束则入栈其基准快照，否则入栈 prev
      const snapshot = transientBase.current ?? prev
      transientBase.current = null
      undoStack.current.push(snapshot)
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
      redoStack.current = []
      syncFlags()
    },
    [syncFlags],
  )

  const undo = useCallback(
    (current: BoardGraph): BoardGraph | null => {
      const snapshot = undoStack.current.pop()
      if (!snapshot) return null
      transientBase.current = null
      redoStack.current.push(current)
      syncFlags()
      return snapshot
    },
    [syncFlags],
  )

  const redo = useCallback(
    (current: BoardGraph): BoardGraph | null => {
      const snapshot = redoStack.current.pop()
      if (!snapshot) return null
      transientBase.current = null
      undoStack.current.push(current)
      syncFlags()
      return snapshot
    },
    [syncFlags],
  )

  const reset = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    transientBase.current = null
    syncFlags()
  }, [syncFlags])

  return { record, undo, redo, canUndo: flags.canUndo, canRedo: flags.canRedo, reset }
}
