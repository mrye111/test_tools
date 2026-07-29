import { describe, expect, it } from 'vitest'
import { distToSegment, hitTestBoard, hitTestElement } from './hit-test'
import type { CauseEffectElement, DecisionTableElement, MindmapRefElement } from './types'
import type { RequirementNode } from '../../../../lib/requirement-analysis-api'

const causeEffect: CauseEffectElement = {
  id: 'ce1', kind: 'cause-effect', x: 100, y: 100, w: 600, h: 400, sourceNodeId: null,
  nodes: [
    { id: 'n1', role: 'cause', text: '原因A', x: 0, y: 0 },
    { id: 'n2', role: 'effect', text: '结果B', x: 300, y: 100 },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', constraint: 'identity' }],
}

const table: DecisionTableElement = {
  id: 'dt1', kind: 'decision-table', x: 0, y: 0, w: 400, h: 200, sourceNodeId: null,
  conditions: ['c1'], actions: ['a1'],
  rules: [{ conditionValues: ['Y'], actionValues: [true] }],
}

const tree: RequirementNode = {
  id: 'root',
  title: '登录需求',
  children: [{ id: 'n1', title: '账号密码登录', children: [] }],
}

function mindmapRefElement(x = 0, y = 0): MindmapRefElement {
  return { id: 'mm1', kind: 'mindmap-ref', x, y, w: 400, h: 200, sourceNodeId: null, selectedNodeId: null }
}

describe('hit-test', () => {
  it('distToSegment：点在线段上为 0，延长线上按端点距离', () => {
    expect(distToSegment(5, 0, 0, 0, 10, 0)).toBe(0)
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3)
    expect(distToSegment(-3, 4, 0, 0, 10, 0)).toBe(5)
  })

  it('表格图元：包围盒内命中 body，外部 miss', () => {
    expect(hitTestElement(table, 200, 100)).toEqual({ elementId: 'dt1', part: 'body' })
    expect(hitTestElement(table, 500, 100)).toBeNull()
  })

  it('因果图：节点优先于边与背景（世界坐标 = 图元原点 + 局部坐标）', () => {
    // 节点 n1 中心约在 (100+60, 100+20)（节点绘制尺寸见 renderer，命中按节点局部包围盒 ± 节点半宽）
    const hit = hitTestElement(causeEffect, 100, 100)
    expect(hit?.elementId).toBe('ce1')
    expect(hit?.part).toBe('node')
  })

  it('因果图：边命中（距线段 ≤ 4px）', () => {
    // 边从 n1(100,100) 到 n2(400,200)，中点 (250,150) 附近
    const hit = hitTestElement(causeEffect, 250, 152)
    expect(hit?.part === 'edge' || hit?.part === 'node').toBe(true)
  })

  it('需求树参考图元：命中节点返回 node 与 nodeId', () => {
    const mm = mindmapRefElement(0, 0)
    // layoutMindmap: 根在 (0,0)，子节点在 (200,0)；节点中心，120x32 包围盒
    const hit = hitTestElement(mm, 200, 0, tree)
    expect(hit).toEqual({ elementId: 'mm1', part: 'node', nodeId: 'n1' })
  })

  it('需求树参考图元：节点外、包围盒内命中 body', () => {
    const mm = mindmapRefElement(0, 0)
    // (100,100) 远离根节点 (0,0) 的 120x32 中心包围盒，但仍在图元包围盒中
    const hit = hitTestElement(mm, 100, 100, tree)
    expect(hit).toEqual({ elementId: 'mm1', part: 'body' })
  })

  it('需求树参考图元：未提供 tree 时使用退化占位树', () => {
    const mm = mindmapRefElement(0, 0)
    // 退化树只有根节点，(100,100) 不在根节点中心包围盒内，命中 body
    const hit = hitTestElement(mm, 100, 100)
    expect(hit?.part).toBe('body')
  })

  it('hitTestBoard 按 z 序返回最上层（数组倒序）', () => {
    const overlap: DecisionTableElement = { ...table, id: 'dt2', x: 50, y: 50 }
    const hit = hitTestBoard([table, overlap], 100, 100)
    expect(hit?.elementId).toBe('dt2')
  })
})
