/**
 * 在线压测 API 客户端：项目 CRUD / 目录导入 / 执行生命周期 / SSE 事件流。
 * 契约对应 server/src/features/loadtest/routes.ts。
 */

import { apiFetch, buildUrl, parseJson } from '../../lib/httpClient'
import type { CloudAiConfigRef, RuntimeAiConfig } from '../../shared/api-types'

export type LoadTestRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'stopped'

export interface LoadTestProjectSummary {
  id: string
  name: string
  description: string
  targetBaseUrl: string
  createdAt: string
  updatedAt: string
}

export interface LoadTestProject extends LoadTestProjectSummary {
  scriptSource: string
  payloadTemplate: string | null
  envVars: Record<string, string>
}

export interface LoadTestRunSummary {
  id: string
  projectId: string
  status: LoadTestRunStatus
  exitCode: number | null
  error: string | null
  summaryText: string | null
  createdAt: string
  startedAt: string | null
  endedAt: string | null
}

export interface LoadTestRun extends LoadTestRunSummary {
  envSnapshot: Record<string, string>
  scriptSnapshot: string
  logTail: string
}

export type LoadTestEvent =
  | { type: 'log'; line: string }
  | { type: 'status'; status: LoadTestRunStatus; exitCode: number | null; error: string | null }
  | { type: 'summary'; text: string }

export interface ProjectPayload {
  name: string
  description?: string
  targetBaseUrl: string
  scriptSource: string
  payloadTemplate?: string | null
  envVars?: Record<string, string>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(buildUrl(path), init)
  const data = await parseJson<{ success?: boolean; error?: string } & T>(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? `请求失败：${response.status}`)
  }
  return data
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

export async function listProjects(): Promise<LoadTestProjectSummary[]> {
  const data = await request<{ projects: LoadTestProjectSummary[] }>('/api/loadtest/projects?limit=100')
  return data.projects
}

export async function getProject(id: string): Promise<LoadTestProject> {
  const data = await request<{ project: LoadTestProject }>(`/api/loadtest/projects/${id}`)
  return data.project
}

export async function createProject(input: ProjectPayload): Promise<LoadTestProject> {
  const data = await request<{ project: LoadTestProject }>('/api/loadtest/projects', jsonInit('POST', input))
  return data.project
}

export async function updateProject(id: string, input: Partial<ProjectPayload>): Promise<LoadTestProject> {
  const data = await request<{ project: LoadTestProject }>(`/api/loadtest/projects/${id}`, jsonInit('PUT', input))
  return data.project
}

export async function deleteProject(id: string): Promise<void> {
  await request(`/api/loadtest/projects/${id}`, { method: 'DELETE' })
}

export async function importProject(dir: string): Promise<LoadTestProject> {
  const data = await request<{ project: LoadTestProject }>('/api/loadtest/projects/import', jsonInit('POST', { dir }))
  return data.project
}

export async function startRun(projectId: string, env: Record<string, string>): Promise<LoadTestRun> {
  const data = await request<{ run: LoadTestRun }>(`/api/loadtest/projects/${projectId}/runs`, jsonInit('POST', { env }))
  return data.run
}

export async function listRuns(projectId: string): Promise<LoadTestRunSummary[]> {
  const data = await request<{ runs: LoadTestRunSummary[] }>(`/api/loadtest/projects/${projectId}/runs?limit=100`)
  return data.runs
}

export async function getRun(id: string): Promise<LoadTestRun> {
  const data = await request<{ run: LoadTestRun }>(`/api/loadtest/runs/${id}`)
  return data.run
}

export async function stopRun(id: string): Promise<void> {
  await request(`/api/loadtest/runs/${id}/stop`, { method: 'POST' })
}

export async function getActiveRuns(): Promise<{ running: string | null; queued: string[] }> {
  return request('/api/loadtest/runs/active')
}

/** 订阅执行事件流（SSE over fetch）：断线重连由调用方循环调用实现，服务端会回放缓冲 */
export async function* streamRunEvents(id: string, signal?: AbortSignal): AsyncGenerator<LoadTestEvent> {
  const response = await apiFetch(buildUrl(`/api/loadtest/runs/${id}/events`), { signal })
  if (!response.ok || !response.body) throw new Error(`事件流打开失败：${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      try {
        yield JSON.parse(dataLine.slice(5).trim()) as LoadTestEvent
      } catch {
        // 忽略不完整帧，等待下一帧
      }
    }
  }
}

export interface LoadTestReport {
  collecting: boolean
  run: LoadTestRun
  metrics: { name: string; value: number | null; unit: string }[]
  thresholds: { metric: string; expression: string; passed: boolean | null }[]
  series: { name: string; unit: string; points: { time: number; value: number }[] }[]
  monitoring: string
  errors: string[]
}
export interface MonitorConfig { prometheusUrl: string; targets: string[]; loadGeneratorTarget: string | null }
export interface MonitorVerification { ready: {ok: boolean; message: string}; remoteWrite: {ok: boolean; message: string}; targets: {ok: boolean; message: string}; verified: boolean }
export async function getMonitorConfig() { return request<{config: MonitorConfig; verified: boolean}>('/api/loadtest/monitor/config') }
export async function saveMonitorConfig(config: MonitorConfig) { return request<{config: MonitorConfig; verified: boolean}>('/api/loadtest/monitor/config', jsonInit('PUT', config)) }
export async function verifyMonitor() { return request<{verification: MonitorVerification}>('/api/loadtest/monitor/verify', {method:'POST'}) }
export async function getReport(id: string) { return (await request<{report: LoadTestReport}>(`/api/loadtest/runs/${id}/report`)).report }
export async function generateLoadTestDraft(prompt: string, targetBaseUrl: string, aiConfig: RuntimeAiConfig | CloudAiConfigRef) {
  return (await request<{script: string}>('/api/loadtest/ai-draft', jsonInit('POST', {prompt, targetBaseUrl, ai_config: aiConfig}))).script
}
export async function interpretLoadTestReport(id: string, aiConfig: RuntimeAiConfig | CloudAiConfigRef) {
  return (await request<{analysis: string}>(`/api/loadtest/runs/${id}/ai-interpret`, jsonInit('POST', {ai_config: aiConfig}))).analysis
}
export async function downloadReport(id: string) {
  const response = await apiFetch(buildUrl(`/api/loadtest/runs/${id}/report?format=html`))
  if (!response.ok) throw new Error(`导出失败：${response.status}`)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a'); link.href = url; link.download = `loadtest-${id}.html`; link.click(); URL.revokeObjectURL(url)
}
