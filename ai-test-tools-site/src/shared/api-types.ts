/**
 * 前后端共享的模型配置契约。
 * 当前项目采用「单供应商、一个当前模型、按 API 格式自动适配请求」的领域模型。
 */

export type ProviderKind = 'claude' | 'codex' | 'gemini'

export type AiApiFormat =
  | 'anthropic'
  | 'openai_chat'
  | 'openai_responses'
  | 'gemini_native'

const DEFAULT_MODEL_BY_FORMAT: Record<AiApiFormat, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai_chat: 'gpt-5.5',
  openai_responses: 'gpt-5.5',
  gemini_native: 'gemini-2.5-pro',
}

export interface UniversalProvider {
  id: string
  name: string
  providerType: string
  baseUrl: string
  apiKey: string
  /** 当前生效模型。后端发起请求时只使用这个字段。 */
  model: string
  /** 同一供应商下可切换的候选模型列表。 */
  modelOptions?: string[]
  apiFormat: AiApiFormat
  modelsUrl?: string
  /** 模型上下文窗口，用于能力展示和请求预算校验。 */
  contextWindow?: number
  /** 可选的供应商最大输出覆盖；未设置时由后端模型能力表解析。 */
  maxOutputTokens?: number
  websiteUrl?: string
  apiKeyUrl?: string
  notes?: string
  icon?: string
  iconColor?: string
  endpointCandidates?: string[]
  isOfficial?: boolean
  isPartner?: boolean
  primePartner?: boolean
  createdAt?: number
  updatedAt?: number
}

export interface StoredModelConfigState {
  models: UniversalProvider[]
  activeModelId: string | null
}

export interface RuntimeAiConfig {
  provider: ProviderKind
  endpointType: AiApiFormat
  baseUrl: string
  apiKey: string
  model: string
  modelsUrl?: string
  contextWindow?: number
  maxOutputTokens?: number
}

/** 兼容旧前端导出的类型别名 */
export type StoredModelConfig = UniversalProvider
export type AiConfig = RuntimeAiConfig

function firstDefinedText(...values: Array<string | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function normalizeOpenAiBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const withoutProtocol = trimmed.includes('://') ? trimmed.split('://')[1] : trimmed
  const originOnly = withoutProtocol ? !withoutProtocol.includes('/') : false
  if (originOnly) return `${trimmed}/v1`
  return trimmed
}

export function inferApiFormatFromBaseUrl(baseUrl: string): AiApiFormat {
  const normalized = baseUrl.trim().toLowerCase()
  if (!normalized) return 'openai_responses'

  if (
    normalized.includes('generativelanguage.googleapis.com')
    || normalized.includes('/v1beta/models')
    || normalized.includes('/gemini/v1beta')
  ) {
    return 'gemini_native'
  }

  if (
    normalized.includes('api.anthropic.com')
    || normalized.endsWith('/anthropic')
    || normalized.includes('/api/anthropic')
    || normalized.includes('/apps/anthropic')
    || normalized.endsWith('/messages')
  ) {
    return 'anthropic'
  }

  if (
    normalized.endsWith('/chat/completions')
    || normalized.includes('/api/coding/v3')
    || normalized.includes('/step_plan')
    || normalized.includes('/v2/coding')
    || normalized.includes('/openai/v1')
  ) {
    return 'openai_chat'
  }

  return 'openai_responses'
}

export function getDefaultModelForFormat(apiFormat: AiApiFormat) {
  return DEFAULT_MODEL_BY_FORMAT[apiFormat]
}

export function getProviderKindForFormat(apiFormat: AiApiFormat): ProviderKind {
  if (apiFormat === 'anthropic') return 'claude'
  if (apiFormat === 'gemini_native') return 'gemini'
  return 'codex'
}

export function toAiConfig(config: UniversalProvider): RuntimeAiConfig {
  const apiFormat = config.apiFormat || inferApiFormatFromBaseUrl(config.baseUrl)
  const normalizedBaseUrl = apiFormat === 'openai_chat' || apiFormat === 'openai_responses'
    ? normalizeOpenAiBaseUrl(config.baseUrl)
    : config.baseUrl.trim()

  return {
    provider: getProviderKindForFormat(apiFormat),
    endpointType: apiFormat,
    baseUrl: normalizedBaseUrl,
    apiKey: config.apiKey.trim(),
    model: firstDefinedText(config.model, getDefaultModelForFormat(apiFormat)),
    modelsUrl: config.modelsUrl?.trim() || undefined,
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
  }
}

/**
 * 为了兼容旧调用名仍保留该函数。
 * 当前统一供应商只有一组运行时模型配置，因此直接返回主配置。
 */
export function getPreferredAiConfig(
  config: UniversalProvider,
): RuntimeAiConfig | null {
  return toAiConfig(config)
}

export function getPrimaryModelLabel(config: UniversalProvider) {
  return config.model?.trim() || ''
}

export function getProviderModelOptions(config: UniversalProvider) {
  const seen = new Set<string>()
  const options: string[] = []

  for (const value of [config.model, ...(config.modelOptions ?? [])]) {
    const model = value?.trim()
    if (!model || seen.has(model)) continue
    seen.add(model)
    options.push(model)
  }

  return options
}
