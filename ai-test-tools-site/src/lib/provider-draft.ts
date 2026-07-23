import {
  getDefaultModelForFormat,
  inferApiFormatFromBaseUrl,
  type UniversalProvider,
} from '../shared/api-types'
import { findModelConfigPreset, MODEL_CONFIG_PRESETS } from './model-config-presets'

/**
 * 统一供应商草稿的预设合并语义。
 * 预设负责提供展示与连接元信息（图标、官网、候选地址、API 格式等），
 * 配置弹窗与本地存储归一化共用这一份映射，避免多处复制漂移。
 */

export interface ApplyPresetOptions {
  /** 编辑已有供应商时保留用户已填写的名称。 */
  keepCurrentName?: boolean
}

function createProviderId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeModelOptions(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const options: string[] = []

  for (const value of values) {
    const model = value?.trim()
    if (!model || seen.has(model)) continue
    seen.add(model)
    options.push(model)
  }

  return options
}

/** 新建草稿默认套用第一个预设（自定义配置）；编辑时以已有配置为草稿。 */
export function createProviderDraft(initialConfig?: UniversalProvider | null): UniversalProvider {
  if (initialConfig) {
    return {
      ...initialConfig,
      modelOptions: normalizeModelOptions([initialConfig.model, ...(initialConfig.modelOptions ?? [])]),
    }
  }

  const preset = MODEL_CONFIG_PRESETS[0]
  return {
    id: createProviderId(),
    name: preset.name,
    providerType: preset.providerType,
    baseUrl: preset.defaultBaseUrl ?? '',
    apiKey: '',
    model: preset.defaultModel,
    modelOptions: normalizeModelOptions([preset.defaultModel]),
    apiFormat: preset.apiFormat,
    modelsUrl: preset.modelsUrl,
    websiteUrl: preset.websiteUrl,
    apiKeyUrl: preset.apiKeyUrl,
    notes: '',
    icon: preset.icon,
    iconColor: preset.iconColor,
    endpointCandidates: preset.endpointCandidates,
    isOfficial: preset.isOfficial,
    isPartner: preset.isPartner,
    primePartner: preset.primePartner,
  }
}

/** 切换预设类型：保留密钥、备注等用户输入，套用预设的模板字段。 */
export function applyPresetToDraft(
  draft: UniversalProvider,
  providerType: string,
  options?: ApplyPresetOptions,
): UniversalProvider {
  const preset = findModelConfigPreset(providerType)
  return {
    ...draft,
    providerType,
    name: options?.keepCurrentName && draft.name ? draft.name : preset.name,
    baseUrl: preset.defaultBaseUrl ?? '',
    model: preset.defaultModel,
    modelOptions: normalizeModelOptions([preset.defaultModel]),
    apiFormat: preset.apiFormat,
    modelsUrl: preset.modelsUrl,
    websiteUrl: preset.websiteUrl,
    apiKeyUrl: preset.apiKeyUrl,
    icon: preset.icon,
    iconColor: preset.iconColor,
    endpointCandidates: preset.endpointCandidates,
    isOfficial: preset.isOfficial,
    isPartner: preset.isPartner,
    primePartner: preset.primePartner,
  }
}

/**
 * 保存前归一化：以预设为准刷新展示元信息；
 * 自定义模板按 API 地址推断请求格式。
 */
export function normalizeProviderDraft(draft: UniversalProvider): UniversalProvider {
  const preset = findModelConfigPreset(draft.providerType)
  const apiFormat = preset.isCustomTemplate
    ? inferApiFormatFromBaseUrl(draft.baseUrl) || draft.apiFormat
    : preset.apiFormat

  return {
    ...draft,
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    model: draft.model.trim(),
    modelOptions: normalizeModelOptions([draft.model, ...(draft.modelOptions ?? [])]),
    apiFormat,
    modelsUrl: draft.modelsUrl?.trim() || preset.modelsUrl,
    websiteUrl: draft.websiteUrl?.trim() || preset.websiteUrl,
    apiKeyUrl: draft.apiKeyUrl?.trim() || preset.apiKeyUrl,
    notes: draft.notes?.trim() || '',
    providerType: preset.providerType,
    icon: preset.icon,
    iconColor: preset.iconColor,
    endpointCandidates: preset.endpointCandidates,
    isOfficial: preset.isOfficial,
    isPartner: preset.isPartner,
    primePartner: preset.primePartner,
    createdAt: draft.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * 存储层归一化：保留已有值，预设仅用于补全缺失的元信息；
 * 缺少 baseUrl/apiKey 时返回 null。
 */
export function normalizeUniversalProvider(
  value: Partial<UniversalProvider>,
  fallback?: Partial<UniversalProvider>,
): UniversalProvider | null {
  const source = { ...fallback, ...value }
  if (!source.baseUrl || !source.apiKey) return null

  const providerType = source.providerType || fallback?.providerType || 'custom'
  const preset = findModelConfigPreset(providerType)
  const apiFormat = source.apiFormat || preset.apiFormat || inferApiFormatFromBaseUrl(source.baseUrl)
  const now = Date.now()
  const model = source.model?.trim() || preset.defaultModel || getDefaultModelForFormat(apiFormat)
  const sourceModelOptions = Array.isArray(source.modelOptions) ? source.modelOptions : []
  const modelOptions = normalizeModelOptions([model, ...sourceModelOptions])

  return {
    id: source.id || createProviderId(),
    name: source.name?.trim() || preset.name,
    providerType,
    baseUrl: source.baseUrl.trim(),
    apiKey: source.apiKey.trim(),
    model,
    modelOptions,
    apiFormat,
    modelsUrl: source.modelsUrl?.trim() || preset.modelsUrl,
    contextWindow: source.contextWindow,
    maxOutputTokens: source.maxOutputTokens,
    websiteUrl: source.websiteUrl?.trim() || preset.websiteUrl,
    apiKeyUrl: source.apiKeyUrl?.trim() || preset.apiKeyUrl,
    notes: source.notes?.trim() || '',
    icon: source.icon || preset.icon,
    iconColor: source.iconColor || preset.iconColor,
    endpointCandidates: source.endpointCandidates || preset.endpointCandidates,
    isOfficial: source.isOfficial ?? preset.isOfficial,
    isPartner: source.isPartner ?? preset.isPartner,
    primePartner: source.primePartner ?? preset.primePartner,
    createdAt: source.createdAt ?? now,
    updatedAt: source.updatedAt ?? now,
  }
}
