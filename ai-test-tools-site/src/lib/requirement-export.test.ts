import { describe, expect, it } from 'vitest'
import {
  buildFreeMindXml,
  buildMarkdownOutline,
  findingCountByNode,
  nodeLabelWithBadge,
} from './requirement-export'
import type { RequirementAnalysisResult } from './requirement-analysis-api'

const result: RequirementAnalysisResult = {
  title: '订单系统',
  tree: {
    id: 'n1',
    title: '订单系统',
    children: [
      {
        id: 'n2',
        title: '订单管理',
        children: [{ id: 'n3', title: '退款<规则>', children: [] }],
      },
    ],
  },
  findings: [
    { id: 'f1', type: 'risk', title: '并发退款风险', detail: '重复提交可能重复退款', nodeId: 'n3' },
    { id: 'f2', type: 'ambiguity', title: '超时定义模糊', detail: '未说明超时时长', nodeId: 'n2' },
    { id: 'f3', type: 'clarification', title: '退款时限未定', detail: '', nodeId: 'n1' },
  ],
  sourceText: '需求原文',
  truncated: false,
  warnings: [],
}

describe('findingCountByNode / nodeLabelWithBadge', () => {
  it('统计每个节点的结论数量并生成角标', () => {
    const counts = findingCountByNode(result.findings)
    expect(counts.get('n1')).toBe(1)
    expect(counts.get('n2')).toBe(1)
    expect(counts.get('n3')).toBe(1)
    expect(nodeLabelWithBadge(result.tree, counts)).toBe('订单系统 ⚠1')
    expect(nodeLabelWithBadge({ id: 'n9', title: '无结论节点', children: [] }, counts)).toBe('无结论节点')
  })
})

describe('buildFreeMindXml', () => {
  it('生成 FreeMind map 结构，结论挂在对应节点下', () => {
    const xml = buildFreeMindXml(result)
    expect(xml.startsWith('<map version="1.0.1">')).toBe(true)
    expect(xml).toContain('TEXT="订单系统 ⚠1"')
    expect(xml).toContain('TEXT="订单管理 ⚠1"')
    expect(xml).toContain('分析结论')
    expect(xml).toContain('[风险点] 并发退款风险：重复提交可能重复退款')
    expect(xml).toContain('[待澄清问题] 退款时限未定')
  })

  it('转义 XML 特殊字符', () => {
    const xml = buildFreeMindXml(result)
    expect(xml).toContain('退款&lt;规则&gt;')
    expect(xml).not.toContain('退款<规则>')
  })
})

describe('buildMarkdownOutline', () => {
  it('树用嵌套列表，文末包含「风险与待澄清」章节', () => {
    const md = buildMarkdownOutline(result)
    expect(md).toContain('# 订单系统')
    expect(md).toContain('## 需求分解树')
    expect(md).toContain('- 订单系统')
    expect(md).toContain('  - 订单管理')
    expect(md).toContain('    - 退款<规则>')
    expect(md).toContain('## 风险与待澄清')
    expect(md).toContain('### 风险点')
    expect(md).toContain('### 歧义点')
    expect(md).toContain('### 待澄清问题')
    expect(md).toContain('**并发退款风险**（关联：退款<规则>）：重复提交可能重复退款')
  })

  it('无结论时给出空章节提示', () => {
    const md = buildMarkdownOutline({ ...result, findings: [] })
    expect(md).toContain('## 风险与待澄清')
    expect(md).toContain('暂无分析结论')
  })
})
