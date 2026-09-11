/** 需求分析 v2 API 客户端：REST 记录操作 + SSE 分析流 + 文档解析 */

import { buildUrl, parseJson } from '../../lib/httpClient'
import type { RuntimeAiConfig } from '../../shared/api-types'

/** API 信封：success=false 时抛后端错误文案 */
async function parseOk<T>(response: Response): Promise<T> {
  const data = await parseJson<T & { success?: boolean; error?: string }>(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? `请求失败：${response.status}`)
  }
  return data
}

export type IssueType = 'ambiguity' | 'missing' | 'conflict' | 'untestable'
export type IssueSeverity = 'high' | 'medium' | 'low'
export type IssueStatus = 'open' | 'resolved' | 'accepted'
export type CriterionStatus = 'pending' | 'confirmed' | 'rejected'
export type ConditionKind = 'normal' | 'boundary' | 'exception'
export type RelayState = 'none' | 'relayed' | 'generated'

export interface AnalysisRecordSummary {
  id: string
  title: string
  sourceFileName: string | null
  createdAt: string
  updatedAt: string
  issueCount: number
  openIssueCount: number
  conditionCount: number
  coveredConditionCount: number
}

export interface RequirementItem {
  id: string
  recordId: string
  parentId: string | null
  level: number
  text: string
  sort: number
}

export interface AnalysisIssue {
  id: string
  recordId: string
  reqId: string | null
  type: IssueType
  severity: IssueSeverity
  quote: string
  description: string
  suggestedQuestion: string
  status: IssueStatus
}

export interface AcceptanceCriterion {
  id: string
  recordId: string
  reqId: string
  originalText: string
  rewrittenText: string
  status: CriterionStatus
}

export interface TestCondition {
  id: string
  recordId: string
  reqId: string | null
  criterionId: string | null
  text: string
  kind: ConditionKind
  relay: RelayState
  testsetId: string | null
}

export interface AnalysisRecordDetail {
  id: string
  title: string
  sourceFileName: string | null
  sourceText: string
  createdAt: string
  updatedAt: string
  requirements: RequirementItem[]
  issues: AnalysisIssue[]
  criteria: AcceptanceCriterion[]
  conditions: TestCondition[]
}

export interface RtmRow {
  reqId: string | null
  reqText: string
  conditionId: string
  conditionText: string
  conditionKind: ConditionKind
  relay: RelayState
  testsetId: string | null
}

export interface RtmView {
  totalConditions: number
  coveredConditions: number
  coverage: number
  rows: RtmRow[]
}

export type AnalysisStreamEvent =
  | { type: 'progress'; stage: string; message: string }
  | { type: 'done'; record: AnalysisRecordDetail }
  | { type: 'error'; message: string }

export async function getAnalysisStorageStatus(): Promise<'mysql' | 'memory'> {
  const response = await fetch(buildUrl('/api/requirement-analysis-v2/storage-status'))
  const data = await parseOk<{ mode: 'mysql' | 'memory' }>(response)
  return data.mode
}

export async function listAnalysisRecords(page = 1, pageSize = 20): Promise<{ records: AnalysisRecordSummary[]; total: number }> {
  const offset = (page - 1) * pageSize
  const response = await fetch(buildUrl(`/api/requirement-analysis-v2/records?limit=${pageSize}&offset=${offset}`))
  const data = await parseOk<{ records: AnalysisRecordSummary[]; total: number }>(response)
  return { records: data.records, total: data.total }
}

export async function getAnalysisRecord(id: string): Promise<AnalysisRecordDetail> {
  const response = await fetch(buildUrl(`/api/requirement-analysis-v2/records/${id}`))
  const data = await parseOk<{ record: AnalysisRecordDetail }>(response)
  return data.record
}

export async function renameAnalysisRecord(id: string, title: string): Promise<void> {
  const response = await fetch(buildUrl(`/api/requirement-analysis-v2/records/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  await parseOk(response)
}

export async function deleteAnalysisRecord(id: string): Promise<void> {
  const response = await fetch(buildUrl(`/api/requirement-analysis-v2/records/${id}`), { method: 'DELETE' })
  await parseOk(response)
}

export async function patchAnalysisIssue(id: string, patch: { status?: IssueStatus; severity?: IssueSeverity }): Promise<AnalysisIssue> {
  const response = await fetch(buildUrl(`/api/requirement-analysis-v2/issues/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = await parseOk<{ issue: AnalysisIssue }>(response)
  return data.issue
}

export async function patchCriterion(id: string, patch: { status?: CriterionStatus; rewrittenText?: string }): Promise<{ criterion: AcceptanceCriterion; issue: AnalysisIssue | null }> {
  const response = await fetch(buildUrl(`/api/requirement-analysis-v2/criteria/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return parseOk<{ criterion: AcceptanceCriterion; issue: AnalysisIssue | null }>(response)
}

/** 接力：勾选条件标记 relayed */
export async function relayConditions(recordId: string, conditionIds: string[]): Promise<number> {
  const response = await fetch(buildUrl(`/api/requirement-analysis-v2/records/${recordId}/relay`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conditionIds }),
  })
  const data = await parseOk<{ marked: number }>(response)
  return data.marked
}

/** 用例集保存后回写条件↔用例集关联 */
export async function linkConditionsToTestset(conditionIds: string[], testsetId: string): Promise<number> {
  const response = await fetch(buildUrl('/api/requirement-analysis-v2/link-testset'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conditionIds, testsetId }),
  })
  const data = await parseOk<{ linked: number }>(response)
  return data.linked
}

export async function getAnalysisRtm(recordId: string): Promise<RtmView> {
  const response = await fetch(buildUrl(`/api/requirement-analysis-v2/records/${recordId}/rtm`))
  const data = await parseOk<{ rtm: RtmView }>(response)
  return data.rtm
}

/** 文档解析（不落库）：raw body + filename 查询参数 */
export async function parseRequirementDocument(file: File): Promise<{ text: string; warnings: string[]; truncated: boolean }> {
  const response = await fetch(buildUrl(`/api/requirement-analysis-v2/parse-document?filename=${encodeURIComponent(file.name)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await file.arrayBuffer(),
  })
  return parseOk<{ text: string; warnings: string[]; truncated: boolean }>(response)
}

/** AI 分析（SSE）：完成时返回落库后的完整记录 */
export async function analyzeRequirementStream(
  body: { sourceText: string; title?: string; sourceFileName?: string },
  aiConfig: RuntimeAiConfig,
  onEvent: (event: AnalysisStreamEvent) => void,
): Promise<AnalysisRecordDetail | null> {
  const response = await fetch(buildUrl('/api/requirement-analysis-v2/analyze'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, aiConfig }),
  })
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
  let record: AnalysisRecordDetail | null = null
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
        } else if (eventName === 'done') {
          record = data.record as AnalysisRecordDetail
          onEvent({ type: 'done', record })
        } else if (eventName === 'error') {
          streamError = String(data.message ?? '分析失败')
          onEvent({ type: 'error', message: streamError })
        }
      } catch {
        // 单个事件解析失败不阻断流
      }
      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  if (streamError) throw new Error(streamError)
  return record
}
