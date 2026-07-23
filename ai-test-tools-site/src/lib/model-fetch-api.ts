import { buildUrl, parseJson } from './httpClient'
import type { AiApiFormat } from '../shared/api-types'

export interface FetchedModel {
  id: string
  ownedBy: string | null
}

export async function fetchModelsForConfig(input: {
  baseUrl: string
  apiKey: string
  apiFormat: AiApiFormat
  modelsUrl?: string
}) {
  const response = await fetch(buildUrl('/api/model-config/models'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  const data = await parseJson<{ success: boolean; data?: FetchedModel[]; error?: string }>(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error ?? `获取模型列表失败：${response.status}`)
  }
  return data.data ?? []
}
