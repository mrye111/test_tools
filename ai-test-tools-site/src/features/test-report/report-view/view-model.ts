import type { AssigneeBugCount, ModuleBugCount, ReportData } from '../../../data/test-report-types'
import { BUG_STATUS_LABELS, SEVERITY_LABELS, STATUS_LABELS } from './constants'
import type {
  CountStat,
  ModuleQualityStat,
  ReportBugStatusKey,
  ReportSeverityKey,
  ReportStatusKey,
  ReportViewModel,
  RiskLevel,
  TrendPoint,
} from './types'

function getRiskLevel(fatal: number, critical: number, openBugs: number, passRate: number): RiskLevel {
  if (fatal > 0 || passRate < 70) return 'high'
  if (critical > 3 || openBugs > 10 || passRate < 85) return 'medium'
  return 'low'
}

// 统一做数据派生，布局组件只消费结果，不再在视图里重复写统计逻辑。
export function buildReportViewModel(data: ReportData): ReportViewModel {
  const statusCounter: Record<ReportStatusKey, number> = { pass: 0, fail: 0, blocked: 0, unexecuted: 0 }
  const bugStatusCounter: Record<ReportBugStatusKey, number> = { closed: 0, resolved: 0, in_progress: 0, open: 0 }
  const severityCounter: Record<ReportSeverityKey, number> = { fatal: 0, critical: 0, major: 0, minor: 0 }
  const moduleBugMap = new Map<string, ModuleBugCount>()
  const assigneeMap = new Map<string, AssigneeBugCount>()
  const moduleCaseMap = new Map<string, Omit<ModuleQualityStat, 'bugTotal' | 'passRate'>>()
  const newBugMap = new Map<string, number>()
  const resolvedBugMap = new Map<string, number>()

  data.testCases.forEach((item) => {
    const key = item.status as ReportStatusKey
    statusCounter[key]++

    if (!moduleCaseMap.has(item.module)) {
      moduleCaseMap.set(item.module, {
        module: item.module,
        totalCases: 0,
        pass: 0,
        fail: 0,
        blocked: 0,
        unexecuted: 0,
      })
    }
    const row = moduleCaseMap.get(item.module)!
    row.totalCases++
    row[key]++
  })

  data.bugs.forEach((bug) => {
    const bugStatusKey = bug.status as ReportBugStatusKey
    const severityKey = bug.severity as ReportSeverityKey
    bugStatusCounter[bugStatusKey]++
    severityCounter[severityKey]++

    if (!moduleBugMap.has(bug.module)) {
      moduleBugMap.set(bug.module, {
        module: bug.module,
        fatal: 0,
        critical: 0,
        major: 0,
        minor: 0,
        total: 0,
      })
    }
    const moduleBug = moduleBugMap.get(bug.module)!
    moduleBug[severityKey]++
    moduleBug.total++

    if (!assigneeMap.has(bug.assignee)) {
      assigneeMap.set(bug.assignee, {
        assignee: bug.assignee,
        closed: 0,
        open: 0,
        total: 0,
      })
    }
    const assignee = assigneeMap.get(bug.assignee)!
    if (bug.status === 'closed' || bug.status === 'resolved') assignee.closed++
    else assignee.open++
    assignee.total++

    newBugMap.set(bug.createdAt, (newBugMap.get(bug.createdAt) || 0) + 1)
    if (bug.resolvedAt) {
      resolvedBugMap.set(bug.resolvedAt, (resolvedBugMap.get(bug.resolvedAt) || 0) + 1)
    }
  })

  const statusStats: CountStat<ReportStatusKey>[] = (Object.entries(statusCounter) as Array<[ReportStatusKey, number]>)
    .map(([key, count]) => ({ key, label: STATUS_LABELS[key], count }))

  const bugStatusStats: CountStat<ReportBugStatusKey>[] = (Object.entries(bugStatusCounter) as Array<[ReportBugStatusKey, number]>)
    .map(([key, count]) => ({ key, label: BUG_STATUS_LABELS[key], count }))

  const severityStats: CountStat<ReportSeverityKey>[] = (Object.entries(severityCounter) as Array<[ReportSeverityKey, number]>)
    .map(([key, count]) => ({ key, label: SEVERITY_LABELS[key], count }))

  const moduleBugStats = [...moduleBugMap.values()].sort((a, b) => b.total - a.total)
  const assigneeStats = [...assigneeMap.values()].sort((a, b) => b.total - a.total)

  const moduleQualityStats: ModuleQualityStat[] = [...moduleCaseMap.values()]
    .map((item) => {
      const bugTotal = moduleBugMap.get(item.module)?.total ?? 0
      const passRate = item.totalCases ? Math.round((item.pass / item.totalCases) * 1000) / 10 : 0
      return {
        ...item,
        bugTotal,
        passRate,
      }
    })
    .sort((a, b) => (b.bugTotal - a.bugTotal) || (a.passRate - b.passRate))

  const allDates = [...new Set([...newBugMap.keys(), ...resolvedBugMap.keys()])].sort()
  let backlog = 0
  const dailyTrend: TrendPoint[] = allDates.map((date) => {
    const newBugs = newBugMap.get(date) || 0
    const resolvedBugs = resolvedBugMap.get(date) || 0
    backlog = Math.max(0, backlog + newBugs - resolvedBugs)
    return {
      date: date.slice(5),
      newBugs,
      resolvedBugs,
      backlog,
    }
  })

  const totalCases = data.testCases.length
  const totalBugs = data.bugs.length
  const openBugs = data.bugs.filter((bug) => bug.status === 'open' || bug.status === 'in_progress').length
  const closedBugs = data.bugs.filter((bug) => bug.status === 'closed' || bug.status === 'resolved').length
  const blockedCases = statusCounter.blocked
  const waitingCases = statusCounter.unexecuted
  const fatalCount = severityCounter.fatal
  const criticalCount = severityCounter.critical
  const passRate = totalCases ? Math.round((statusCounter.pass / totalCases) * 1000) / 10 : 0
  const closedRate = totalBugs ? Math.round((closedBugs / totalBugs) * 100) : 0
  const riskLevel = getRiskLevel(fatalCount, criticalCount, openBugs, passRate)

  const qualitySummary = passRate >= 90
    ? '版本质量稳定，可优先关注尾部缺陷收敛。'
    : passRate >= 80
      ? '通过率整体健康，建议尽快收口阻塞项与高优缺陷。'
      : '当前质量压力偏高，建议先冻结新需求并集中修复关键问题。'

  return {
    data,
    summary: {
      totalCases,
      totalBugs,
      openBugs,
      closedBugs,
      blockedCases,
      waitingCases,
      fatalCount,
      criticalCount,
      fatalCritical: fatalCount + criticalCount,
      passRate,
      closedRate,
      riskLevel,
      qualitySummary,
      generatedLabel: new Date(data.generatedAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    },
    statusStats,
    bugStatusStats,
    severityStats,
    moduleBugStats,
    assigneeStats,
    moduleQualityStats,
    dailyTrend,
    topModule: moduleBugStats[0],
    topAssignee: assigneeStats[0],
    latestTrend: dailyTrend[dailyTrend.length - 1],
  }
}
