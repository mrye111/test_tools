import type {
  ReportData,
  TestCaseRow,
  BugRow,
  TestResultStatus,
  BugSeverity,
  BugStatus,
} from '../data/test-report-types'

const MODULES = ['登录模块', '支付模块', '购物车模块', '用户中心', '订单管理', '商品搜索', '消息通知', '数据报表']
const ASSIGNEES = ['张三', '李四', '王五', '赵六', '钱七', '孙八']
const PRIORITIES = ['P0', 'P1', 'P2', 'P3']

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomStatus(): TestResultStatus {
  const r = Math.random()
  if (r < 0.72) return 'pass'
  if (r < 0.84) return 'fail'
  if (r < 0.92) return 'blocked'
  return 'unexecuted'
}

function randomSeverity(): BugSeverity {
  const r = Math.random()
  if (r < 0.08) return 'fatal'
  if (r < 0.25) return 'critical'
  if (r < 0.60) return 'major'
  return 'minor'
}

function randomBugStatus(): BugStatus {
  const r = Math.random()
  if (r < 0.45) return 'closed'
  if (r < 0.65) return 'resolved'
  if (r < 0.82) return 'in_progress'
  return 'open'
}

function randomDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo))
  return d.toISOString().slice(0, 10)
}

/** 生成演示用的测试报告数据 */
export function generateDemoReportData(): ReportData {
  const testCases: TestCaseRow[] = Array.from({ length: 186 }, (_, i) => ({
    id: `TC${String(i + 1).padStart(3, '0')}`,
    module: pick(MODULES),
    title: `测试用例 #${i + 1}`,
    status: randomStatus(),
    priority: pick(PRIORITIES),
    executor: pick(ASSIGNEES),
  }))

  const bugs: BugRow[] = Array.from({ length: 67 }, (_, i) => ({
    id: `BUG-${String(i + 1).padStart(3, '0')}`,
    module: pick(MODULES),
    title: `缺陷描述 #${i + 1}`,
    severity: randomSeverity(),
    status: randomBugStatus(),
    assignee: pick(ASSIGNEES),
    createdAt: randomDate(30),
    resolvedAt: Math.random() > 0.4 ? randomDate(15) : undefined,
  }))

  return {
    title: 'V2.1 版本测试报告',
    generatedAt: new Date().toISOString(),
    platform: '演示数据',
    testCases,
    bugs,
  }
}
