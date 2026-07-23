import { buildUrl, parseJson, downloadBlob } from './httpClient'
import { type AiConfig, type StoredModelConfig, type UniversalProvider, toAiConfig } from '../shared/api-types'
import { loadStoredModelConfig } from './model-config-store'

export type { AiConfig, StoredModelConfig }
export { toAiConfig }

export interface TestCaseExportFormat {
  key: string
  name: string
  description: string
}

export interface TestCaseProject {
  id: string
  name: string
  createdAt: string
  testSetCount: number
  testCaseCount: number
}

export interface TestCaseSet {
  id: string
  projectId: string
  name: string
  featureName: string
  testType: 'functional' | 'api'
  language: 'zh' | 'en'
  context: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  generationJobId?: string
  error?: string
  header: string[]
  rows: string[][]
  createdAt: string
  updatedAt?: string
}

type ApiEnvelope<T> = { success: boolean; data?: T; error?: string }

async function readData<T>(response: Response, fallback: string): Promise<T> {
  const body = await parseJson<ApiEnvelope<T>>(response)
  if (!response.ok || body.success === false || body.data === undefined) {
    throw new Error(body.error ?? `${fallback}：${response.status}`)
  }
  return body.data
}

export async function listTestCaseProjects() {
  return readData<TestCaseProject[]>(await fetch(buildUrl('/api/projects')), '获取项目失败')
}

export async function createTestCaseProject(name: string) {
  const response = await fetch(buildUrl('/api/projects'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return readData<TestCaseProject>(response, '创建项目失败')
}

export async function updateTestCaseProject(projectId: string, name: string) {
  const response = await fetch(buildUrl(`/api/projects/${encodeURIComponent(projectId)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await parseJson<ApiEnvelope<unknown>>(response)
  if (!response.ok || body.success === false) throw new Error(body.error ?? `更新项目失败：${response.status}`)
}

export async function deleteTestCaseProject(projectId: string) {
  const response = await fetch(buildUrl(`/api/projects/${encodeURIComponent(projectId)}`), { method: 'DELETE' })
  const body = await parseJson<ApiEnvelope<unknown>>(response)
  if (!response.ok || body.success === false) throw new Error(body.error ?? `删除项目失败：${response.status}`)
}

export async function listTestCaseSets(projectId: string) {
  const query = new URLSearchParams({ project_id: projectId })
  return readData<TestCaseSet[]>(await fetch(buildUrl(`/api/test-sets?${query}`)), '获取用例集失败')
}

export async function deleteTestCaseSet(projectId: string, testSetId: string) {
  const query = new URLSearchParams({ project_id: projectId })
  const response = await fetch(buildUrl(`/api/test-sets/${encodeURIComponent(testSetId)}?${query}`), { method: 'DELETE' })
  const body = await parseJson<ApiEnvelope<unknown>>(response)
  if (!response.ok || body.success === false) throw new Error(body.error ?? `删除用例集失败：${response.status}`)
}

export async function upsertTestCase(args: {
  testSetId: string
  id?: string
  row: string[]
}) {
  const response = await fetch(buildUrl('/api/test-cases'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return readData<TestCaseSet>(response, '保存测试用例失败')
}

export async function deleteTestCase(testSetId: string, caseId: string) {
  const query = new URLSearchParams({ test_set_id: testSetId })
  const response = await fetch(buildUrl(`/api/test-cases/${encodeURIComponent(caseId)}?${query}`), { method: 'DELETE' })
  return readData<TestCaseSet>(response, '删除测试用例失败')
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
    generatedCount: number
    generatedCountRaw?: number
    addedCount?: number
    duplicatesFiltered?: number
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

export { loadStoredModelConfig }

export async function getTestCaseExportFormats() {
  const response = await fetch(buildUrl('/api/export/formats'))
  const data = await parseJson<{ success: boolean; data?: TestCaseExportFormat[]; error?: string }>(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? `获取导出格式失败：${response.status}`)
  }
  return data.data ?? []
}

export async function createGenerateJob(args: {
  mode: 'create' | 'regenerate_all' | 'supplement' | 'regenerate_selected'
  featureName: string
  context: string
  testType: 'functional' | 'api'
  language: 'zh' | 'en'
  aiConfig: UniversalProvider
  rows?: string[][]
  selectedIndices?: number[]
  testSetId?: string
  projectId: string
  testSetName: string
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
      rows: args.rows,
      selectedIndices: args.selectedIndices,
      testSetId: args.testSetId,
      projectId: args.projectId,
      testSetName: args.testSetName,
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
  downloadBlob(blob, `${args.featureName || '测试用例'}.xlsx`)
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

export async function exportTestCaseExcelAll(args: {
  projectName: string
  testSets: Array<{ featureName: string; rows: string[][] }>
}) {
  const response = await fetch(buildUrl('/api/export/excel-all'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...args, format: 'default' }),
  })
  if (!response.ok) throw new Error(`导出 Excel 失败：${response.status}`)
  downloadBlob(await response.blob(), `${args.projectName || '测试用例'}.xlsx`)
}

export async function exportTestCaseXmindAll(args: {
  projectName: string
  testSets: Array<{ featureName: string; rows: string[][] }>
}) {
  const response = await fetch(buildUrl('/api/export/xmind-all'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!response.ok) throw new Error(`导出 XMind 失败：${response.status}`)
  downloadBlob(await response.blob(), `${args.projectName || '测试用例库'}.xmind`)
}
