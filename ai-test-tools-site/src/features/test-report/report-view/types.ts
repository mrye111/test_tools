import type {
  AssigneeBugCount,
  BugStatus,
  BugSeverity,
  DailyTrend,
  ModuleBugCount,
  ReportData,
  TestResultStatus,
} from '../../../data/test-report-types'

export type ReportThemeKey = 'current' | 'enterpriseBlue' | 'mintFinance' | 'darkAi'
export type ReportStatusKey = TestResultStatus
export type ReportSeverityKey = BugSeverity
export type ReportBugStatusKey = BugStatus
export type ChipTone = 'light' | 'dark' | 'accent'
export type MetricAccent = 'green' | 'amber' | 'coral' | 'lilac' | 'dark'
export type RiskLevel = 'low' | 'medium' | 'high'

export interface CountStat<K extends string = string> {
  key: K
  label: string
  count: number
}

export interface TrendPoint extends DailyTrend {
  backlog: number
}

export interface ModuleQualityStat {
  module: string
  totalCases: number
  pass: number
  fail: number
  blocked: number
  unexecuted: number
  bugTotal: number
  passRate: number
}

export interface ReportSummary {
  totalCases: number
  totalBugs: number
  openBugs: number
  closedBugs: number
  blockedCases: number
  waitingCases: number
  fatalCount: number
  criticalCount: number
  fatalCritical: number
  passRate: number
  closedRate: number
  riskLevel: RiskLevel
  qualitySummary: string
  generatedLabel: string
}

export interface ReportViewModel {
  data: ReportData
  summary: ReportSummary
  statusStats: CountStat<ReportStatusKey>[]
  bugStatusStats: CountStat<ReportBugStatusKey>[]
  severityStats: CountStat<ReportSeverityKey>[]
  moduleBugStats: ModuleBugCount[]
  assigneeStats: AssigneeBugCount[]
  moduleQualityStats: ModuleQualityStat[]
  dailyTrend: TrendPoint[]
  topModule?: ModuleBugCount
  topAssignee?: AssigneeBugCount
  latestTrend?: TrendPoint
}

export interface ReportTheme {
  key: ReportThemeKey
  name: string
  hint: string
  isDark: boolean
  page: {
    background: string
    border: string
    shadow: string
  }
  shellAuras: [string, string, string]
  heroGlows: [string, string, string]
  headerBadge: {
    bg: string
    text: string
    border: string
  }
  platformBadge: {
    bg: string
    text: string
    border: string
  }
  switcher: {
    bg: string
    border: string
  }
  iconButton: {
    bg: string
    text: string
    border: string
  }
  chips: {
    lightBg: string
    lightText: string
    lightBorder: string
    darkBg: string
    darkText: string
    darkBorder: string
    accentBg: string
    accentText: string
    accentBorder: string
  }
  surface: {
    hero: string
    card: string
    nested: string
    risk: string
    strong: string
    metric: string
    border: string
    softBorder: string
    shadow: string
    heroShadow: string
    riskShadow: string
    nestedShadow: string
  }
  text: {
    primary: string
    secondary: string
    tertiary: string
    inverse: string
  }
  icon: {
    tileBg: string
    tileText: string
    sectionBg: string
    sectionText: string
  }
  legend: {
    bg: string
    border: string
  }
  chart: {
    grid: string
    axis: string
    tooltipBg: string
    tooltipBorder: string
    tooltipShadow: string
    cursor: string
    activeDotStroke: string
    barRadius: number
    areaStrokeWidth: number
    pieStrokeWidth: number
    pieStroke: string
  }
  statusColors: Record<ReportStatusKey, string>
  severityColors: Record<ReportSeverityKey, string>
  bugStatusColors: Record<ReportBugStatusKey, string>
  accents: {
    green: string
    amber: string
    coral: string
    lilac: string
    dark: string
    blue: string
    mint: string
  }
}
