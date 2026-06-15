/** 测试报告数据结构 */

export type TestResultStatus = 'pass' | 'fail' | 'blocked' | 'unexecuted'
export type BugSeverity = 'fatal' | 'critical' | 'major' | 'minor'
export type BugStatus = 'closed' | 'resolved' | 'in_progress' | 'open'

export interface TestCaseRow {
  id: string
  module: string
  title: string
  status: TestResultStatus
  priority: string
  executor: string
}

export interface BugRow {
  id: string
  module: string
  title: string
  severity: BugSeverity
  status: BugStatus
  assignee: string
  createdAt: string
  resolvedAt?: string
}

export interface ReportData {
  /** 报告标题 */
  title: string
  /** 生成时间 */
  generatedAt: string
  /** 数据来源平台 */
  platform: string
  /** 用例执行结果 */
  testCases: TestCaseRow[]
  /** BUG 清单 */
  bugs: BugRow[]
}

// ── 汇总类型 ──

export interface StatusCount {
  status: string
  count: number
  label: string
  color: string
}

export interface SeverityCount {
  severity: string
  count: number
  label: string
  color: string
}

export interface ModuleBugCount {
  module: string
  fatal: number
  critical: number
  major: number
  minor: number
  total: number
}

export interface AssigneeBugCount {
  assignee: string
  closed: number
  open: number
  total: number
}

export interface DailyTrend {
  date: string
  newBugs: number
  resolvedBugs: number
}
