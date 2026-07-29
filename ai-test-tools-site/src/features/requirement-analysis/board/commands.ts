/** 白板命令工厂：纯函数、不可变更新、do/undo 对称 */

import type { Board, BoardElement } from './types'

/** 命令接口：每个操作均通过 do/undo 返回新的 Board */
export interface Command {
  label: string
  do(board: Board): Board
  undo(board: Board): Board
}

/** 添加图元到最上层 */
export function addElement(el: BoardElement): Command {
  return {
    label: '添加图元',
    do: (board) => ({
      ...board,
      elements: [...board.elements, el],
    }),
    undo: (board) => ({
      ...board,
      elements: board.elements.filter((e) => e.id !== el.id),
    }),
  }
}

/** 删除指定图元，undo 时按原索引恢复其顺序 */
export function removeElements(ids: string[]): Command {
  const idSet = new Set(ids)
  let removed: { el: BoardElement; index: number }[] = []
  return {
    label: '删除图元',
    do: (board) => {
      // 记录被删图元及其原索引快照
      removed = []
      board.elements.forEach((el, index) => {
        if (idSet.has(el.id)) removed.push({ el, index })
      })
      return {
        ...board,
        elements: board.elements.filter((e) => !idSet.has(e.id)),
      }
    },
    undo: (board) => {
      const restored = [...board.elements]
      // 从后往前插入，避免前面插入导致后续索引偏移
      const sortedRemoved = [...removed].sort((a, b) => b.index - a.index)
      sortedRemoved.forEach(({ el, index }) => {
        restored.splice(index, 0, el)
      })
      return { ...board, elements: restored }
    },
  }
}

/** 平移指定图元的世界坐标 */
export function moveElements(ids: string[], dx: number, dy: number): Command {
  const idSet = new Set(ids)
  return {
    label: '移动图元',
    do: (board) => ({
      ...board,
      elements: board.elements.map((el) =>
        idSet.has(el.id) ? { ...el, x: el.x + dx, y: el.y + dy } : el
      ),
    }),
    undo: (board) => ({
      ...board,
      elements: board.elements.map((el) =>
        idSet.has(el.id) ? { ...el, x: el.x - dx, y: el.y - dy } : el
      ),
    }),
  }
}

/** 使用 updater 更新单个图元，undo 恢复为原对象 */
export function updateElement(
  id: string,
  updater: (el: BoardElement) => BoardElement
): Command {
  let original: BoardElement | undefined
  return {
    label: '更新图元',
    do: (board) => {
      original = board.elements.find((e) => e.id === id)
      return {
        ...board,
        elements: board.elements.map((el) => (el.id === id ? updater(el) : el)),
      }
    },
    undo: (board) => ({
      ...board,
      elements: original
        ? board.elements.map((el) => (el.id === id ? original! : el))
        : board.elements,
    }),
  }
}

/** 将指定图元提到最前，undo 恢复 do 前完整 z 序 */
export function bringToFront(ids: string[]): Command {
  const idSet = new Set(ids)
  let originalOrder: string[] = []
  return {
    label: '置于顶层',
    do: (board) => {
      originalOrder = board.elements.map((el) => el.id)
      const selected: BoardElement[] = []
      const rest: BoardElement[] = []
      board.elements.forEach((el) => {
        if (idSet.has(el.id)) selected.push(el)
        else rest.push(el)
      })
      return { ...board, elements: [...rest, ...selected] }
    },
    undo: (board) => ({
      ...board,
      elements: restoreByOrder(board.elements, originalOrder),
    }),
  }
}

/** 将指定图元置于底层，undo 恢复 do 前完整 z 序 */
export function sendToBack(ids: string[]): Command {
  const idSet = new Set(ids)
  let originalOrder: string[] = []
  return {
    label: '置于底层',
    do: (board) => {
      originalOrder = board.elements.map((el) => el.id)
      const selected: BoardElement[] = []
      const rest: BoardElement[] = []
      board.elements.forEach((el) => {
        if (idSet.has(el.id)) selected.push(el)
        else rest.push(el)
      })
      return { ...board, elements: [...selected, ...rest] }
    },
    undo: (board) => ({
      ...board,
      elements: restoreByOrder(board.elements, originalOrder),
    }),
  }
}

/** 批量添加图元（用于复制粘贴） */
export function copyElements(elements: BoardElement[]): Command {
  return {
    label: '粘贴图元',
    do: (board) => ({
      ...board,
      elements: [...board.elements, ...elements],
    }),
    undo: (board) => {
      const idSet = new Set(elements.map((el) => el.id))
      return {
        ...board,
        elements: board.elements.filter((e) => !idSet.has(e.id)),
      }
    },
  }
}
function restoreByOrder(elements: BoardElement[], order: string[]): BoardElement[] {
  const orderMap = new Map(order.map((id, index) => [id, index]))
  const sorted = [...elements].sort((a, b) => {
    const ia = orderMap.get(a.id)
    const ib = orderMap.get(b.id)
    if (ia === undefined || ib === undefined) return 0
    return ia - ib
  })
  return sorted
}
