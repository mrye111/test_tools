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

export type ToolCallResult = {
  content?: Array<{ type: 'text'; text: string }>
  error?: string
}

export type AiConfigStatus = {
  ok: boolean
  mode: string
  serverStoresConfig: boolean
  message?: string
  required?: string[]
}

export type AiModelConfig = {
  base_url: string
  api_key: string
  model: string
}

export type AiGenerateToolCall = {
  name: string
  arguments: Record<string, unknown>
  result: string
}

export type AiGenerateResponse = {
  ok: boolean
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

const DEFAULT_JMETER_API_BASE = 'http://localhost:3000'

function getApiBase() {
  const base = import.meta.env.VITE_JMETER_API_BASE ?? DEFAULT_JMETER_API_BASE
  return base.replace(/\/$/, '')
}

function buildUrl(path: string) {
  return `${getApiBase()}${path}`
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    throw new Error(`响应解析失败：${response.status}`)
  }
}

function getToolText(data: ToolCallResult) {
  const text = data.content?.[0]?.text ?? ''
  if (text.startsWith('Error')) {
    throw new Error(text)
  }
  return text
}

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

export async function callJmeterTool(name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(buildUrl(`/tools/${encodeURIComponent(name)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })

  const data = await parseJson<ToolCallResult>(response)

  if (!response.ok) {
    throw new Error(data.error ?? `调用 ${name} 失败：${response.status}`)
  }

  if (data.error) {
    throw new Error(data.error)
  }

  return getToolText(data)
}

export async function generateJmeterWithAi(args: {
  prompt: string
  ai_config: AiModelConfig
  output_path?: string
  temperature?: number
  max_tokens?: number
}) {
  const response = await fetch(buildUrl('/ai/generate-jmeter'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })

  const data = await parseJson<AiGenerateResponse>(response)

  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `AI 生成 JMX 失败：${response.status}`)
  }

  return data
}

export function extractSavedPath(text: string) {
  const match = text.match(/^Test plan saved:\s*(.+)$/m)
  return match?.[1]?.trim() ?? null
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
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? getFilename(path)
  anchor.click()
  URL.revokeObjectURL(url)
}
