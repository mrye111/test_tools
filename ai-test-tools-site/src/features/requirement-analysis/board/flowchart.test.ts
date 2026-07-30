import { describe, expect, it } from 'vitest'
import { draftToElement } from './ai'
import { deserializeBoard, serializeBoard } from './persistence'
import { hitTestElement } from './hit-test'
import type { Board, FlowchartElement, FlowchartNodeKind } from './types'

function flowchartEl(overrides: Partial<FlowchartElement> = {}): FlowchartElement {
  return {
    id: 'fc1',
    kind: 'flowchart',
    x: 100,
    y: 100,
    w: 480,
    h: 320,
    sourceNodeId: 'n1',
    nodes: [
      { id: 'start', kind: 'start' as FlowchartNodeKind, text: '开始', x: 0, y: 0 },
      { id: 'p1', kind: 'process' as FlowchartNodeKind, text: '处理', x: 200, y: 0 },
      { id: 'd1', kind: 'decision' as FlowchartNodeKind, text: '判断', x: 400, y: 0 },
      { id: 'end', kind: 'end' as FlowchartNodeKind, text: '结束', x: 600, y: 0 },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'p1', label: '下一步' },
      { id: 'e2', from: 'p1', to: 'd1' },
      { id: 'e3', from: 'd1', to: 'end', label: '是' },
    ],
    ...overrides,
  }
}

describe('flowchart persistence', () => {
  it('序列化/反序列化往返一致', () => {
    const board: Board = { version: 1, elements: [flowchartEl()] }
    expect(deserializeBoard(JSON.parse(serializeBoard(board)))).toEqual(board)
  })

  it('pending/error 会话态被剥离', () => {
    const board: Board = { version: 1, elements: [{ ...flowchartEl(), pending: true, error: 'x' }] }
    const parsed = deserializeBoard(JSON.parse(serializeBoard(board)))
    expect(parsed?.elements).toHaveLength(1)
    expect(parsed?.elements[0].pending).toBeUndefined()
    expect(parsed?.elements[0].error).toBeUndefined()
  })

  it('坏图元被过滤：非法 kind、悬挂 edge、超长文本', () => {
    const bad: unknown[] = [
      flowchartEl({ nodes: [{ id: 'a', kind: 'bad-kind' as FlowchartNodeKind, text: 'x', x: 0, y: 0 }] }),
      flowchartEl({ edges: [{ id: 'e', from: 'missing', to: 'start' }] }),
      flowchartEl({ nodes: [{ id: 'a', kind: 'start', text: 'x'.repeat(201), x: 0, y: 0 }] }),
    ]
    const parsed = deserializeBoard({ version: 1, elements: bad })
    expect(parsed?.elements).toHaveLength(0)
  })
})

describe('flowchart draftToElement', () => {
  it('合法草稿转成图元并像素化坐标、计算尺寸', () => {
    const board: Board = { version: 1, elements: [] }
    const draft = {
      nodes: [
        { id: 's', kind: 'start', text: '开始', x: 0.5, y: 1.2 },
        { id: 'p', kind: 'process', text: '处理', x: 200.8, y: 1.2 },
      ],
      edges: [{ from: 's', to: 'p' }],
    }
    const el = draftToElement(draft, 'flowchart', 'n1', board) as FlowchartElement
    expect(el.kind).toBe('flowchart')
    expect(el.nodes).toHaveLength(2)
    expect(el.nodes[0].x).toBeLessThan(el.nodes[1].x)
    expect(el.nodes[0].y).toBe(el.nodes[1].y)
    expect(el.w).toBeGreaterThanOrEqual(200)
    expect(el.h).toBeGreaterThanOrEqual(40)
    expect(el.edges[0].from).toBe(el.nodes[0].id)
    expect(el.edges[0].to).toBe(el.nodes[1].id)
  })

  it('非法 kind 草稿抛错', () => {
    const board: Board = { version: 1, elements: [] }
    const draft = {
      nodes: [{ id: 's', kind: 'bad', text: 'x', x: 0, y: 0 }],
      edges: [],
    }
    expect(() => draftToElement(draft, 'flowchart', 'n1', board)).toThrow()
  })

  it('悬挂边草稿抛错', () => {
    const board: Board = { version: 1, elements: [] }
    const draft = {
      nodes: [{ id: 's', kind: 'start', text: 'x', x: 0, y: 0 }],
      edges: [{ from: 's', to: 'missing' }],
    }
    expect(() => draftToElement(draft, 'flowchart', 'n1', board)).toThrow()
  })
})

describe('flowchart hit-test', () => {
  const el = flowchartEl()

  it('水平同 y 边命中返回 part: edge', () => {
    // 源与目标在同一水平线：start(0,0) 与 process(200,0)
    // 图元原点在 (100,100)，折线退化为水平线：从 (180,100) 到 (220,100)
    const horizontal: FlowchartElement = {
      ...flowchartEl(),
      nodes: [
        { id: 'start', kind: 'start' as FlowchartNodeKind, text: '开始', x: 0, y: 0 },
        { id: 'process', kind: 'process' as FlowchartNodeKind, text: '处理', x: 200, y: 0 },
      ],
      edges: [{ id: 'e-horizontal', from: 'start', to: 'process' }],
    }
    const hit = hitTestElement(horizontal, 200, 103)
    expect(hit?.elementId).toBe('fc1')
    expect(hit?.part).toBe('edge')
  })

  it('边命中返回 part: edge', () => {
    // 图元原点在 (100,100)；start 节点中心在 (100,100)，p1 节点中心在 (300,100)
    // 折线从 start -> (200,100) -> p1；取中点正下方 (200,103) 应命中边且不在节点包围盒内
    const hit = hitTestElement(el, 200, 103)
    expect(hit?.elementId).toBe('fc1')
    expect(hit?.part).toBe('edge')
  })
})
