/**
 * Shared API contract types used by both frontend and backend.
 * Import from this file to ensure type consistency across the monorepo.
 */

/** AI model configuration sent from frontend to backend. */
export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** Stored model config in localStorage (includes display name and temperature). */
export interface StoredModelConfig {
  name: string
  baseUrl: string
  apiKey: string
  modelId: string
  temperature: number
}

/** Convert StoredModelConfig to the API contract format. */
export function toAiConfig(config: StoredModelConfig): AiConfig {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.modelId,
  }
}
