import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useGraphHistory } from './useGraphHistory'
import type { BoardGraph } from './rf-types'

function graph(label: string): BoardGraph {
  return {
    nodes: [{ id: label, type: 'mindmap-ref', position: { x: 0, y: 0 }, data: { kind: 'mindmap-ref', selectedNodeId: null } }],
    edges: [],
  }
}

describe('useGraphHistory 快照栈', () => {
  it('commit 入栈，undo/redo 往返', () => {
    const { result } = renderHook(() => useGraphHistory())
    expect(result.current.canUndo).toBe(false)

    const g1 = graph('g1')
    const g2 = graph('g2')
    const g3 = graph('g3')

    act(() => result.current.record(g1, 'commit')) // g1 → g2
    act(() => result.current.record(g2, 'commit')) // g2 → g3
    expect(result.current.canUndo).toBe(true)

    let back: BoardGraph | null = null
    act(() => {
      back = result.current.undo(g3)
    })
    expect(back?.nodes[0].id).toBe('g2')
    expect(result.current.canRedo).toBe(true)

    act(() => {
      back = result.current.undo(g2)
    })
    expect(back?.nodes[0].id).toBe('g1')
    expect(result.current.canUndo).toBe(false)

    let fwd: BoardGraph | null = null
    act(() => {
      fwd = result.current.redo(g1)
    })
    expect(fwd?.nodes[0].id).toBe('g2')
  })

  it('transient 流合并为一条历史（拖拽中间态不入栈）', () => {
    const { result } = renderHook(() => useGraphHistory())
    const before = graph('before')

    act(() => result.current.record(before, 'transient')) // dragStart
    act(() => result.current.record(graph('mid-1'), 'transient'))
    act(() => result.current.record(graph('mid-2'), 'transient'))
    act(() => result.current.record(graph('final'), 'commit')) // dragStop

    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)

    let back: BoardGraph | null = null
    act(() => {
      back = result.current.undo(graph('final'))
    })
    // 一次撤销直接回到拖拽前
    expect(back?.nodes[0].id).toBe('before')
    expect(result.current.canUndo).toBe(false)
  })

  it('silent 不动历史', () => {
    const { result } = renderHook(() => useGraphHistory())
    act(() => result.current.record(graph('g1'), 'silent'))
    expect(result.current.canUndo).toBe(false)
  })

  it('新 commit 清空 redo 栈', () => {
    const { result } = renderHook(() => useGraphHistory())
    const g1 = graph('g1')
    const g2 = graph('g2')
    act(() => result.current.record(g1, 'commit'))
    act(() => result.current.undo(g2))
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.record(g1, 'commit')) // 新分支
    expect(result.current.canRedo).toBe(false)
  })

  it('栈上限裁剪：最多保留 100 条', () => {
    const { result } = renderHook(() => useGraphHistory())
    for (let i = 0; i < 110; i++) {
      act(() => result.current.record(graph(`g${i}`), 'commit'))
    }
    let count = 0
    let current = graph('latest')
    while (true) {
      let next: BoardGraph | null = null
      act(() => {
        next = result.current.undo(current)
      })
      if (!next) break
      current = next
      count += 1
    }
    expect(count).toBe(100)
  })

  it('reset 清空历史', () => {
    const { result } = renderHook(() => useGraphHistory())
    act(() => result.current.record(graph('g1'), 'commit'))
    act(() => result.current.reset())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.undo(graph('g2'))).toBeNull()
  })
})
