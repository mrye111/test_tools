import { buildUrl, parseJson, downloadBlob } from './httpClient'
import { type AiConfig, type StoredModelConfig, toAiConfig } from '../shared/api-types'

export type { AiConfig, StoredModelConfig }
export { toAiConfig }

export interface TestCaseExportFormat {
  key: string
  name: string
  description: string
}

export interface GenerateJobSubmitResponse {
  success: boolean
  data?: {
    jobId: string
    status: string
    testSetId: string
    mode: string
  }
  error?: string
}

export interface GenerateJobStatusResponse {
  success: boolean
  data?: {
    jobId: string
    status: 'queued' | 'running' | 'completed' | 'failed'
    mode: string
    testSetId: string
    projectId: string
    featureName?: string
    context?: string
    testType?: string
    language?: string
    coverageMode?: 'quick' | 'standard' | 'expert'
    maxCases?: number
    generatedCount: number
    error: string
    streamText?: string
    createdAt: string
    startedAt?: string
    finishedAt?: string
    resultHeader: string[]
    resultRows: string[][]
    testSetSnapshot?: {
      status: string
      header: string[]
      rows: string[][]
      updatedAt: string
    }
  }
  error?: string
}

type GenerateJobData = NonNullable<GenerateJobStatusResponse['data']>

export function loadStoredModelConfig() {
  const saved = localStorage.getItem('nexuskit_model_config')
  if (!saved) return null

  try {
    const parsed = JSON.parse(saved) as Partial<StoredModelConfig>
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.modelId) return null
    return {
      name: parsed.name || '默认模型',
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
      modelId: parsed.modelId,
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.2,
    } satisfies StoredModelConfig
  } catch {
    return null
  }
}

/** @deprecated Use toAiConfig from shared/api-types instead */
export const toTestCaseAiConfig = toAiConfig

export async function getTestCaseExportFormats() {
  const response = await fetch(buildUrl('/api/export/formats'))
  const data = await parseJson<{ success: boolean; data?: TestCaseExportFormat[]; error?: string }>(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? `获取导出格式失败：${response.status}`)
  }
  return data.data ?? []
}

export async function testCaseAiConnection(aiConfig: AiConfig) {
  const response = await fetch(buildUrl('/api/test-connection'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ai_config: aiConfig }),
  })
  const data = await parseJson<{ success: boolean; message?: string; error?: string }>(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? `模型连接测试失败：${response.status}`)
  }
  return data.message ?? 'API 连接成功'
}

export async function createGenerateJob(args: {
  mode: 'create' | 'regenerate_all' | 'supplement' | 'regenerate_selected'
  featureName: string
  context: string
  testType: 'functional' | 'api'
  language: 'zh' | 'en'
  coverageMode?: 'quick' | 'standard' | 'expert'
  maxCases?: number
  aiConfig: AiConfig
  rows?: string[][]
  selectedIndices?: number[]
  testSetId?: string
}) {
  const response = await fetch(buildUrl('/api/generate-jobs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: args.mode,
      featureName: args.featureName,
      context: args.context,
      testType: args.testType,
      language: args.language,
      coverageMode: args.coverageMode,
      maxCases: args.maxCases,
      rows: args.rows,
      selectedIndices: args.selectedIndices,
      testSetId: args.testSetId,
      ai_config: args.aiConfig,
    }),
  })

  const data = await parseJson<GenerateJobSubmitResponse>(response)
  if (!response.ok || data.success === false || !data.data) {
    throw new Error(data.error ?? `创建生成任务失败：${response.status}`)
  }
  return data.data
}

export async function getGenerateJob(jobId: string) {
  const response = await fetch(buildUrl(`/api/generate-jobs/${encodeURIComponent(jobId)}`))
  const data = await parseJson<GenerateJobStatusResponse>(response)
  if (!response.ok || data.success === false || !data.data) {
    throw new Error(data.error ?? `获取任务状态失败：${response.status}`)
  }
  return data.data
}

export async function waitForGenerateJob(jobId: string, onTick?: (job: GenerateJobData) => void) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await getGenerateJob(jobId)
    onTick?.(job)
    if (job.status === 'completed' || job.status === 'failed') {
      return job
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500))
  }
  throw new Error('生成任务轮询超时，请稍后重试')
}

export async function exportTestCaseExcel(args: {
  featureName: string
  format: string
  rows: string[][]
  issueType?: string
  component?: string
  labels?: string
  productName?: string
}) {
  const response = await fetch(buildUrl('/api/export/excel'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(`导出 Excel 失败：${response.status}`)
  }
  const blob = await response.blob()
  downloadBlob(blob, `${args.featureName || '测试用例'}.xls`)
}

export async function exportTestCaseXmind(args: {
  featureName: string
  rows: string[][]
}) {
  const response = await fetch(buildUrl('/api/export/xmind'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(`导出 XMind 失败：${response.status}`)
  }
  const blob = await response.blob()
  downloadBlob(blob, `${args.featureName || '测试用例库'}.xmind`)
}
