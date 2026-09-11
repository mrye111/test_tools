import { describe, expect, it } from 'vitest'
import {
  buildBugReport,
  calculateQualityMetrics,
  generateExecutionTrackingCsv,
  runQualityCheck,
} from './testcase-execution'

describe('testcase-execution quality gates & tracking', () => {
  const sampleRows = [
    ['TC-001', '登录', '账号验证', '有效密码登录', '高', '用户已激活', '1. 打开登录页\n2. 输入正确账密', '1. 登录成功跳转首页'],
    ['TC-002', '登录', '密码校验', '错误密码登录', '高', '用户已激活', '1. 输入错误密码', '1. 提示密码错误'],
    ['TC-003', '用户中心', '修改昵称', '昵称超长', '低', '用户已登录', '1. 提交100字符昵称', '1. 提示昵称不能超过20字符'],
    ['TC-004', '用户中心', '修改头像', '格式不符', '中', '用户已登录', '1. 上传txt格式头像', '1. 提示只支持图片格式'],
  ]

  it('正确计算测试执行率、通过率与质量门禁状态', () => {
    // 初始状态：全部未执行
    const initial = calculateQualityMetrics(sampleRows, {})
    expect(initial.total).toBe(4)
    expect(initial.executed).toBe(0)
    expect(initial.executionRate).toBe(0)
    expect(initial.passRate).toBe(0)
    expect(initial.overallStatus).toBe('in_progress')
    expect(initial.gates.executionComplete).toBe(false)

    // 部分执行且无失败
    const partial = calculateQualityMetrics(sampleRows, {
      'TC-001': { status: 'passed' },
      'TC-002': { status: 'passed' },
    })
    expect(partial.executed).toBe(2)
    expect(partial.executionRate).toBe(50)
    expect(partial.passRate).toBe(100)
    expect(partial.overallStatus).toBe('in_progress')

    // 存在阻塞性缺陷（高优先级失败）
    const withBlocking = calculateQualityMetrics(sampleRows, {
      'TC-001': { status: 'passed' },
      'TC-002': { status: 'failed', bugId: 'BUG-001' },
    })
    expect(withBlocking.blockingBugs).toBe(1)
    expect(withBlocking.overallStatus).toBe('blocked')
    expect(withBlocking.gates.zeroBlockingBugs).toBe(false)

    // 全部执行完毕且通过率 >= 80% 且 0 阻塞缺陷 -> 准出通过
    const allPass = calculateQualityMetrics(sampleRows, {
      'TC-001': { status: 'passed' },
      'TC-002': { status: 'passed' },
      'TC-003': { status: 'passed' },
      'TC-004': { status: 'passed' },
    })
    expect(allPass.executionRate).toBe(100)
    expect(allPass.passRate).toBe(100)
    expect(allPass.blockingBugs).toBe(0)
    expect(allPass.gates.executionComplete).toBe(true)
    expect(allPass.gates.passRateQualified).toBe(true)
    expect(allPass.gates.zeroBlockingBugs).toBe(true)
    expect(allPass.overallStatus).toBe('passed')
  })

  it('用例规范性体检能够检测模糊断言和格式缺陷', () => {
    const poorRows = [
      ['01', '订单', '下单', '点击购买', '高', '无', '点击', '正常'],
      ['TC-ORD-002', '订单', '取消', '取消未支付订单', '中', '存在未支付订单', '1. 点击取消订单', '1. 订单状态变为已取消并释放库存'],
    ]

    const report = runQualityCheck(poorRows)
    expect(report.vagueAssertionCount).toBe(1)
    expect(report.missingPreconditionCount).toBe(1)
    expect(report.nonStandardIdCount).toBe(1)
    expect(report.score).toBeLessThan(80)
    expect(report.issues.some((i) => i.type === 'vague_assertion')).toBe(true)
  })

  it('能够生成标准缺陷单 Markdown 模板', () => {
    const bug = buildBugReport(
      sampleRows[0],
      'BUG-101',
      '点击登录无反应，控制台报错 500',
    )
    expect(bug.bugId).toBe('BUG-101')
    expect(bug.severity).toBe('P0')
    expect(bug.title).toContain('[P0] [登录] 有效密码登录 - 验证失败')
    expect(bug.markdown).toContain('## 复现步骤')
    expect(bug.markdown).toContain('点击登录无反应，控制台报错 500')
  })

  it('能够导出符合 TEST-EXECUTION-TRACKING 规范的 CSV', () => {
    const header = ['用例编号', '模块', '测试点', '标题', '优先级', '前置', '步骤', '预期']
    const csv = generateExecutionTrackingCsv(header, sampleRows, {
      'TC-001': { status: 'passed', note: '验证通过' },
      'TC-002': { status: 'failed', bugId: 'BUG-001', note: '服务500' },
    })

    expect(csv).toContain('执行状态,缺陷ID,实际结果/执行备注,更新时间')
    expect(csv).toContain('✅ 通过,,验证通过')
    expect(csv).toContain('❌ 失败,BUG-001,服务500')
  })
})
