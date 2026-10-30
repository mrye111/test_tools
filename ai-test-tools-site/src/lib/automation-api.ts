/** UI 自动化域 API 客户端（/api/automation/）。 */

import { apiFetch, buildUrl, parseJson } from './httpClient'
import type { AiConfigSubmitPayload } from '../shared/api-types'

export type AutomationStepType = 'act' | 'assert' | 'extract' | 'wait'
export type ExecutableLevel = 'full' | 'partial' | 'manual'
export type RunVerdict = 'passed' | 'partial' | 'failed' | 'aborted'
export type RunStatus = 'queued' | 'running' | 'done'

export interface AutomationStep {
  id: number
  type: AutomationStepType
  text: string
  saveAs?: string
  fromStep?: number
  fromExpected?: number
  enabled: boolean
}

export interface ManualItem {
  text: string
  reason: string
  fromStep?: number
}

export interface AutomationCase {
  id: string
  projectId: string
  setId?: string
  caseNo: string
  title: string
  source: 'manual' | 'playground' | 'functional-import' | 'plan-proposal'
  entryUrl: string
  preconditionText: string
  varDefs: Record<string, string>
  steps: AutomationStep[]
  manualItems: ManualItem[]
  executable: ExecutableLevel
  sourceProposalId?: string
  lastRunStatus: 'passed' | 'partial' | 'failed' | 'never'
  lastRunAt?: string
  createdAt: string
  updatedAt: string
}

export interface StepResult {
  stepId: number
  type: AutomationStepType | 'external'
  text: string
  status: 'passed' | 'failed' | 'skipped' | 'skipped-manual'
  durationMs: number
  error?: string
  extractedValue?: string
  engine?: 'fast' | 'visual'
}

export type RunEvent =
  | { kind: 'status'; status: RunStatus; at: string }
  | { kind: 'step-start'; stepId: number; stepType: AutomationStepType; text: string; at: string }
  | { kind: 'step-done'; stepId: number; status: string; durationMs: number; error?: string; engine?: 'fast' | 'visual'; at: string }
  | { kind: 'thought'; text: string; at: string }
  | { kind: 'action'; name: string; point?: [number, number]; phase: 'start' | 'done' | 'failed'; durationMs?: number; at: string }
  | { kind: 'screenshot'; data: string; at: string }
  | { kind: 'variable'; name: string; value: string; at: string }
  | { kind: 'verdict'; verdict: RunVerdict; durationMs: number; reportFile?: string; at: string }
  | { kind: 'error'; message: string; at: string }

export interface AutomationSet {
  id: string
  projectId: string
  name: string
  createdAt: string
}

export interface RootCauseInfo {
  summary: string
  fixPrompt: string
  generatedAt: string
  model?: string
}

export interface RunRecord {
  id: string
  caseId?: string
  batchId?: string
  caseNo: string
  title: string
  engine: 'visual' | 'auto'
  status: RunStatus
  verdict?: RunVerdict
  stepResults: StepResult[]
  manualItems: ManualItem[]
  entryUrl: string
  cacheId?: string
  reportFile?: string
  error?: string
  durationMs?: number
  createdAt: string
  startedAt?: string
  finishedAt?: string
  rootCause?: RootCauseInfo
  environmentId?: string
  viewport?: string
  runGroupId?: string
}

export interface EngineStatus {
  ready: boolean
  tier?: 'disabled' | 'low'
  smokeLatencyMs?: number
  reason?: string
}

export interface AutomationModelConfigView {
  baseUrl: string
  modelName: string
  family: string
  hasApiKey: boolean
  apiKeyLast4?: string
}

export interface AutomationExecutionSettings {
  modelTimeoutMs: number
  concurrency: number
  cacheDefault: boolean
}

export type EngineMode = 'auto' | 'visual'

export interface FastEngineConfigView {
  mode: EngineMode
  backend: 'off' | 'openai' | 'jev' | 'laya'
  jevBaseUrl: string
  jevHasApiKey: boolean
  jevApiKeyLast4?: string
  layaBaseUrl: string
  state: { available: boolean; backendName?: string; reason?: string }
}

export interface AutomationConfigView {
  model: AutomationModelConfigView
  execution: AutomationExecutionSettings
  engine: EngineStatus
  fastEngine: FastEngineConfigView
}

export interface CredentialItem {
  name: string
  last4: string
}

export async function getAutomationConfig(): Promise<AutomationConfigView> {
  return request<AutomationConfigView>('/api/automation/config')
}

export async function saveAutomationModelConfig(input: { baseUrl?: string; modelName?: string; family?: string; apiKey?: string }): Promise<{ model: AutomationModelConfigView; engine: EngineStatus }> {
  return request('/api/automation/config/model', jsonPut(input))
}

export async function saveAutomationExecutionConfig(input: Partial<AutomationExecutionSettings>): Promise<AutomationExecutionSettings> {
  return request<AutomationExecutionSettings>('/api/automation/config/execution', jsonPut(input))
}

export async function saveFastEngineConfig(input: { mode?: EngineMode; backend?: 'off' | 'openai' | 'jev' | 'laya'; jevBaseUrl?: string; jevApiKey?: string; layaBaseUrl?: string }): Promise<FastEngineConfigView> {
  return request<FastEngineConfigView>('/api/automation/config/fast-engine', jsonPut(input))
}

export async function listAutomationCredentials(): Promise<CredentialItem[]> {
  return request<CredentialItem[]>('/api/automation/credentials')
}

export async function setAutomationCredential(name: string, value: string): Promise<void> {
  await request<null>(`/api/automation/credentials/${encodeURIComponent(name)}`, jsonPut({ value }))
}

export async function deleteAutomationCredential(name: string): Promise<void> {
  await request<null>(`/api/automation/credentials/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

// ── P1 项目化外壳：项目聚合 / 扩展 / 环境 / 测试附件 ────────────────────────

export interface AutomationProjectSummary {
  id: string
  name: string
  systemUrl: string
  caseCount: number
  lastRunAt?: string
  lastRunVerdict?: RunVerdict
  lastRunStats?: { passed: number; failed: number; partial: number; total: number }
}

export interface ProjectRunBehavior {
  loginOncePerRun: boolean
  viewport: string
  concurrency: number
}

export interface AutomationProjectExt {
  projectId: string
  defaultEnvId?: string
  extraInstructions: string
  prdText: string
  runBehavior: ProjectRunBehavior
  updatedAt: string
}

export type EnvironmentAuth =
  | { kind: 'credentials'; usernameKey: string; passwordKey: string }
  | { kind: 'none' }
  | { kind: 'sso' }

export interface AutomationEnvironment {
  id: string
  projectId: string
  name: string
  url: string
  isDefault: boolean
  auth: EnvironmentAuth
  createdAt: string
}

export interface AutomationTestFile {
  id: string
  projectId: string
  filename: string
  size: number
  createdAt: string
}

/** 项目列表（含自动化用例数与最近一次运行结论）。 */
export async function listAutomationProjects(): Promise<AutomationProjectSummary[]> {
  return request<AutomationProjectSummary[]>('/api/automation/projects')
}

/** 建项目向导：一步建项目 + 扩展 + 默认环境 + 登录凭据，返回 projectId。 */
export async function createAutomationProject(input: {
  name: string
  url: string
  authKind: 'credentials' | 'none' | 'sso'
  username?: string
  password?: string
  extraInstructions?: string
  prdText?: string
}): Promise<{ projectId: string; environmentId: string }> {
  return request<{ projectId: string; environmentId: string }>('/api/automation/projects', jsonBody(input))
}

export async function getProjectExt(projectId: string): Promise<AutomationProjectExt> {
  return request<AutomationProjectExt>(`/api/automation/projects/${encodeURIComponent(projectId)}/ext`)
}

export async function saveProjectExt(
  projectId: string,
  patch: Partial<Pick<AutomationProjectExt, 'defaultEnvId' | 'extraInstructions' | 'prdText' | 'runBehavior'>>,
): Promise<AutomationProjectExt> {
  return request<AutomationProjectExt>(`/api/automation/projects/${encodeURIComponent(projectId)}/ext`, jsonPut(patch))
}

export async function listEnvironments(projectId: string): Promise<AutomationEnvironment[]> {
  return request<AutomationEnvironment[]>(`/api/automation/projects/${encodeURIComponent(projectId)}/environments`)
}

export async function createEnvironment(
  projectId: string,
  input: { name: string; url: string; isDefault?: boolean; auth?: EnvironmentAuth },
): Promise<AutomationEnvironment> {
  return request<AutomationEnvironment>(`/api/automation/projects/${encodeURIComponent(projectId)}/environments`, jsonBody(input))
}

export async function updateEnvironment(
  id: string,
  patch: Partial<{ name: string; url: string; auth: EnvironmentAuth }>,
): Promise<AutomationEnvironment> {
  return request<AutomationEnvironment>(`/api/automation/environments/${encodeURIComponent(id)}`, jsonPut(patch))
}

export async function deleteEnvironment(id: string): Promise<void> {
  await request<null>(`/api/automation/environments/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function setDefaultEnvironment(projectId: string, id: string): Promise<void> {
  await request<null>(`/api/automation/environments/${encodeURIComponent(id)}/default`, jsonBody({ projectId }))
}

export async function listTestFiles(projectId: string): Promise<AutomationTestFile[]> {
  return request<AutomationTestFile[]>(`/api/automation/projects/${encodeURIComponent(projectId)}/test-files`)
}

/** 上传测试附件（base64；10MB 上限）。 */
export async function uploadTestFile(projectId: string, filename: string, contentBase64: string): Promise<AutomationTestFile> {
  return request<AutomationTestFile>(`/api/automation/projects/${encodeURIComponent(projectId)}/test-files`, jsonBody({ filename, contentBase64 }))
}

export async function deleteTestFile(id: string): Promise<void> {
  await request<null>(`/api/automation/test-files/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ── P5 Test Lists / Schedules ─────────────────────────────────────────────

export interface TestList {
  id: string
  name: string
  description: string
  createdAt: string
}

export interface TestListSummary extends TestList {
  itemCount: number
  scheduleCount: number
}

export interface TestListItemView {
  id: string
  listId: string
  caseId: string
  addedAt: string
  /** 已删用例为 null（保留占位便于移除）。 */
  case: { id: string; caseNo: string; title: string; projectId: string; entryUrl: string; lastRunStatus: string } | null
}

export interface TestSchedule {
  id: string
  listId: string
  cron: string
  enabled: boolean
  lastRunAt?: string
  createdAt: string
  /** 服务端给出的中文描述（如「每天 09:30」）。 */
  cronText: string
}

export interface TestListDetail extends TestList {
  items: TestListItemView[]
  schedules: TestSchedule[]
}

export interface ListRunResult {
  batchId: string
  started: number
  skippedManual: string[]
  failed: Array<{ caseId: string; error: string }>
  runs: RunRecord[]
}

export async function listTestLists(): Promise<TestListSummary[]> {
  return request<TestListSummary[]>('/api/automation/test-lists')
}

export async function getTestList(id: string): Promise<TestListDetail> {
  return request<TestListDetail>(`/api/automation/test-lists/${encodeURIComponent(id)}`)
}

export async function createTestList(input: { name: string; description?: string; caseIds?: string[] }): Promise<TestListDetail> {
  return request<TestListDetail>('/api/automation/test-lists', jsonBody(input))
}

export async function deleteTestList(id: string): Promise<void> {
  await request<null>(`/api/automation/test-lists/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function addTestListItem(listId: string, caseId: string): Promise<TestListDetail> {
  return request<TestListDetail>(`/api/automation/test-lists/${encodeURIComponent(listId)}/items`, jsonBody({ caseId }))
}

export async function removeTestListItem(itemId: string): Promise<void> {
  await request<null>(`/api/automation/test-lists/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
}

/** 整集执行（Run List）：共 batchId 逐个发起，失败继续。 */
export async function runTestList(id: string, opts?: { engine?: EngineMode; useCache?: boolean; aiConfig?: AiConfigSubmitPayload }): Promise<ListRunResult> {
  return request<ListRunResult>(`/api/automation/test-lists/${encodeURIComponent(id)}/run`, jsonBody(opts ?? {}))
}

/** Make a list from last run：一次运行（批次则整组）的用例收进新列表。 */
export async function createTestListFromRun(runId: string): Promise<TestListDetail> {
  return request<TestListDetail>('/api/automation/test-lists/from-run', jsonBody({ runId }))
}

export async function listSchedules(listId?: string): Promise<TestSchedule[]> {
  const query = listId ? `?listId=${encodeURIComponent(listId)}` : ''
  return request<TestSchedule[]>(`/api/automation/schedules${query}`)
}

export async function createSchedule(input: { listId: string; cron: string; enabled?: boolean }): Promise<TestSchedule> {
  return request<TestSchedule>('/api/automation/schedules', jsonBody(input))
}

export async function updateSchedule(id: string, patch: { cron?: string; enabled?: boolean }): Promise<TestSchedule> {
  return request<TestSchedule>(`/api/automation/schedules/${encodeURIComponent(id)}`, jsonPut(patch))
}

export async function deleteSchedule(id: string): Promise<void> {
  await request<null>(`/api/automation/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 立即执行一次（不等 cron 到点）。 */
export async function runScheduleNow(id: string, opts?: { engine?: EngineMode; useCache?: boolean; aiConfig?: AiConfigSubmitPayload }): Promise<ListRunResult> {
  return request<ListRunResult>(`/api/automation/schedules/${encodeURIComponent(id)}/run`, jsonBody(opts ?? {}))
}

// ── P6 Insights / Activity ────────────────────────────────────────────────

export interface ProjectInsights {
  summary: {
    totalRuns: number
    finishedRuns: number
    /** 0-100，1 位小数；无结论运行时 null。 */
    passRate: number | null
    avgDurationMs: number | null
  }
  trend: Array<{ date: string; total: number; passed: number; partial: number; failed: number; aborted: number }>
  engines: Array<{ engine: 'auto' | 'visual'; count: number }>
  durations: Array<{ label: string; count: number }>
  hotspots: Array<{ caseId: string; caseNo: string; title: string; failCount: number; total: number }>
}

export interface ActivityEntry {
  id: string
  projectId: string
  actor: string
  action: 'run' | 'edit' | 'generate'
  detail: string
  createdAt: string
}

export async function getProjectInsights(projectId: string): Promise<ProjectInsights> {
  return request<ProjectInsights>(`/api/automation/projects/${encodeURIComponent(projectId)}/insights`)
}

export async function listProjectActivity(projectId: string, limit = 50): Promise<ActivityEntry[]> {
  return request<ActivityEntry[]>(`/api/automation/projects/${encodeURIComponent(projectId)}/activity?limit=${limit}`)
}

export interface AutomationStatus {
  mode: 'mysql' | 'memory'
  engine: EngineStatus
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string | { message?: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await apiFetch(buildUrl(path), init)
  } catch {
    throw new Error('网络请求失败：无法连接执行服务，请确认服务已启动（npm run server）')
  }
  const payload = await parseJson<Envelope<T>>(response)
  if (!payload.success) {
    const message = typeof payload.error === 'string' ? payload.error : (payload.error?.message ?? '请求失败')
    throw new Error(message)
  }
  return payload.data as T
}

function jsonBody(data: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
}

function jsonPut(data: unknown): RequestInit {
  return { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
}

export async function getAutomationStatus(): Promise<AutomationStatus> {
  return request<AutomationStatus>('/api/automation/storage-status')
}

export async function listAutomationCases(projectId?: string, setId?: string): Promise<AutomationCase[]> {
  const params = new URLSearchParams()
  if (projectId) params.set('projectId', projectId)
  if (setId) params.set('setId', setId)
  const query = params.toString() ? `?${params.toString()}` : ''
  return request<AutomationCase[]>(`/api/automation/cases${query}`)
}

export async function listAutomationSets(projectId?: string): Promise<AutomationSet[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return request<AutomationSet[]>(`/api/automation/sets${query}`)
}

export async function createAutomationSet(input: { projectId: string; name: string }): Promise<AutomationSet> {
  return request<AutomationSet>('/api/automation/sets', jsonBody(input))
}

export async function deleteAutomationSet(id: string): Promise<void> {
  await request<null>(`/api/automation/sets/${id}`, { method: 'DELETE' })
}

export interface SuiteRunResult {
  batchId: string
  setName: string
  started: number
  skippedManual: string[]
  runs: RunRecord[]
}

/** 套件执行：对集内全部可执行用例发起运行（失败继续）。 */
export async function runAutomationSet(setId: string, opts?: { entryUrl?: string; useCache?: boolean; engine?: EngineMode }): Promise<SuiteRunResult> {
  return request<SuiteRunResult>(`/api/automation/sets/${encodeURIComponent(setId)}/run`, jsonBody(opts ?? {}))
}

export interface BatchAggregate {
  batchId: string
  total: number
  running: number
  passed: number
  partial: number
  failed: number
  aborted: number
  createdAt: string
  runs: RunRecord[]
}

export async function getAutomationBatch(batchId: string): Promise<BatchAggregate> {
  return request<BatchAggregate>(`/api/automation/batches/${encodeURIComponent(batchId)}`)
}

export async function getAutomationCase(id: string): Promise<AutomationCase> {
  return request<AutomationCase>(`/api/automation/cases/${id}`)
}

export type AutomationCaseInput = {
  projectId: string
  setId?: string
  title: string
  source?: AutomationCase['source']
  entryUrl?: string
  preconditionText?: string
  varDefs?: Record<string, string>
  steps?: AutomationStep[]
  manualItems?: ManualItem[]
  sourceFunctionalCaseId?: string
}

export async function createAutomationCase(input: AutomationCaseInput): Promise<AutomationCase> {
  return request<AutomationCase>('/api/automation/cases', jsonBody(input))
}

export async function updateAutomationCase(id: string, patch: Partial<AutomationCaseInput>): Promise<AutomationCase> {
  return request<AutomationCase>(`/api/automation/cases/${id}`, jsonPut(patch))
}

export async function deleteAutomationCase(id: string): Promise<void> {
  await request<null>(`/api/automation/cases/${id}`, { method: 'DELETE' })
}

export interface CompileResult {
  plan: {
    executable: ExecutableLevel
    instructions: AutomationStep[]
    manualItems: ManualItem[]
    compileNotes: string[]
  }
  usedFallback: boolean
  validationErrors: string[]
  cacheHit: boolean
}

/** 编译功能用例（编辑器"从功能用例导入"流程）。 */
export async function compileFunctionalCase(input: {
  caseRef?: string
  title: string
  precondition?: string
  steps: string
  expectedResult: string
  env?: { entryUrl?: string }
  aiConfig: AiConfigSubmitPayload
}): Promise<CompileResult> {
  return request<CompileResult>('/api/automation/compile', jsonBody(input))
}

export async function startAutomationRun(
  caseId: string,
  opts?: { entryUrl?: string; useCache?: boolean; engine?: EngineMode; aiConfig?: AiConfigSubmitPayload },
): Promise<RunRecord> {
  return request<RunRecord>('/api/automation/runs', jsonBody({ caseId, ...opts }))
}

export async function listAutomationRuns(caseId?: string, limit = 50): Promise<RunRecord[]> {
  const params = new URLSearchParams()
  if (caseId) params.set('caseId', caseId)
  params.set('limit', String(limit))
  return request<RunRecord[]>(`/api/automation/runs?${params.toString()}`)
}

export async function getAutomationRun(id: string): Promise<RunRecord> {
  return request<RunRecord>(`/api/automation/runs/${id}`)
}

export async function abortAutomationRun(id: string): Promise<void> {
  await request<null>(`/api/automation/runs/${id}/abort`, { method: 'POST' })
}

// ── P4 运行洞察：站点图 / 帧画廊 / AI 根因 ──────────────────────────────────

export interface PageMapNode {
  url: string
  label: string
  touches: number
  failed: boolean
  frameCount: number
  firstAt: string
  lastAt: string
}

export interface PageMapEdge {
  from: string
  to: string
  count: number
}

export interface PageMap {
  available: boolean
  nodes: PageMapNode[]
  edges: PageMapEdge[]
}

export async function getRunPageMap(runId: string): Promise<PageMap> {
  return request<PageMap>(`/api/automation/runs/${runId}/page-map`)
}

export interface RunFrameInfo {
  stepId: number
  at: string
  phase: 'decision' | 'action' | 'failed'
  operation?: string
  targetLabel?: string
  reason?: string
  durationMs?: number
  screenshot: string
}

/** 节点页面的回放帧；node 缺省返回全部帧。 */
export async function getRunFrames(runId: string, node?: string): Promise<RunFrameInfo[]> {
  const params = node ? `?node=${encodeURIComponent(node)}` : ''
  const result = await request<{ frames: RunFrameInfo[] }>(`/api/automation/runs/${runId}/frames${params}`)
  return result.frames
}

/** 按需生成 AI 根因（仅失败运行；生成后服务端落库）。 */
export async function generateRunRootCause(runId: string, aiConfig: AiConfigSubmitPayload): Promise<RootCauseInfo> {
  return request<RootCauseInfo>(`/api/automation/runs/${runId}/root-cause`, jsonBody({ aiConfig }))
}

export interface RunFunctionalResult {
  run: RunRecord
  compile: { executable: ExecutableLevel; usedFallback: boolean; cacheHit: boolean; validationErrors: string[] }
}

/** 功能用例直跑（测试用例页"执行"按钮）。 */
export async function runFunctionalCase(input: {
  testSetId: string
  caseId: string
  entryUrl: string
  aiConfig: AiConfigSubmitPayload
}): Promise<RunFunctionalResult> {
  return request<RunFunctionalResult>('/api/automation/run-functional', jsonBody(input))
}

export function automationRunReportUrl(runId: string): string {
  return buildUrl(`/api/automation/runs/${encodeURIComponent(runId)}/report`)
}

/** 订阅运行事件流（SSE）：回放 + 直播，返回关闭函数。 */
export function subscribeRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  onError?: (message: string) => void,
): () => void {
  const source = new EventSource(buildUrl(`/api/automation/runs/${encodeURIComponent(runId)}/events`))
  source.addEventListener('run-event', (message) => {
    try {
      onEvent(JSON.parse((message as MessageEvent).data as string) as RunEvent)
    } catch {
      // 忽略非 JSON 帧（keepalive 等）
    }
  })
  // 服务端正常收尾后必须主动 close：否则 EventSource 约 3s 自动重连，形成回放循环（评审 H3）
  source.addEventListener('end', () => source.close())
  source.onerror = () => {
    // 连接失败（404/断网/服务重启）：EventSource 会自行重试，这里只把失败面透出去（评审 M10）
    if (source.readyState === EventSource.CLOSED) {
      onError?.('事件流连接失败且已关闭')
      return
    }
    onError?.('事件流连接中断，正在重试…')
  }
  return () => source.close()
}

// ── 需求导入：测试条件 → 生成功能用例集 → 批量编译落库 ──────────────────────

export type ImportStage = 'generate' | 'link' | 'compile' | 'done'

export interface ImportSummary {
  /** 生成的功能用例行数（可编译的）。 */
  generatedCases: number
  /** 落库的自动化用例数。 */
  created: number
  byExecutable: { full: number; partial: number; manual: number }
  /** 两次校验未过、降级直映的条数。 */
  fallback: number
  cacheHit: number
  failed: Array<{ caseId: string; title: string; error: string }>
}

export interface ImportJob {
  id: string
  stage: ImportStage
  recordId: string
  testSetId?: string
  progress: { done: number; total: number }
  summary?: ImportSummary
  error?: string
  createdAt: string
  finishedAt?: string
}

export type ImportEvent =
  | { kind: 'stage'; stage: ImportStage; at: string }
  | { kind: 'progress'; done: number; total: number; at: string }
  | { kind: 'item'; caseId: string; title: string; executable: ExecutableLevel; at: string }
  | { kind: 'item-failed'; caseId: string; title: string; error: string; at: string }
  | { kind: 'done'; at: string }
  | { kind: 'error'; message: string; at: string }

/** 发起需求导入（后台编排，立即返回 importId）。 */
export async function startRequirementImport(input: {
  recordId: string
  conditionIds: string[]
  projectId: string
  setId?: string
  entryUrl: string
  testType?: string
  language?: string
  promptPreset?: string
  aiConfig: AiConfigSubmitPayload
}): Promise<string> {
  const data = await request<{ importId: string }>('/api/automation/import-from-requirement', jsonBody(input))
  return data.importId
}

/** 导入任务现状（断线后可查最终汇总）。 */
export async function getImportJob(id: string): Promise<ImportJob> {
  return request<ImportJob>(`/api/automation/import-jobs/${encodeURIComponent(id)}`)
}

/** 订阅导入进度流（SSE）：回放 + 直播，返回关闭函数。 */
export function subscribeImportEvents(
  importId: string,
  onEvent: (event: ImportEvent) => void,
  onError?: (message: string) => void,
): () => void {
  const source = new EventSource(buildUrl(`/api/automation/import-jobs/${encodeURIComponent(importId)}/events`))
  source.addEventListener('import-event', (message) => {
    try {
      onEvent(JSON.parse((message as MessageEvent).data as string) as ImportEvent)
    } catch {
      // 忽略非 JSON 帧（keepalive 等）
    }
  })
  // 服务端正常收尾后必须主动 close：否则 EventSource 约 3s 自动重连，形成回放循环（评审 H3）
  source.addEventListener('end', () => source.close())
  source.onerror = () => {
    // 连接失败（404/断网/服务重启）：EventSource 会自行重试，这里只把失败面透出去（评审 M10）
    if (source.readyState === EventSource.CLOSED) {
      onError?.('事件流连接失败且已关闭')
      return
    }
    onError?.('事件流连接中断，正在重试…')
  }
  return () => source.close()
}

// ── 交互执行台 ────────────────────────────────────────────────────────────

export interface BenchSession {
  id: string
  url: string
}

export interface BenchInstructResult {
  ok: boolean
  error?: string
  events: RunEvent[]
  screenshot?: string
  extractedValue?: string
  durationMs: number
}

export async function createBenchSession(url: string): Promise<BenchSession> {
  return request<BenchSession>('/api/automation/bench/sessions', jsonBody({ url }))
}

export async function sendBenchInstruction(
  sessionId: string,
  input: { type: 'act' | 'assert' | 'query'; text: string },
): Promise<BenchInstructResult> {
  return request<BenchInstructResult>(`/api/automation/bench/sessions/${sessionId}/instructions`, jsonBody(input))
}

export async function saveBenchAsCase(sessionId: string, input: { projectId: string; title: string }): Promise<AutomationCase> {
  return request<AutomationCase>(`/api/automation/bench/sessions/${sessionId}/save`, jsonBody(input))
}

export async function closeBenchSession(sessionId: string): Promise<void> {
  await request<null>(`/api/automation/bench/sessions/${sessionId}`, { method: 'DELETE' })
}

// ── 探源（P2）───────────────────────────────────────────────────────────────

export type ExploreSourceStatus = 'running' | 'done' | 'failed' | 'aborted'

export interface ExploreSource {
  id: string
  projectId: string
  entryUrl: string
  status: ExploreSourceStatus
  maxPages: number
  pageCount: number
  error?: string
  createdAt: string
  finishedAt?: string
}

export interface CapturedElement {
  index: number
  role: string
  name: string
  kind: 'click' | 'fill' | 'select'
}

export interface CapturedPage {
  id: string
  sourceId: string
  url: string
  title: string
  depth: number
  aiSummary: string
  elements: CapturedElement[]
  screenshotFile?: string
  createdAt: string
}

export type ExploreEvent =
  | { kind: 'stage'; stage: 'login' | 'crawl' | 'done'; at: string }
  | { kind: 'log'; level: 'info' | 'warn'; text: string; at: string }
  | { kind: 'progress'; done: number; total: number; at: string }
  | { kind: 'frame'; data: string; at: string }
  | { kind: 'page'; page: Pick<CapturedPage, 'id' | 'url' | 'title' | 'depth' | 'aiSummary'>; at: string }
  | { kind: 'done'; at: string }
  | { kind: 'error'; message: string; at: string }

/** 发起探源（后台 BFS 爬站，立即返回 sourceId）。aiConfig 缺省时跳过页面摘要。 */
export async function startExplore(input: {
  projectId: string
  entryUrl: string
  maxPages: number
  aiConfig?: AiConfigSubmitPayload
}): Promise<ExploreSource> {
  return request<ExploreSource>('/api/automation/explore/sources', jsonBody(input))
}

export async function listExploreSources(projectId: string): Promise<ExploreSource[]> {
  return request<ExploreSource[]>(`/api/automation/explore/sources?projectId=${encodeURIComponent(projectId)}`)
}

export async function getExploreSource(id: string): Promise<ExploreSource> {
  return request<ExploreSource>(`/api/automation/explore/sources/${encodeURIComponent(id)}`)
}

export async function listCapturedPages(sourceId: string): Promise<CapturedPage[]> {
  return request<CapturedPage[]>(`/api/automation/explore/sources/${encodeURIComponent(sourceId)}/pages`)
}

/** 捕获页截图地址（img src 直用，会话 Cookie 鉴权）。 */
export function exploreScreenshotUrl(pageId: string): string {
  return buildUrl(`/api/automation/explore/pages/${encodeURIComponent(pageId)}/screenshot`)
}

export async function abortExplore(id: string): Promise<void> {
  await request<unknown>(`/api/automation/explore/sources/${encodeURIComponent(id)}/abort`, jsonBody({}))
}

export async function deleteExploreSource(id: string): Promise<void> {
  await request<unknown>(`/api/automation/explore/sources/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 订阅探源进度流（SSE）：回放 + 直播，返回关闭函数。 */
export function subscribeExploreEvents(
  sourceId: string,
  onEvent: (event: ExploreEvent) => void,
  onError?: (message: string) => void,
): () => void {
  const source = new EventSource(buildUrl(`/api/automation/explore/sources/${encodeURIComponent(sourceId)}/events`))
  source.addEventListener('explore-event', (message) => {
    try {
      onEvent(JSON.parse((message as MessageEvent).data as string) as ExploreEvent)
    } catch {
      // 忽略非 JSON 帧（keepalive 等）
    }
  })
  // 服务端正常收尾后必须主动 close：否则 EventSource 约 3s 自动重连（评审 H3 同款）
  source.addEventListener('end', () => source.close())
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      onError?.('事件流连接失败且已关闭')
      return
    }
    onError?.('事件流连接中断，正在重试…')
  }
  return () => source.close()
}

// ── P3 规划提案 ────────────────────────────────────────────────────────────

export type PlanProposalPriority = 'high' | 'medium' | 'low'
export type PlanProposalStatus = 'proposed' | 'accepted' | 'rejected'

export interface PlanProposal {
  id: string
  projectId: string
  batchId: string
  sourceId?: string
  useCase: string
  caseNo: string
  title: string
  goal: string
  expected: string[]
  priority: PlanProposalPriority
  estSteps: string[]
  included: boolean
  status: PlanProposalStatus
  createdAt: string
  updatedAt: string
}

export type PlanStage = 'generate' | 'validate' | 'done'
export type PlanSummary = { created: number; dropped: number; useCases: number; notes: string[] }

export interface PlanJob {
  id: string
  projectId: string
  sourceId?: string
  batchId: string
  stage: PlanStage
  summary?: PlanSummary
  error?: string
  createdAt: string
  finishedAt?: string
}

export type PlanEvent =
  | { kind: 'stage'; stage: PlanStage; at: string }
  | { kind: 'log'; level: 'info' | 'warn'; text: string; at: string }
  | { kind: 'done'; batchId: string; summary?: PlanSummary; at: string }
  | { kind: 'error'; message: string; at: string }

/** 发起规划提案生成（后台编排，立即返回 jobId）。 */
export async function generatePlanProposals(input: {
  projectId: string
  sourceId?: string
  entryUrl?: string
  aiConfig?: AiConfigSubmitPayload
}): Promise<PlanJob> {
  return request<PlanJob>('/api/automation/plan/generate', jsonBody(input))
}

export async function getPlanJob(id: string): Promise<PlanJob> {
  return request<PlanJob>(`/api/automation/plan/jobs/${encodeURIComponent(id)}`)
}

/** 订阅规划生成进度流（SSE）：回放 + 直播，返回关闭函数。 */
export function subscribePlanEvents(
  jobId: string,
  onEvent: (event: PlanEvent) => void,
  onError?: (message: string) => void,
): () => void {
  const source = new EventSource(buildUrl(`/api/automation/plan/jobs/${encodeURIComponent(jobId)}/events`))
  source.addEventListener('plan-event', (message) => {
    try {
      onEvent(JSON.parse((message as MessageEvent).data as string) as PlanEvent)
    } catch {
      // 忽略非 JSON 帧
    }
  })
  source.addEventListener('end', () => source.close())
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      onError?.('事件流连接失败且已关闭')
      return
    }
    onError?.('事件流连接中断，正在重试…')
  }
  return () => source.close()
}

export async function listPlanProposals(projectId: string): Promise<PlanProposal[]> {
  return request<PlanProposal[]>(`/api/automation/plan/proposals?projectId=${encodeURIComponent(projectId)}`)
}

export async function updatePlanProposal(
  id: string,
  patch: Partial<Pick<PlanProposal, 'title' | 'goal' | 'expected' | 'priority' | 'estSteps' | 'included' | 'status'>>,
): Promise<PlanProposal> {
  return request<PlanProposal>(`/api/automation/plan/proposals/${encodeURIComponent(id)}`, jsonPut(patch))
}

export async function deletePlanProposal(id: string): Promise<void> {
  await request<unknown>(`/api/automation/plan/proposals/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface PlanAcceptResult {
  created: AutomationCase[]
  runs: RunRecord[]
  batchId?: string
  skipped: string[]
  warning?: string
}

/** 评审采纳：勾选提案落成用例；run=true 连带执行（首跑编译补全步骤）。 */
export async function acceptPlanProposals(input: {
  proposalIds: string[]
  run: boolean
  entryUrl: string
  aiConfig?: AiConfigSubmitPayload
}): Promise<PlanAcceptResult> {
  return request<PlanAcceptResult>('/api/automation/plan/accept', jsonBody(input))
}

export interface BatchRunResult {
  batchId: string
  started: number
  skippedManual: string[]
  failed: Array<{ caseId: string; error: string }>
  runs: RunRecord[]
}

/** 按用例 ID 批量执行（Run All / 批量勾选 / 重跑失败共用）。 */
export async function startBatchRuns(input: {
  caseIds: string[]
  engine?: EngineMode
  aiConfig?: AiConfigSubmitPayload
}): Promise<BatchRunResult> {
  return request<BatchRunResult>('/api/automation/runs/batch', jsonBody(input))
}
