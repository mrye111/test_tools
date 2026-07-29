import { describe, expect, it, vi } from 'vitest'
import { BoardStore, COMMAND_STACK_LIMIT } from './board-store'
import { addElement } from './commands'
import type { DecisionTableElement } from './types'

const dt = (id: string): DecisionTableElement => ({
  id, kind: 'decision-table', x: 0, y: 0, w: 100, h: 50, sourceNodeId: null,
  conditions: [], actions: [], rules: [],
})

describe('BoardStore', () => {
  it('execute 应用命令并通知订阅者', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    const listener = vi.fn()
    store.subscribe(listener)
    store.execute(addElement(dt('a')))
    expect(store.getBoard().elements).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('undo/redo 穿越命令栈', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    store.execute(addElement(dt('a')))
    store.execute(addElement(dt('b')))
    expect(store.canUndo()).toBe(true)
    store.undo()
    expect(store.getBoard().elements.map((e) => e.id)).toEqual(['a'])
    store.redo()
    expect(store.getBoard().elements.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('空栈 undo/redo 返回 false', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    expect(store.undo()).toBe(false)
    expect(store.redo()).toBe(false)
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)
  })

  it('新命令清空 redo 栈', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    store.execute(addElement(dt('a')))
    store.undo()
    store.execute(addElement(dt('c')))
    expect(store.canRedo()).toBe(false)
  })

  it('栈上限 100：超出后丢弃最旧命令', () => {
    const store = new BoardStore({ version: 1, elements: [] })
    for (let i = 0; i < COMMAND_STACK_LIMIT + 10; i += 1) store.execute(addElement(dt(`e${i}`)))
    let count = 0
    while (store.undo()) count += 1
    expect(count).toBe(COMMAND_STACK_LIMIT)
  })
})
