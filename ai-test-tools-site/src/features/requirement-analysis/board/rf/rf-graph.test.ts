import { describe, expect, it } from 'vitest'
import {
  countElements,
  connectNodes,
  draftToRfGraph,
  elementToRf,
  emptyGraph,
  markPendingNodeError,
  createPendingNode,
  nextConstraint,
  nodeToDecisionTableElement,
  reconstructCauseEffectElement,
  updateNodeText,
} from './rf-graph'
import type { BoardElement } from '../types'

describe('rf-graph 转换与重建', () => {
  it('elementToRf：因果图拆为一等节点+边，坐标绝对化', () => {
    const element: BoardElement = {
      id: 'ce-1',
      kind: 'cause-effect',
      x: 100,
      y: 50,
      w: 480,
      h: 320,
      sourceNodeId: 'n1',
      nodes: [
        { id: 'c1', role: 'cause', text: '原因', x: 20, y: 30 },
        { id: 'e1', role: 'effect', text: '结果', x: 200, y: 30 },
      ],
      edges: [{ id: 'edge1', from: 'c1', to: 'e1', constraint: 'and' }],
    }
    const graph = elementToRf(element)
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0].position).toEqual({ x: 120, y: 80 })
    expect(graph.nodes[0].data).toMatchObject({ kind: 'ce-node', groupId: 'ce-1', role: 'cause' })
    expect(graph.edges[0]).toMatchObject({ source: 'c1', target: 'e1', data: { groupId: 'ce-1', constraint: 'and' } })
  })

  it('reconstructCauseEffectElement：从 RF 图重建 derive 输入（坐标相对化）', () => {
    const element: BoardElement = {
      id: 'ce-1',
      kind: 'cause-effect',
      x: 100,
      y: 50,
      w: 480,
      h: 320,
      sourceNodeId: 'n1',
      nodes: [
        { id: 'c1', role: 'cause', text: '原因', x: 20, y: 30 },
        { id: 'e1', role: 'effect', text: '结果', x: 200, y: 30 },
      ],
      edges: [{ id: 'edge1', from: 'c1', to: 'e1', constraint: 'or' }],
    }
    const graph = elementToRf(element)
    // 模拟用户拖动 c1 向右下 10px
    graph.nodes[0] = { ...graph.nodes[0], position: { x: 130, y: 90 } }

    const rebuilt = reconstructCauseEffectElement(graph, 'ce-1')
    expect(rebuilt).not.toBeNull()
    expect(rebuilt!.id).toBe('ce-1')
    expect(rebuilt!.sourceNodeId).toBe('n1')
    expect(rebuilt!.nodes).toHaveLength(2)
    expect(rebuilt!.edges).toHaveLength(1)
    expect(rebuilt!.edges[0].constraint).toBe('or')
    // 原点 = 最小坐标；c1 拖动后成为原点
    expect(rebuilt!.x).toBe(130)
    expect(rebuilt!.y).toBe(80)
  })

  it('draftToRfGraph：AI 草稿校验后落为 RF 节点组', () => {
    const draft = {
      nodes: [
        { id: 'a', role: 'cause', text: '输入超 210 字', x: 0, y: 0 },
        { id: 'b', role: 'effect', text: '拆分发送', x: 260, y: 0 },
      ],
      edges: [{ id: 'e', from: 'a', to: 'b', constraint: 'identity' }],
    }
    const graph = draftToRfGraph(draft, 'cause-effect', 'n1')
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
    const groupIds = new Set(graph.nodes.map((n) => (n.data as { groupId: string }).groupId))
    expect(groupIds.size).toBe(1)
  })

  it('draftToRfGraph：坏草稿抛校验错误', () => {
    expect(() => draftToRfGraph({ nodes: [] }, 'cause-effect', null)).toThrow(/AI 草稿校验失败/)
  })

  it('占位节点：创建、错误标记、不参与图元计数之外的流程', () => {
    const pending = createPendingNode('decision-table', 'n1')
    expect(pending.data.kind).toBe('chart-pending')
    const errored = markPendingNodeError(pending, '生成失败')
    expect(errored.data).toMatchObject({ kind: 'chart-pending', error: '生成失败' })
    // 非占位节点不受标记影响
    const dtGraph = elementToRf({
      id: 'dt-1',
      kind: 'decision-table',
      x: 0,
      y: 0,
      w: 400,
      h: 200,
      sourceNodeId: null,
      conditions: ['c'],
      actions: ['a'],
      rules: [{ conditionValues: ['Y'], actionValues: [true] }],
    })
    expect(markPendingNodeError(dtGraph.nodes[0], 'x')).toBe(dtGraph.nodes[0])
  })

  it('countElements：CE 组算一个图元', () => {
    const graph = emptyGraph()
    const ce = elementToRf({
      id: 'ce-1',
      kind: 'cause-effect',
      x: 0,
      y: 0,
      w: 480,
      h: 320,
      sourceNodeId: null,
      nodes: [
        { id: 'c1', role: 'cause', text: 'a', x: 0, y: 0 },
        { id: 'c2', role: 'cause', text: 'b', x: 0, y: 60 },
      ],
      edges: [],
    })
    graph.nodes.push(...ce.nodes)
    graph.nodes.push(createPendingNode('orthogonal', null))
    expect(countElements(graph)).toBe(2)
  })

  it('nodeToDecisionTableElement：供 handoff/正交表推导复用', () => {
    const graph = elementToRf({
      id: 'dt-1',
      kind: 'decision-table',
      x: 10,
      y: 20,
      w: 400,
      h: 200,
      sourceNodeId: 'n1',
      conditions: ['密码正确'],
      actions: ['登录成功'],
      rules: [{ conditionValues: ['N'], actionValues: [false] }],
    })
    const el = nodeToDecisionTableElement(graph.nodes[0])
    expect(el).not.toBeNull()
    expect(el!.conditions).toEqual(['密码正确'])
    expect(el!.rules[0].conditionValues).toEqual(['N'])
    expect(el!.x).toBe(10)
    expect(el!.y).toBe(20)
  })
})

describe('连线与文本编辑（#19）', () => {
  function ceGraph(): ReturnType<typeof elementToRf> {
    return elementToRf({
      id: 'ce-1',
      kind: 'cause-effect',
      x: 0,
      y: 0,
      w: 480,
      h: 320,
      sourceNodeId: null,
      nodes: [
        { id: 'c1', role: 'cause', text: '原因A', x: 0, y: 0 },
        { id: 'c2', role: 'cause', text: '原因B', x: 0, y: 80 },
        { id: 'e1', role: 'effect', text: '结果', x: 260, y: 40 },
      ],
      edges: [],
    })
  }

  it('connectNodes：同组 CE 节点连线默认 identity 约束', () => {
    const graph = ceGraph()
    const edge = connectNodes(graph, 'c1', 'e1')
    expect(edge).not.toBeNull()
    expect(edge!.data).toMatchObject({ groupId: 'ce-1', constraint: 'identity' })
    expect(edge!.type).toBe('ce-edge')
  })

  it('connectNodes：拒绝自连与跨组/跨类型连接', () => {
    const graph = ceGraph()
    const other = elementToRf({
      id: 'ce-2',
      kind: 'cause-effect',
      x: 600,
      y: 0,
      w: 480,
      h: 320,
      sourceNodeId: null,
      nodes: [{ id: 'x1', role: 'cause', text: '别的图', x: 0, y: 0 }],
      edges: [],
    })
    graph.nodes.push(...other.nodes)
    expect(connectNodes(graph, 'c1', 'c1')).toBeNull()
    expect(connectNodes(graph, 'c1', 'x1')).toBeNull()
  })

  it('nextConstraint 循环 identity→and→or→not→identity', () => {
    expect(nextConstraint('identity')).toBe('and')
    expect(nextConstraint('and')).toBe('or')
    expect(nextConstraint('or')).toBe('not')
    expect(nextConstraint('not')).toBe('identity')
  })

  it('updateNodeText：更新 CE 节点文案，空文本不动图', () => {
    const graph = ceGraph()
    const next = updateNodeText(graph, 'c1', '  修改后的原因  ')
    expect(next.nodes[0].data).toMatchObject({ text: '修改后的原因' })
    expect(graph.nodes[0].data).toMatchObject({ text: '原因A' }) // 原图不可变
    expect(updateNodeText(graph, 'c1', '   ')).toBe(graph)
  })
})
