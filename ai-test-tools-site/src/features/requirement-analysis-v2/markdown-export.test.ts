import { describe, expect, it } from 'vitest'
import { buildAnalysisMarkdown } from './markdown-export'
import type { AnalysisRecordDetail, RtmView } from './analysis-api'

const record: AnalysisRecordDetail = {
  id: 'ra2_1',
  title: '登录需求分析',
  sourceFileName: 'login.md',
  sourceText: '原始需求文本',
  createdAt: '2026-09-11T08:00:00.000Z',
  updatedAt: '2026-09-11T08:00:00.000Z',
  requirements: [
    { id: 'r1', recordId: 'ra2_1', parentId: null, level: 0, text: '账号锁定', sort: 0 },
    { id: 'r2', recordId: 'ra2_1', parentId: null, level: 0, text: '失败提示', sort: 1 },
  ],
  issues: [
    {
      id: 'i1',
      recordId: 'ra2_1',
      reqId: 'r1',
      type: 'missing',
      severity: 'high',
      quote: '「连续输错密码后账号锁定」',
      description: '未说明锁定阈值与时长',
      example: '第 5 次输错和第 6 次输错结果一样吗？',
      suggestedQuestion: '错误几次触发锁定？',
      status: 'open',
    },
  ],
  criteria: [
    {
      id: 'c1',
      recordId: 'ra2_1',
      reqId: 'r1',
      originalText: '连续输错密码后账号锁定',
      rewrittenText: '10 分钟内连续 5 次错误 → 锁定 30 分钟',
      status: 'confirmed',
    },
  ],
  conditions: [
    { id: 'cond1', recordId: 'ra2_1', reqId: 'r1', criterionId: 'c1', text: '5 次错误触发锁定', kind: 'normal', relay: 'generated', testsetId: 'ts_1', sort: 0 },
    { id: 'cond2', recordId: 'ra2_1', reqId: 'r2', criterionId: null, text: '错误条 1s 内展示', kind: 'boundary', relay: 'none', testsetId: null, sort: 1 },
  ],
}

const rtm: RtmView = { totalConditions: 2, coveredConditions: 1, coverage: 50, rows: [] }

describe('buildAnalysisMarkdown', () => {
  it('固定章节顺序与计数摘要', () => {
    const md = buildAnalysisMarkdown(record, rtm)
    const sections = ['# 登录需求分析', '## 需求条目', '## 问题日志', '## 验收准则', '## 测试条件', '## 追溯矩阵']
    const positions = sections.map((s) => md.indexOf(s))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(md).toContain('问题 1 · 准则 1 · 条件 2')
  })

  it('问题/准则/条件字段完整呈现（状态用中文标签）', () => {
    const md = buildAnalysisMarkdown(record, rtm)
    expect(md).toContain('缺失')
    expect(md).toContain('严重度 高')
    expect(md).toContain('未说明锁定阈值与时长')
    expect(md).toContain('已确认')
    expect(md).toContain('10 分钟内连续 5 次错误')
    expect(md).toContain('已生成用例')
    expect(md).toContain('ts_1')
  })

  it('覆盖率文案诚实：关联用例集比例，不声称已执行', () => {
    const md = buildAnalysisMarkdown(record, rtm)
    expect(md).toContain('已关联用例集')
    expect(md).not.toContain('已通过')
  })

  it('转义表格管道与围栏，空分区可读', () => {
    const tricky: AnalysisRecordDetail = {
      ...record,
      title: '含 | 管道',
      issues: [],
      criteria: [],
      conditions: [{ ...record.conditions[0], text: '含 | 管道的条件' }],
      sourceText: '```\nfence\n```',
    }
    const md = buildAnalysisMarkdown(tricky, null)
    expect(md).toContain('含 \\| 管道的条件')
    expect(md).toContain('未发现问题')
    // 原文围栏不被内容提前闭合
    expect(md.split('```').length % 2).toBe(1)
  })

  it('纯函数：不修改输入且输出确定', () => {
    const before = JSON.stringify(record)
    const a = buildAnalysisMarkdown(record, rtm)
    const b = buildAnalysisMarkdown(record, rtm)
    expect(a).toBe(b)
    expect(JSON.stringify(record)).toBe(before)
  })
})
