import { buildUrl, parseJson } from './httpClient'

export interface ToolParam {
  name: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'boolean'
  default?: unknown
  options?: { label: string; value: string }[]
  placeholder?: string
  required?: boolean
  helper?: string
}

export interface ToolResponse {
  id: string
  name: string
  description: string
  category: string
  icon: string
  params: ToolParam[]
}

export interface ToolCategory {
  id: string
  name: string
  description: string
  icon: string
  tools: ToolResponse[]
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export async function getCategories(): Promise<ToolCategory[]> {
  const response = await fetch(buildUrl('/api/data-factory/categories'))
  const data = await parseJson<ApiResponse<ToolCategory[]>>(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? `请求失败：${response.status}`)
  }
  return data.data ?? []
}

export async function executeTool<T = unknown>(toolId: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(buildUrl('/api/data-factory/execute'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: toolId, args }),
  })
  const data = await parseJson<ApiResponse<T>>(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? `请求失败：${response.status}`)
  }
  if (data.data === undefined) {
    throw new Error('后端未返回数据')
  }
  return data.data
}

export async function batchExecuteTool<T = unknown>(
  toolId: string,
  args: Record<string, unknown>,
  count = 10,
): Promise<{ count: number; results: T[] }> {
  const response = await fetch(buildUrl('/api/data-factory/batch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: toolId, args, count }),
  })
  const data = await parseJson<ApiResponse<{ count: number; results: T[] }>>(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? `请求失败：${response.status}`)
  }
  if (data.data === undefined) {
    throw new Error('后端未返回数据')
  }
  return data.data
}
