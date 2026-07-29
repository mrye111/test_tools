import { describe, expect, it } from 'vitest'
import { addElement, bringToFront, moveElements, removeElements, sendToBack, updateElement } from './commands'
import type { Board, DecisionTableElement } from './types'

const dt: DecisionTableElement = {
  id: 'dt1', kind: 'decision-table', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
  conditions: ['c1'], actions: ['a1'], rules: [{ conditionValues: ['Y'], actionValues: [true] }],
}
const dt2: DecisionTableElement = { ...dt, id: 'dt2' }
const base: Board = { version: 1, elements: [dt] }

describe('commands', () => {
  it('addElement do/undo 对称', () => {
    const cmd = addElement(dt2)
    const after = cmd.do(base)
    expect(after.elements.map((e) => e.id)).toEqual(['dt1', 'dt2'])
    expect(cmd.undo(after)).toEqual(base)
  })

  it('removeElements do/undo 对称（恢复原位置序）', () => {
    const board: Board = { version: 1, elements: [dt, dt2] }
    const cmd = removeElements(['dt1'])
    const after = cmd.do(board)
    expect(after.elements.map((e) => e.id)).toEqual(['dt2'])
    expect(cmd.undo(after).elements.map((e) => e.id)).toEqual(['dt1', 'dt2'])
  })

  it('moveElements 平移世界坐标，undo 还原', () => {
    const cmd = moveElements(['dt1'], 30, -10)
    const after = cmd.do(base)
    expect(after.elements[0]).toMatchObject({ x: 30, y: -10 })
    expect(cmd.undo(after).elements[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('updateElement 更新判定表条件桩', () => {
    const cmd = updateElement('dt1', (el) =>
      el.kind === 'decision-table' ? { ...el, conditions: ['新条件'] } : el)
    const after = cmd.do(base)
    expect((after.elements[0] as DecisionTableElement).conditions).toEqual(['新条件'])
    expect(cmd.undo(after)).toEqual(base)
  })

  it('bringToFront / sendToBack 调整 z 序且可撤销', () => {
    const board: Board = { version: 1, elements: [dt, dt2] }
    const cmd = bringToFront(['dt1'])
    const front = cmd.do(board)
    expect(front.elements.map((e) => e.id)).toEqual(['dt2', 'dt1'])
    expect(cmd.undo(front).elements.map((e) => e.id)).toEqual(['dt1', 'dt2'])
    const backCmd = sendToBack(['dt2'])
    const back = backCmd.do(board)
    expect(back.elements.map((e) => e.id)).toEqual(['dt2', 'dt1'])
    expect(backCmd.undo(back).elements.map((e) => e.id)).toEqual(['dt1', 'dt2'])
  })

  it('多选 bringToFront 的 undo 恢复原始 z 序', () => {
    const a = { ...dt, id: 'a' }
    const b = { ...dt, id: 'b' }
    const c = { ...dt, id: 'c' }
    const d = { ...dt, id: 'd' }
    const board: Board = { version: 1, elements: [a, b, c, d] }
    const cmd = bringToFront(['b', 'd'])
    const after = cmd.do(board)
    expect(after.elements.map((e) => e.id)).toEqual(['a', 'c', 'b', 'd'])
    expect(cmd.undo(after).elements.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('连续 bringToFront 后 undo 能回到初始顺序', () => {
    const a = { ...dt, id: 'a' }
    const b = { ...dt, id: 'b' }
    const c = { ...dt, id: 'c' }
    const board: Board = { version: 1, elements: [a, b, c] }
    const cmd1 = bringToFront(['a'])
    const step1 = cmd1.do(board)
    expect(step1.elements.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    const cmd2 = bringToFront(['a'])
    const step2 = cmd2.do(step1)
    expect(step2.elements.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    const undo2 = cmd2.undo(step2)
    expect(undo2.elements.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    const undo1 = cmd1.undo(undo2)
    expect(undo1.elements.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})
