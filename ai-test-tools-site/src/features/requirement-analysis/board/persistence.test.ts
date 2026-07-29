import { describe, expect, it } from 'vitest'
import { deserializeBoard, emptyBoard, serializeBoard } from './persistence'
import type { Board } from './types'

const board: Board = {
  version: 1,
  elements: [
    {
      id: 'el-1', kind: 'mindmap-ref', x: 0, y: 0, w: 400, h: 300, sourceNodeId: null,
      selectedNodeId: null,
    },
    {
      id: 'el-2', kind: 'cause-effect', x: 500, y: 0, w: 600, h: 400, sourceNodeId: 'n1',
      nodes: [{ id: 'c1', role: 'cause', text: '短信≤210字', x: 0, y: 0 }],
      edges: [{ id: 'e1', from: 'c1', to: 'c2', constraint: 'identity' }],
    },
    {
      id: 'el-3', kind: 'decision-table', x: 0, y: 500, w: 500, h: 200, sourceNodeId: 'n1',
      conditions: ['字数≤210'], actions: ['按单条计费'],
      rules: [{ conditionValues: ['Y'], actionValues: [true] }],
    },
    {
      id: 'el-4', kind: 'orthogonal', x: 600, y: 500, w: 400, h: 200, sourceNodeId: null,
      factors: [{ name: '渠道', levels: ['短信', '邮件'] }],
      arrayName: 'L4(2^3)', rows: [['短信'], ['邮件']],
    },
  ],
}

describe('board persistence', () => {
  it('序列化/反序列化往返一致', () => {
    expect(deserializeBoard(JSON.parse(serializeBoard(board)))).toEqual(board)
  })

  it('空白板往返', () => {
    expect(deserializeBoard(JSON.parse(serializeBoard(emptyBoard())))).toEqual({ version: 1, elements: [] })
  })

  it('非对象输入返回 null', () => {
    expect(deserializeBoard(null)).toBeNull()
    expect(deserializeBoard('x')).toBeNull()
    expect(deserializeBoard([1])).toBeNull()
  })

  it('version 缺失或不支持返回 null', () => {
    expect(deserializeBoard({ elements: [] })).toBeNull()
    expect(deserializeBoard({ version: 2, elements: [] })).toBeNull()
  })

  it('elements 中坏图元被过滤，合法图元保留', () => {
    const parsed = deserializeBoard({
      version: 1,
      elements: [null, 'bad', board.elements[0], { kind: 'cause-effect' }],
    })
    expect(parsed?.elements).toHaveLength(1)
    expect(parsed?.elements[0].id).toBe('el-1')
  })

  it('kind 未知返回 null（整个图元被过滤）', () => {
    const parsed = deserializeBoard({ version: 1, elements: [{ ...board.elements[0], kind: 'sticky' }] })
    expect(parsed?.elements).toHaveLength(0)
  })
})
