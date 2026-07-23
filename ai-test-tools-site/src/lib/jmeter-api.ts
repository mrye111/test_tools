import { buildUrl, parseJson, downloadBlob } from './httpClient'
import type { RuntimeAiConfig } from '../shared/api-types'

export type { AiConfig, RuntimeAiConfig, StoredModelConfig, UniversalProvider } from '../shared/api-types'
export { getPreferredAiConfig, getPrimaryModelLabel, toAiConfig } from '../shared/api-types'

export type JmeterToolSchemaProperty = {
  type?: string
  description?: string
  default?: unknown
}

export type JmeterToolSchema = {
  type?: string
  properties?: Record<string, JmeterToolSchemaProperty>
  required?: string[]
}

export type JmeterTool = {
  name: string
  description: string
  inputSchema: JmeterToolSchema
}

export type JmeterHealth = {
  ok: boolean
  server: string
  version: string
  tools: number
}

/** One construction step of a server-side plan build. */
export type JmeterBuildStep = {
  tool: string
  args?: Record<string, unknown>
}

/** Template build request for POST /api/jmeter/build. */
export type JmeterBuildSpec = {
  planName: string
  seed: string
  steps: JmeterBuildStep[]
}

export type JmeterBuildResponse = {
  ok: true
  planName: string
  path: string
  filename: string
  saveMessage: string
  validation: string
  tree: string
  steps: Array<{ tool: string; text: string }>
}

export type JmeterBuildFailure = {
  ok: false
  error: { code: string; message: string; step?: string }
}

export type AiConfigStatus = {
  ok: boolean
  mode: string
  serverStoresConfig: boolean
  message?: string
  required?: string[]
}

export type AiGenerateToolCall = {
  name: string
  arguments: Record<string, unknown>
  result: string
}

export type AiGenerateResponse = {
  ok: boolean
  provider?: string
  model: string
  summary: string
  notes?: string[]
  planName: string
  outputPath: string
  downloadUrl: string
  toolCalls: AiGenerateToolCall[]
  validation: string
  saveResult: string
  tree: string
  error?: string
}

export type JmeterTreeNode = {
  path: string
  name: string
  testClass: string
  enabled: boolean
  depth: number
  children: JmeterTreeNode[]
}

export type AiGenerateStreamEvent =
  | { type: 'status'; stepId: string; phase: 'start' | 'done'; title: string; content: string }
  | { type: 'tool'; stepId: string; phase: 'start' | 'done'; title: string; content: string; toolName: string; arguments: Record<string, unknown> }
  | { type: 'done'; title: string; content: string; result: AiGenerateResponse }
  | { type: 'error'; title: string; content: string; stepId?: string }

function getFilename(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? 'test-plan.jmx'
}

export async function getJmeterHealth() {
  const response = await fetch(buildUrl('/health'))
  if (!response.ok) {
    throw new Error(`后端健康检查失败：${response.status}`)
  }
  return parseJson<JmeterHealth>(response)
}

export async function getJmeterTools() {
  const response = await fetch(buildUrl('/tools'))
  if (!response.ok) {
    throw new Error(`获取工具列表失败：${response.status}`)
  }
  return parseJson<JmeterTool[]>(response)
}

export async function getJmeterAiConfig() {
  const response = await fetch(buildUrl('/ai/config'))
  if (!response.ok) {
    throw new Error(`获取 AI 接口配置失败：${response.status}`)
  }
  return parseJson<AiConfigStatus>(response)
}

export async function buildJmeterPlan(spec: JmeterBuildSpec): Promise<JmeterBuildResponse> {
  const response = await fetch(buildUrl('/api/jmeter/build'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  })

  const data = await parseJson<JmeterBuildResponse | JmeterBuildFailure>(response)

  if (!response.ok || !data.ok) {
    const message = data.ok === false ? data.error.message : `生成 JMX 失败：${response.status}`
    throw new Error(message)
  }

  return data
}

function parseTreeLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return null

  const match = trimmed.match(/^((?:\/\d+)+)\s+\|\s+(.+?)\s+\|\s+(.+?)\s+\|\s+enabled=(true|false)$/)
  if (!match) return null

  const [, path, name, testClass, enabledText] = match
  const depth = path.split('/').filter(Boolean).length - 1
  return {
    path,
    name,
    testClass,
    enabled: enabledText === 'true',
    depth,
  }
}

export function parseJmeterTree(text: string): JmeterTreeNode[] {
  const flatNodes = text
    .split(/\r?\n/)
    .map(parseTreeLine)
    .filter((node): node is NonNullable<ReturnType<typeof parseTreeLine>> => node !== null)

  const rootNodes: JmeterTreeNode[] = []
  const nodeMap = new Map<string, JmeterTreeNode>()

  for (const flatNode of flatNodes) {
    const node: JmeterTreeNode = {
      ...flatNode,
      children: [],
    }
    nodeMap.set(node.path, node)

    const parentPath = node.path.replace(/\/\d+$/, '')
    if (!parentPath) {
      rootNodes.push(node)
      continue
    }

    const parent = nodeMap.get(parentPath)
    if (parent) {
      parent.children.push(node)
    } else {
      rootNodes.push(node)
    }
  }

  return rootNodes
}

export async function generateJmeterWithAiStream(
  args: {
    prompt: string
    ai_config: RuntimeAiConfig
    output_path?: string
    max_tokens?: number
  },
  onEvent: (event: AiGenerateStreamEvent) => void | Promise<void>,
) {
  const response = await fetch(buildUrl('/ai/generate-jmeter/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })

  if (!response.ok || !response.body) {
    throw new Error(`AI 流式生成失败：${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: AiGenerateResponse | null = null

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
      const dataLines = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
      const dataText = dataLines.join('\n')

      if (eventName === 'ai-event' && dataText) {
        const event = JSON.parse(dataText) as AiGenerateStreamEvent
        await onEvent(event)
        if (event.type === 'done') {
          finalResult = event.result
        }
        if (event.type === 'error') {
          throw new Error(event.content)
        }
      }

      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  if (!finalResult) {
    throw new Error('AI 流式生成未返回最终结果')
  }

  return finalResult
}

export function createJmxDownloadUrl(path: string) {
  return buildUrl(`/files?path=${encodeURIComponent(path)}`)
}

export async function downloadGeneratedJmx(path: string, filename?: string) {
  const response = await fetch(createJmxDownloadUrl(path))
  if (!response.ok) {
    let message = `下载失败：${response.status}`
    try {
      const data = await response.json() as { error?: string }
      if (data.error) message = data.error
    } catch {
      // 忽略非 JSON 错误体
    }
    throw new Error(message)
  }

  const blob = await response.blob()
  downloadBlob(blob, filename ?? getFilename(path))
}
