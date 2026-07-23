import type {
  ReportData,
  TestCaseRow,
  BugRow,
  TestResultStatus,
  BugSeverity,
  BugStatus,
} from '../data/test-report-types'
import {
  parseCsvText,
  readFileAsText,
  formatDate,
} from './csv-utils'

// ── 禅道字段映射 ──

const ZENTAO_SEVERITY_MAP: Record<string, BugSeverity> = {
  '1': 'fatal',
  '2': 'critical',
  '3': 'major',
  '4': 'minor',
  '致命': 'fatal',
  '严重': 'critical',
  '一般': 'major',
  '轻微': 'minor',
}

const ZENTAO_BUG_STATUS_MAP: Record<string, BugStatus> = {
  '已关闭': 'closed',
  'Closed': 'closed',
  '已解决': 'resolved',
  'Resolved': 'resolved',
  '激活': 'open',
  'Active': 'open',
  '已确认': 'in_progress',
  'Confirmed': 'in_progress',
  '待验证': 'in_progress',
  'Verifying': 'in_progress',
}

const ZENTAO_RESULT_MAP: Record<string, TestResultStatus> = {
  '通过': 'pass',
  'Pass': 'pass',
  '失败': 'fail',
  'Fail': 'fail',
  '阻塞': 'blocked',
  'Blocked': 'blocked',
  '未执行': 'unexecuted',
  'N/A': 'unexecuted',
  '': 'unexecuted',
}

const ZENTAO_PLATFORM_LABEL = '禅道 (ZenTao)'

// ── 禅道解析逻辑 ──

function parseZentaoTestCases(rows: Record<string, string>[]): TestCaseRow[] {
  return rows.map((row) => {
    const id = row['用例编号'] || row['Case ID'] || ''
    const module = row['所属模块'] || row['Module'] || ''
    const title = row['用例标题'] || row['Case Title'] || row['标题'] || ''
    const result = row['结果'] || row['Result'] || ''
    const priority = row['优先级'] || row['Priority'] || ''
    const executor = row['由谁创建'] || row['创建者'] || row['Executor'] || ''

    return {
      id,
      module: module.replace(/\(.*?\)/g, '').replace(/^\//, ''),
      title,
      status: ZENTAO_RESULT_MAP[result] || 'unexecuted',
      priority: priority || 'P2',
      executor,
    }
  })
}

function parseZentaoBugs(rows: Record<string, string>[]): BugRow[] {
  return rows.map((row) => {
    const id = row['Bug编号'] || row['Bug ID'] || ''
    const module = row['所属模块'] || row['Module'] || ''
    const title = row['Bug标题'] || row['Bug Title'] || row['标题'] || ''
    const severity = row['严重程度'] || row['Severity'] || '3'
    const status = row['Bug状态'] || row['Status'] || ''
    const assignee = row['指派给'] || row['由谁创建'] || row['Assignee'] || ''
    const createdAt = row['创建日期'] || row['Created'] || ''
    const resolvedAt = row['解决日期'] || row['Resolved'] || ''

    return {
      id,
      module: module.replace(/\(.*?\)/g, '').replace(/^\//, ''),
      title,
      severity: ZENTAO_SEVERITY_MAP[severity] || 'major',
      status: ZENTAO_BUG_STATUS_MAP[status] || 'open',
      assignee,
      createdAt: formatDate(createdAt),
      resolvedAt: resolvedAt ? formatDate(resolvedAt) : undefined,
    }
  })
}

/** 解析禅道导出的用例执行结果与 BUG 清单 CSV 文件 */
export async function parseZentaoReport(
  caseFile: File | null,
  bugFile: File | null,
): Promise<ReportData> {
  const testCases: TestCaseRow[] = []
  const bugs: BugRow[] = []

  if (caseFile) {
    const text = await readFileAsText(caseFile)
    const rows = parseCsvText(text)
    testCases.push(...parseZentaoTestCases(rows))
  }

  if (bugFile) {
    const text = await readFileAsText(bugFile)
    const rows = parseCsvText(text)
    bugs.push(...parseZentaoBugs(rows))
  }

  return {
    title: `${ZENTAO_PLATFORM_LABEL} 测试报告`,
    generatedAt: new Date().toISOString(),
    platform: ZENTAO_PLATFORM_LABEL,
    testCases,
    bugs,
  }
}
