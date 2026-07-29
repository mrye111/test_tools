import { describe, expect, it } from 'vitest'
import { buildMindmapRefElement } from './ai'
import type { RequirementNode } from '../../../lib/requirement-analysis-api'

const singleTree: RequirementNode = {
  id: 'root',
  title: '登录需求',
  children: [],
}

const twoLevelTree: RequirementNode = {
  id: 'root',
  title: '登录需求',
  children: [{ id: 'n1', title: '账号密码登录', children: [] }],
}

describe('buildMindmapRefElement', () => {
  it('单根树使用最小兜底尺寸', () => {
    const el = buildMindmapRefElement(singleTree, 10, 20)
    expect(el.kind).toBe('mindmap-ref')
    expect(el.x).toBe(10)
    expect(el.y).toBe(20)
    expect(el.w).toBeGreaterThanOrEqual(160)
    expect(el.h).toBeGreaterThanOrEqual(120)
  })

  it('真实两层层级树根据 layoutMindmap 节点包围盒自适应宽高', () => {
    const el = buildMindmapRefElement(twoLevelTree, 0, 0)
    // layoutMindmap: 根在 x=0, 子节点在 x=200, y=0; 节点半宽 60 半高 16, padding 20
    // 但高度最小值为 120
    expect(el.w).toBe(200 + 60 * 2 + 20 * 2)
    expect(el.h).toBeGreaterThanOrEqual(120)
  })
})
