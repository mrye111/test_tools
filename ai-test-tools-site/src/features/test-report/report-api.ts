/**
 * 测试报告域前端 API 封装。
 * REST 记录接口 + SSE 生成/追改流；报告产物为单文件 HTML。
 */

import { buildUrl, parseJson } from '../../lib/httpClient'
import type { RuntimeAiConfig } from '../../shared/api-types'

/** 报告类型：测试总结 / 快速简报 / 缺陷分析 / 自由输入 */
export type ReportType = 'summary' | 'brief' | 'defect' | 'free'

/** 报告来源：几句话文本 / 禅道 CSV 解析数据 */
export type ReportSourceType = 'text' | 'csv'

/** 报告摘要（列表层，不含 html） */
export interface ReportSummary {
  id: string
  title: string
  reportType: ReportType
  sourceType: ReportSourceType
  createdAt: Date
  updatedAt: Date
}

/** 报告记录（完整，含 HTML 全文） */
export interface TestReport extends ReportSummary {
  sourceDigest: string | null
  chartKinds: unknown
  html: string
}

export interface ReportListResult {
  reports: ReportSummary[]
  total: number
  page: number
  pageSize: number
}

/** 生成/追改过程事件 */
export type ReportStreamEvent =
  | { type: 'progress'; stage: string; message: string }
  | { type: 'report'; report: TestReport }
  | { type: 'error'; message: string; code?: string }

function normalizeSummary(value: unknown): ReportSummary {
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    reportType: (raw.reportType ?? 'free') as ReportType,
    sourceType: (raw.sourceType ?? 'text') as ReportSourceType,
    createdAt: new Date(String(raw.createdAt ?? '')),
    updatedAt: new Date(String(raw.updatedAt ?? '')),
  }
}

function normalizeReport(value: unknown): TestReport {
  const summary = normalizeSummary(value)
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    ...summary,
    sourceDigest: typeof raw.sourceDigest === 'string' ? raw.sourceDigest : null,
    chartKinds: raw.chartKinds ?? null,
    html: String(raw.html ?? ''),
  }
}

export async function getReportStorageStatus(): Promise<'mysql' | 'memory'> {
  const response = await fetch(buildUrl('/api/test-report/storage-status'))
  const data = await parseJson<{ mode: 'mysql' | 'memory' }>(response)
  return data.mode
}

export async function listReports(page = 1, pageSize = 20): Promise<ReportListResult> {
  const response = await fetch(buildUrl(`/api/test-report/reports?page=${page}&pageSize=${pageSize}`))
  const data = await parseJson<{ reports: unknown[]; total: number; page: number; pageSize: number }>(response)
  return {
    reports: (data.reports ?? []).map(normalizeSummary),
    total: data.total ?? 0,
    page: data.page ?? 1,
    pageSize: data.pageSize ?? pageSize,
  }
}

export async function getReport(id: string): Promise<TestReport> {
  const response = await fetch(buildUrl(`/api/test-report/reports/${id}`))
  const data = await parseJson<{ report: unknown }>(response)
  return normalizeReport(data.report)
}

export async function renameReport(id: string, title: string): Promise<TestReport> {
  const response = await fetch(buildUrl(`/api/test-report/reports/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  const data = await parseJson<{ report: unknown }>(response)
  return normalizeReport(data.report)
}

export async function deleteReport(id: string): Promise<void> {
  const response = await fetch(buildUrl(`/api/test-report/reports/${id}`), { method: 'DELETE' })
  await parseJson(response)
}

/** 报告 PDF 下载地址（后端无头浏览器渲染） */
export function getReportPdfUrl(id: string): string {
  return buildUrl(`/api/test-report/reports/${id}/pdf`)
}

/** 消费 SSE 流，逐事件回调；返回最终报告（无则表示流以错误结束）。 */
async function consumeReportStream(response: Response, onEvent: (event: ReportStreamEvent) => void): Promise<TestReport | null> {
  if (!response.ok || !response.body) {
    let message = `请求失败：${response.status}`
    try {
      const data = (await response.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // 非 JSON 错误体，保留默认提示
    }
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let report: TestReport | null = null
  let streamError: string | null = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const rawBlock = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)

      const lines = rawBlock.split(/\r?\n/)
      const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? ''
      const dataText = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')

      try {
        const data = JSON.parse(dataText) as Record<string, unknown>
        if (eventName === 'progress') {
          onEvent({ type: 'progress', stage: String(data.stage ?? ''), message: String(data.message ?? '') })
        } else if (eventName === 'report') {
          report = normalizeReport(data.report)
          onEvent({ type: 'report', report })
        } else if (eventName === 'error') {
          streamError = String(data.message ?? '生成失败')
          onEvent({ type: 'error', message: streamError, code: typeof data.code === 'string' ? data.code : undefined })
        }
      } catch {
        // 忽略无法解析的事件块
      }
      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  if (streamError) throw new Error(streamError)
  return report
}

/** 生成报告（SSE）：文本或 CSV 解析 JSON 两类输入统一入口。 */
export async function generateReportStream(
  body: { reportType: ReportType; sourceType: ReportSourceType; sourceText?: string; csvData?: unknown; title?: string },
  aiConfig: RuntimeAiConfig,
  onEvent: (event: ReportStreamEvent) => void,
): Promise<TestReport | null> {
  const response = await fetch(buildUrl('/api/test-report/reports/generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, aiConfig }),
  })
  return consumeReportStream(response, onEvent)
}

/** 对话式追改（SSE）：整体重生成替换报告内容。 */
export async function reviseReportStream(
  reportId: string,
  instruction: string,
  aiConfig: RuntimeAiConfig,
  onEvent: (event: ReportStreamEvent) => void,
): Promise<TestReport | null> {
  const response = await fetch(buildUrl(`/api/test-report/reports/${reportId}/revise`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, aiConfig }),
  })
  return consumeReportStream(response, onEvent)
}

/** 触发浏览器下载报告 HTML 文件。 */
export function downloadReportHtml(report: TestReport): void {
  const blob = new Blob([report.html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${report.title || '测试报告'}.html`
  anchor.click()
  URL.revokeObjectURL(url)
}
