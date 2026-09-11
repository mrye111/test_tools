import { describe, expect, it } from 'vitest'
import { deserializeRfBoard, serializeRfBoard } from './rf-persistence'
import { boardToRf, emptyGraph } from './rf-graph'
import type { Board } from '../types'
import type { BoardGraph } from './rf-types'

const sampleBoard: Board = {
  version: 1,
  elements: [
    {
      id: 'ce-1',
      kind: 'cause-effect',
      x: 100,
      y: 80,
      w: 480,
      h: 320,
      sourceNodeId: 'n1',
      nodes: [
        { id: 'c1', role: 'cause', text: '密码错误≥5次', x: 20, y: 40 },
        { id: 'e1', role: 'effect', text: '账号锁定', x: 300, y: 40 },
      ],
      edges: [{ id: 'e-1', from: 'c1', to: 'e1', constraint: 'identity' }],
    },
    {
      id: 'dt-1',
      kind: 'decision-table',
      x: 700,
      y: 80,
      w: 400,
      h: 200,
      sourceNodeId: 'n1',
      conditions: ['密码正确'],
      actions: ['登录成功'],
      rules: [{ conditionValues: ['Y'], actionValues: [true] }],
    },
    {
      id: 'mm-1',
      kind: 'mindmap-ref',
      x: 40,
      y: 400,
      w: 320,
      h: 200,
      sourceNodeId: null,
      selectedNodeId: 'n1',
    },
  ],
}

describe('rf-persistence 序列化往返', () => {
  it('boardToRf → 序列化 → 反序列化保持语义', () => {
    const graph = boardToRf(sampleBoard)
    expect(graph.nodes).toHaveLength(4) // 2 CE 子节点 + DT + mindmap
    expect(graph.edges).toHaveLength(1)

    const snapshot = serializeRfBoard(graph, { x: 10, y: 20, zoom: 1.5 })
    const parsed = deserializeRfBoard(JSON.parse(snapshot))
    expect(parsed).not.toBeNull()
    expect(parsed!.nodes).toHaveLength(4)
    expect(parsed!.edges).toHaveLength(1)
    expect(parsed!.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 })

    const ceNode = parsed!.nodes.find((n) => n.id === 'c1')
    expect(ceNode?.data.kind).toBe('ce-node')
    expect(ceNode?.position).toEqual({ x: 120, y: 120 })

    const edge = parsed!.edges[0]
    expect(edge.data?.constraint).toBe('identity')
    expect(edge.data?.groupId).toBe('ce-1')
  })

  it('mindmap-ref 的 selectedNodeId 为会话态，序列化时剥离', () => {
    const graph = boardToRf(sampleBoard)
    const snapshot = serializeRfBoard(graph)
    expect(snapshot).not.toContain('selectedNodeId":"n1')

    const parsed = deserializeRfBoard(JSON.parse(snapshot))
    const mm = parsed!.nodes.find((n) => n.id === 'mm-1')
    expect(mm?.data.kind).toBe('mindmap-ref')
    expect(mm?.data).toEqual({ kind: 'mindmap-ref', selectedNodeId: null })
  })

  it('chart-pending 节点不持久化', () => {
    const graph: BoardGraph = {
      nodes: [
        {
          id: 'p-1',
          type: 'chart-pending',
          position: { x: 40, y: 40 },
          data: { kind: 'chart-pending', chartKind: 'cause-effect', sourceNodeId: 'n1' },
        },
      ],
      edges: [],
    }
    const parsed = deserializeRfBoard(JSON.parse(serializeRfBoard(graph)))
    expect(parsed!.nodes).toHaveLength(0)
  })

  it('旧 version 1 数据返回 null（不做迁移）', () => {
    expect(deserializeRfBoard({ version: 1, elements: [] })).toBeNull()
    expect(deserializeRfBoard(JSON.parse(serializeRfBoard(emptyGraph())))).not.toBeNull()
  })

  it('坏图元被过滤：缺 position / 未知 type / 悬空边', () => {
    const snapshot = {
      version: 2,
      nodes: [
        { id: 'ok', type: 'mindmap-ref', position: { x: 0, y: 0 }, data: { kind: 'mindmap-ref' } },
        { id: 'bad-pos', type: 'mindmap-ref', data: { kind: 'mindmap-ref' } },
        { id: 'bad-type', type: 'unknown', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', type: 'ce-edge', source: 'ok', target: 'ghost', data: { groupId: 'g', constraint: 'and' } },
      ],
    }
    const parsed = deserializeRfBoard(snapshot)
    expect(parsed).not.toBeNull()
    expect(parsed!.nodes.map((n) => n.id)).toEqual(['ok'])
    expect(parsed!.edges).toHaveLength(0)
  })
})
