import type {
  ReportBugStatusKey,
  ReportSeverityKey,
  ReportStatusKey,
  ReportThemeKey,
} from './types'

export const STATUS_LABELS: Record<ReportStatusKey, string> = {
  pass: '通过',
  fail: '失败',
  blocked: '阻塞',
  unexecuted: '未执行',
}

export const SEVERITY_LABELS: Record<ReportSeverityKey, string> = {
  fatal: '致命',
  critical: '严重',
  major: '一般',
  minor: '轻微',
}

export const BUG_STATUS_LABELS: Record<ReportBugStatusKey, string> = {
  closed: '已关闭',
  resolved: '已解决',
  in_progress: '处理中',
  open: '未解决',
}

export const REPORT_THEME_OPTIONS: Array<{ value: ReportThemeKey; label: string }> = [
  { value: 'current', label: '当前风格' },
  { value: 'enterpriseBlue', label: '蓝白政企' },
  { value: 'mintFinance', label: '薄荷财务' },
  { value: 'darkAi', label: '深色智控' },
]

export const REPORT_CHART_VIEWPORTS = {
  trendMinCanvasWidth: 896,
  trendPointWidth: 64,
  moduleMinViewportHeight: 344,
  moduleRowHeight: 40,
  assigneeMinCanvasWidth: 672,
  assigneeBarWidth: 84,
} as const
