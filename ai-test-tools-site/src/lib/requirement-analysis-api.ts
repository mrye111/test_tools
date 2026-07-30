import { buildUrl, downloadBlob } from './httpClient'
import type { RuntimeAiConfig } from '../shared/api-types'

export type RequirementNode = {
  id: string
  title: string
  children: RequirementNode[]
}

export type FindingType = 'risk' | 'ambiguity' | 'clarification'

export type Finding = {
  id: string
  type: FindingType
  title: string
  detail: string
  nodeId: string
}

export type RequirementChartType = 'mindmap' | 'tree' | 'logic'

export type BoardChartKind = 'cause-effect' | 'decision-table' | 'orthogonal' | 'flowchart'

export type RequirementAnalysisResult = {
  title: string
  tree: RequirementNode
  findings: Finding[]
  sourceText: string
  truncated: boolean
  warnings: string[]
}

export type AnalysisStage = 'parsing' | 'analyzing' | 'finalizing'

export type RequirementStreamChunkKind = 'reasoning' | 'content' | 'notice'

export type RequirementAnalysisStreamEvent =
  | { type: 'stage'; stage: AnalysisStage }
  | { type: 'warning'; warnings: string[] }
  | { type: 'stream'; kind: RequirementStreamChunkKind; text: string }
  | { type: 'attempt'; reason: string }
  | { type: 'result'; result: RequirementAnalysisResult }
  | { type: 'error'; message: string }

export const REQUIREMENT_FILE_ACCEPT = '.md,.txt,.docx,.xlsx,.xls,.csv,.pdf'
export const REQUIREMENT_FILE_MAX_BYTES = 10 * 1024 * 1024

export const REQUIREMENT_HANDOFF_KEY = 'nexuskit:requirement-handoff'

export const FINDING_TYPE_META: Record<FindingType, { label: string; badge: string }> = {
  risk: { label: '风险点', badge: '⚠' },
  ambiguity: { label: '歧义点', badge: '◆' },
  clarification: { label: '待澄清问题', badge: '？' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStreamEvent(eventName: string, dataText: string): RequirementAnalysisStreamEvent | null {
  if (!dataText) return null
  if (eventName === 'end') return null
  let data: unknown
  try {
    data = JSON.parse(dataText)
  } catch {
    // 无法解析的帧（如旧服务端的裸文本 end 帧）跳过，不中断整个流
    return null
  }
  if (eventName === 'stage' && isRecord(data)) {
    const stage = data.stage
    if (stage === 'parsing' || stage === 'analyzing' || stage === 'finalizing') {
      return { type: 'stage', stage }
    }
    return null
  }
  if (eventName === 'warning' && isRecord(data)) {
    return { type: 'warning', warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [] }
  }
  if (eventName === 'stream' && isRecord(data)) {
    const kind = data.kind
    const text = typeof data.text === 'string' ? data.text : ''
    if ((kind === 'reasoning' || kind === 'content' || kind === 'notice') && text) {
      return { type: 'stream', kind, text }
    }
    return null
  }
  if (eventName === 'attempt' && isRecord(data)) {
    const reason = typeof data.reason === 'string' ? data.reason : ''
    return reason ? { type: 'attempt', reason } : null
  }
  if (eventName === 'result') {
    return { type: 'result', result: data as RequirementAnalysisResult }
  }
  if (eventName === 'error' && isRecord(data)) {
    return { type: 'error', message: typeof data.message === 'string' ? data.message : '分析失败，请稍后重试。' }
  }
  return null
}

export type AnalyzeRequirementInput =
  | { kind: 'text'; text: string }
  | { kind: 'file'; file: File }

/**
 * 发起需求分析：POST /api/requirement-analysis/analyze（SSE）。
 * 粘贴文本走 JSON，文件上传走 octet-stream + x-file-name / x-ai-config 头。
 */
export async function analyzeRequirement(
  input: AnalyzeRequirementInput,
  aiConfig: RuntimeAiConfig,
  onEvent: (event: RequirementAnalysisStreamEvent) => void | Promise<void>,
): Promise<RequirementAnalysisResult> {
  const init: RequestInit = input.kind === 'text'
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.text, provider: aiConfig }),
      }
    : {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(input.file.name),
          'x-ai-config': encodeURIComponent(JSON.stringify(aiConfig)),
        },
        body: input.file,
      }

  const response = await fetch(buildUrl('/api/requirement-analysis/analyze'), init)
  if (!response.ok || !response.body) {
    let message = `需求分析请求失败：${response.status}`
    try {
      const data = await response.json() as { error?: string }
      if (data.error) message = data.error
    } catch {
      // 非 JSON 错误体，保留默认提示
    }
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: RequirementAnalysisResult | null = null
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

      const event = parseStreamEvent(eventName, dataText)
      if (event) {
        if (event.type === 'result') finalResult = event.result
        if (event.type === 'error') streamError = event.message
        await onEvent(event)
      }

      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  if (streamError) throw new Error(streamError)
  if (!finalResult) throw new Error('需求分析未返回最终结果，请重试。')
  return finalResult
}

/** 服务端生成 XMind 文件并触发下载，structureClass 跟随当前图表类型。 */
export async function exportRequirementXmind(args: {
  title: string
  tree: RequirementNode
  findings: Finding[]
  chartType: RequirementChartType
}) {
  const response = await fetch(buildUrl('/api/requirement-analysis/export/xmind'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(`导出 XMind 失败：${response.status}`)
  }
  const blob = await response.blob()
  downloadBlob(blob, `${args.title || '需求分析'}.xmind`)
}

/** POST /api/requirement-analysis/records/:id/board/generate（AI 生成图表草稿，一次性 JSON）。 */
export async function generateBoardChart(
  recordId: string,
  args: { nodeId: string; chartKind: BoardChartKind },
  aiConfig: RuntimeAiConfig,
): Promise<unknown> {
  const response = await fetch(buildUrl(`/api/requirement-analysis/records/${encodeURIComponent(recordId)}/board/generate`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId: args.nodeId, chartKind: args.chartKind, ai_config: aiConfig }),
  })
  const data = await parseRecordResponse<{ draft: unknown }>(response, '生成图表草稿失败')
  return data.draft
}

/* ── 分析记录（ADR 0004：分析结果持久化为记录）── */

export type AnalysisRecordSummary = {
  id: string
  name: string
  chartType: RequirementChartType
  createdAt: string
  updatedAt: string
  findingsCount: Record<FindingType, number>
  truncated: boolean
}

export type AnalysisRecord = {
  id: string
  name: string
  chartType: RequirementChartType
  title: string
  tree: RequirementNode
  findings: Finding[]
  sourceText: string
  truncated: boolean
  warnings: string[]
  board?: unknown
  createdAt: string
  updatedAt: string
}

export type AnalysisRecordListResult = {
  records: AnalysisRecordSummary[]
  total: number
  page: number
  pageSize: number
}

export type CreateAnalysisRecordInput = {
  name?: string
  chartType?: RequirementChartType
  title: string
  tree: RequirementNode
  findings?: Finding[]
  sourceText: string
  truncated?: boolean
  warnings?: string[]
}

export type UpdateAnalysisRecordInput = {
  name?: string
  chartType?: RequirementChartType
  board?: unknown
}

/** 统一解析记录接口响应：success:false 或 HTTP 错误都抛出服务端 error 文案。 */
async function parseRecordResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  let data: { success?: boolean; error?: string }
  try {
    data = await response.json() as { success?: boolean; error?: string }
  } catch {
    throw new Error(`${fallbackMessage}：${response.status}`)
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `${fallbackMessage}：${response.status}`)
  }
  return data as T
}

/** GET /api/requirement-analysis/records（updatedAt 倒序，分页）。 */
export async function listAnalysisRecords(args: { page?: number; pageSize?: number } = {}): Promise<AnalysisRecordListResult> {
  const page = args.page ?? 1
  const pageSize = args.pageSize ?? 10
  const response = await fetch(buildUrl(`/api/requirement-analysis/records?page=${page}&pageSize=${pageSize}`))
  return parseRecordResponse<AnalysisRecordListResult>(response, '获取分析记录失败')
}

/** GET /api/requirement-analysis/records/:id。 */
export async function getAnalysisRecord(id: string): Promise<AnalysisRecord> {
  const response = await fetch(buildUrl(`/api/requirement-analysis/records/${encodeURIComponent(id)}`))
  const data = await parseRecordResponse<{ record: AnalysisRecord }>(response, '获取分析记录失败')
  return data.record
}

/** POST /api/requirement-analysis/records（name 缺省时后端回退 title）。 */
export async function createAnalysisRecord(input: CreateAnalysisRecordInput): Promise<AnalysisRecord> {
  const response = await fetch(buildUrl('/api/requirement-analysis/records'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await parseRecordResponse<{ record: AnalysisRecord }>(response, '保存分析记录失败')
  return data.record
}

/** PATCH /api/requirement-analysis/records/:id（重命名 / 图表类型回写）。 */
export async function updateAnalysisRecord(id: string, patch: UpdateAnalysisRecordInput): Promise<AnalysisRecord> {
  const response = await fetch(buildUrl(`/api/requirement-analysis/records/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = await parseRecordResponse<{ record: AnalysisRecord }>(response, '更新分析记录失败')
  return data.record
}

/** DELETE /api/requirement-analysis/records/:id。 */
export async function deleteAnalysisRecord(id: string): Promise<void> {
  const response = await fetch(buildUrl(`/api/requirement-analysis/records/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  })
  await parseRecordResponse(response, '删除分析记录失败')
}
