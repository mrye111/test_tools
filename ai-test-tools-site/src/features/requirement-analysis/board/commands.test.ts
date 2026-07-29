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
    const front = bringToFront(['dt1']).do(board)
    expect(front.elements.map((e) => e.id)).toEqual(['dt2', 'dt1'])
    expect(bringToFront(['dt1']).undo(front).elements.map((e) => e.id)).toEqual(['dt1', 'dt2'])
    const back = sendToBack(['dt2']).do(board)
    expect(back.elements.map((e) => e.id)).toEqual(['dt2', 'dt1'])
  })
})
