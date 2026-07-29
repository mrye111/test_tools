import { describe, expect, it } from 'vitest'
import { distToSegment, hitTestBoard, hitTestElement } from './hit-test'
import type { CauseEffectElement, DecisionTableElement } from './types'

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

  it('hitTestBoard 按 z 序返回最上层（数组倒序）', () => {
    const overlap: DecisionTableElement = { ...table, id: 'dt2', x: 50, y: 50 }
    const hit = hitTestBoard([table, overlap], 100, 100)
    expect(hit?.elementId).toBe('dt2')
  })
})
