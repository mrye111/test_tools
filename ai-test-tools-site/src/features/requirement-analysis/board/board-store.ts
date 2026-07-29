/** 白板命令存储：持有撤销/重做栈，变更通知订阅者 */

import type { Board } from './types'
import type { Command } from './commands'

/** 命令栈上限，防止内存无限增长 */
export const COMMAND_STACK_LIMIT = 100

/** 白板状态容器，管理 undo/redo 栈与变更订阅 */
export class BoardStore {
  private board: Board

  private undoStack: Command[] = []

  private redoStack: Command[] = []

  private listeners: Set<() => void> = new Set()

  private onChange?: (board: Board) => void

  constructor(initialBoard: Board, onChange?: (board: Board) => void) {
    this.board = initialBoard
    this.onChange = onChange
  }

  /** 获取当前 board 快照 */
  getBoard(): Board {
    return this.board
  }

  /** 设置变更回调（用于画板壳将内部命令同步给父级持久化） */
  setOnChange(onChange: (board: Board) => void): void {
    this.onChange = onChange
  }

  /** 外部加载新 board（如父级从服务端反序列化后传入），清空命令栈 */
  loadBoard(board: Board): void {
    this.board = board
    this.undoStack = []
    this.redoStack = []
    this.notify()
  }

  /** 直接替换 board（用于占位图元等不进入命令栈的临时状态） */
  replaceBoard(board: Board): void {
    this.board = board
    this.notify()
  }

  /** 执行命令：应用 do、入 undo 栈、清空 redo 栈并通知 */
  execute(cmd: Command): void {
    this.board = cmd.do(this.board)
    this.undoStack.push(cmd)
    if (this.undoStack.length > COMMAND_STACK_LIMIT) {
      this.undoStack.shift()
    }
    this.redoStack = []
    this.notify()
    this.onChange?.(this.board)
  }

  /** 撤销：undo 栈顶命令回退并移入 redo 栈 */
  undo(): boolean {
    const cmd = this.undoStack.pop()
    if (!cmd) return false
    this.board = cmd.undo(this.board)
    this.redoStack.push(cmd)
    this.notify()
    this.onChange?.(this.board)
    return true
  }

  /** 重做：redo 栈顶命令重新应用并移入 undo 栈 */
  redo(): boolean {
    const cmd = this.redoStack.pop()
    if (!cmd) return false
    this.board = cmd.do(this.board)
    this.undoStack.push(cmd)
    this.notify()
    this.onChange?.(this.board)
    return true
  }

  /** 是否可撤销 */
  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /** 是否可重做 */
  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** 订阅变更通知，返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener())
  }
}
