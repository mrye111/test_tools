import { describe, expect, it } from 'vitest'
import { deserializeRfBoard, serializeRfBoard } from './rf-persistence'
import type { BoardGraph } from './rf-types'

const graph: BoardGraph = {
  nodes: [
    { id: 'a', position: { x: 10, y: 20 }, data: { label: '开始' } },
    { id: 'b', position: { x: 200, y: 20 }, data: { label: '结束' }, selected: true },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b', selected: true }],
}

describe('rf-persistence（v3 纯白板）', () => {
  it('序列化往返保持节点/边/视口，选中态剥离', () => {
    const snapshot = serializeRfBoard(graph, { x: 1, y: 2, zoom: 1.5 })
    const parsed = deserializeRfBoard(JSON.parse(snapshot))
    expect(parsed).not.toBeNull()
    expect(parsed!.nodes).toHaveLength(2)
    expect(parsed!.edges).toHaveLength(1)
    expect(parsed!.viewport).toEqual({ x: 1, y: 2, zoom: 1.5 })
    expect(parsed!.nodes[1].selected).toBeFalsy()
    expect(parsed!.edges[0].selected).toBeFalsy()
  })

  it('旧版本（v1 语义图元 / v2 自定义节点）返回 null，读为空画板', () => {
    expect(deserializeRfBoard({ version: 1, elements: [] })).toBeNull()
    expect(deserializeRfBoard({ version: 2, nodes: [], edges: [] })).toBeNull()
  })

  it('坏数据过滤：缺 position 的节点、悬空边', () => {
    const parsed = deserializeRfBoard({
      version: 3,
      nodes: [
        { id: 'ok', position: { x: 0, y: 0 }, data: { label: 'A' } },
        { id: 'bad', data: { label: 'B' } },
      ],
      edges: [{ id: 'e1', source: 'ok', target: 'ghost' }],
    })
    expect(parsed!.nodes.map((n) => n.id)).toEqual(['ok'])
    expect(parsed!.edges).toHaveLength(0)
  })
})
