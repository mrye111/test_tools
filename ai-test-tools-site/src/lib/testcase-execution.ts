import type { TestCaseExecutionItem } from './testcase-api'

export interface QualityGateMetrics {
  total: number
  executed: number
  passed: number
  failed: number
  blocked: number
  untested: number
  executionRate: number
  passRate: number
  blockingBugs: number
  gates: {
    executionComplete: boolean
    passRateQualified: boolean
    zeroBlockingBugs: boolean
  }
  overallStatus: 'passed' | 'blocked' | 'in_progress'
}

export function calculateQualityMetrics(
  rows: string[][],
  executionStatus: Record<string, TestCaseExecutionItem> = {},
): QualityGateMetrics {
  const total = rows.length
  let passed = 0
  let failed = 0
  let blocked = 0
  let blockingBugs = 0

  for (const row of rows) {
    const caseId = String(row[0] ?? '').trim()
    const item = executionStatus[caseId]
    const status = item?.status ?? 'untested'
    const priority = String(row[4] ?? '').trim().toUpperCase()
    const isHighPriority = priority === '高' || priority === 'HIGH' || priority.includes('P0') || priority.includes('P1')

    if (status === 'passed') {
      passed += 1
    } else if (status === 'failed') {
      failed += 1
      if (isHighPriority) {
        blockingBugs += 1
      }
    } else if (status === 'blocked') {
      blocked += 1
    }
  }

  const executed = passed + failed + blocked
  const untested = Math.max(0, total - executed)
  const executionRate = total > 0 ? Math.round((executed / total) * 100) : 0
  const passRate = executed > 0 ? Math.round((passed / executed) * 100) : 0

  const executionComplete = total > 0 && executed === total
  const passRateQualified = executed > 0 && passRate >= 80
  const zeroBlockingBugs = blockingBugs === 0

  let overallStatus: 'passed' | 'blocked' | 'in_progress' = 'in_progress'
  if (blockingBugs > 0 || (executionComplete && !passRateQualified)) {
    overallStatus = 'blocked'
  } else if (executionComplete && passRateQualified && zeroBlockingBugs) {
    overallStatus = 'passed'
  }

  return {
    total,
    executed,
    passed,
    failed,
    blocked,
    untested,
    executionRate,
    passRate,
    blockingBugs,
    gates: {
      executionComplete,
      passRateQualified,
      zeroBlockingBugs,
    },
    overallStatus,
  }
}

export interface QualityIssue {
  caseId: string
  title: string
  type: 'vague_assertion' | 'missing_precondition' | 'missing_steps' | 'non_standard_id'
  message: string
  suggestion: string
}

export interface QualityCheckResult {
  score: number
  totalCases: number
  vagueAssertionCount: number
  missingPreconditionCount: number
  nonStandardIdCount: number
  priorityDistribution: Record<string, number>
  issues: QualityIssue[]
  summary: string
}

const VAGUE_ASSERTION_PATTERN = /^(正常|操作成功|显示正常|符合预期|成功|无异常|正常显示|提示成功)$/i

export function runQualityCheck(rows: string[][]): QualityCheckResult {
  const issues: QualityIssue[] = []
  let vagueAssertionCount = 0
  let missingPreconditionCount = 0
  let nonStandardIdCount = 0
  const priorityDistribution: Record<string, number> = {
    P0_高: 0,
    P1_P2_中: 0,
    P3_P4_低: 0,
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const caseId = String(row[0] ?? '').trim()
    const title = String(row[3] ?? `第 ${i + 1} 条用例`).trim()
    const priority = String(row[4] ?? '中').trim()
    const precondition = String(row[5] ?? '').trim()
    const steps = String(row[6] ?? '').trim()
    const expected = String(row[7] ?? '').trim()

    if (priority === '高' || priority.toUpperCase().includes('P0') || priority.toUpperCase().includes('HIGH')) {
      priorityDistribution.P0_高 += 1
    } else if (priority === '低' || priority.toUpperCase().includes('P3') || priority.toUpperCase().includes('P4') || priority.toUpperCase().includes('LOW')) {
      priorityDistribution.P3_P4_低 += 1
    } else {
      priorityDistribution.P1_P2_中 += 1
    }

    if (!caseId || (!caseId.startsWith('TC-') && !caseId.startsWith('API-') && !/^TC\d+/i.test(caseId))) {
      nonStandardIdCount += 1
      issues.push({
        caseId: caseId || `ROW-${i + 1}`,
        title,
        type: 'non_standard_id',
        message: `用例编号 "${caseId || '空'}" 未遵循工业级命名规范`,
        suggestion: '建议使用 TC-[模块]-[编号] 格式（如 TC-AUTH-001、TC-SEC-001）',
      })
    }

    if (!precondition || precondition === '无' || precondition.length < 3) {
      missingPreconditionCount += 1
      issues.push({
        caseId: caseId || `ROW-${i + 1}`,
        title,
        type: 'missing_precondition',
        message: '前置条件缺失或过简，缺少测试环境、已知状态与角色说明',
        suggestion: '明确系统状态、登录角色权限、测试账号与测试数据依赖',
      })
    }

    if (!steps || steps.length < 4) {
      issues.push({
        caseId: caseId || `ROW-${i + 1}`,
        title,
        type: 'missing_steps',
        message: '测试步骤过短或缺失',
        suggestion: '步骤应使用 1. 2. 3. 清晰表述具体操作与输入载荷',
      })
    }

    if (VAGUE_ASSERTION_PATTERN.test(expected) || expected.length < 4) {
      vagueAssertionCount += 1
      issues.push({
        caseId: caseId || `ROW-${i + 1}`,
        title,
        type: 'vague_assertion',
        message: `预期结果 "${expected || '空'}" 属于模糊断言，缺乏可客观核验的判据`,
        suggestion: '避免使用"操作成功/正常显示"，必须写明 UI 具体元素、状态码、数据落库结果或业务响应码',
      })
    }
  }

  const total = rows.length
  let penalty = 0
  if (total > 0) {
    const vagueRatio = vagueAssertionCount / total
    const missingPreconditionRatio = missingPreconditionCount / total
    const nonStandardIdRatio = nonStandardIdCount / total

    penalty += Math.round(vagueRatio * 45)
    penalty += Math.round(missingPreconditionRatio * 35)
    penalty += Math.round(nonStandardIdRatio * 20)
  }
  const score = total === 0 ? 100 : Math.max(10, Math.min(100, 100 - penalty))

  let summary = '用例工程质量优秀，符合规范。'
  if (score < 60) {
    summary = '存在较多模糊断言或前置条件缺失，建议按 AAA 标准修复断言后再发版。'
  } else if (score < 85) {
    summary = '整体结构较好，仍有部分模糊预期建议补充明确的观测校验条件。'
  }

  return {
    score,
    totalCases: rows.length,
    vagueAssertionCount,
    missingPreconditionCount,
    nonStandardIdCount,
    priorityDistribution,
    issues,
    summary,
  }
}

export interface BugReportTemplate {
  bugId: string
  title: string
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
  module: string
  preconditions: string
  steps: string
  expectedResult: string
  actualResult: string
  markdown: string
}

export function buildBugReport(
  row: string[],
  bugId: string,
  actualResult: string,
  severityOverride?: 'P0' | 'P1' | 'P2' | 'P3' | 'P4',
): BugReportTemplate {
  const caseId = String(row[0] ?? '').trim()
  const module = String(row[1] ?? '').trim()
  const title = String(row[3] ?? '').trim()
  const priority = String(row[4] ?? '').trim().toUpperCase()
  const preconditions = String(row[5] ?? '').trim()
  const steps = String(row[6] ?? '').trim()
  const expectedResult = String(row[7] ?? '').trim()

  let severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' = severityOverride ?? 'P2'
  if (!severityOverride) {
    if (priority === '高' || priority.includes('P0') || priority === 'HIGH') severity = 'P0'
    else if (priority.includes('P1')) severity = 'P1'
    else if (priority === '低' || priority.includes('P3') || priority === 'LOW') severity = 'P3'
    else if (priority.includes('P4')) severity = 'P4'
  }

  const bugTitle = `[${severity}] [${module || '功能'}] ${title || caseId} - 验证失败`
  const markdown = [
    `# 缺陷报告: ${bugTitle}`,
    '',
    `- **缺陷编号**: ${bugId || 'BUG-NEW'}`,
    `- **严重级别**: ${severity}`,
    `- **关联用例**: ${caseId || '未指定'}`,
    `- **所属模块**: ${module || '默认'}`,
    '',
    '## 前置条件',
    preconditions || '无特殊前置',
    '',
    '## 复现步骤',
    steps || '1. 执行对应测试步骤',
    '',
    '## 预期结果',
    expectedResult || '系统按预期正常响应',
    '',
    '## 实际结果（异常现象）',
    actualResult || '未提供实际结果描述',
  ].join('\n')

  return {
    bugId,
    title: bugTitle,
    severity,
    module,
    preconditions,
    steps,
    expectedResult,
    actualResult,
    markdown,
  }
}

export function generateExecutionTrackingCsv(
  header: string[],
  rows: string[][],
  executionStatus: Record<string, TestCaseExecutionItem> = {},
): string {
  const trackingHeaders = [...header, '执行状态', '缺陷ID', '实际结果/执行备注', '更新时间']
  const escapeCsv = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }

  const lines = [trackingHeaders.map(escapeCsv).join(',')]
  for (const row of rows) {
    const caseId = String(row[0] ?? '').trim()
    const item = executionStatus[caseId]
    const statusMap: Record<string, string> = {
      passed: '✅ 通过',
      failed: '❌ 失败',
      blocked: '⚠️ 阻塞',
      untested: '未执行',
    }
    const statusText = statusMap[item?.status ?? 'untested'] ?? '未执行'
    const bugId = item?.bugId ?? ''
    const note = item?.note ?? ''
    const updatedAt = item?.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''

    const extendedRow = [...row, statusText, bugId, note, updatedAt]
    lines.push(extendedRow.map(escapeCsv).join(','))
  }

  return `﻿${lines.join('\r\n')}`
}
