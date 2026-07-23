import { findModelConfigPreset } from './model-config-presets'
import {
  normalizeModelOptions,
  normalizeUniversalProvider as normalizeProviderWithPreset,
} from './provider-draft'
import type {
  StoredModelConfigState,
  UniversalProvider,
} from '../shared/api-types'
import {
  getDefaultModelForFormat,
  inferApiFormatFromBaseUrl,
} from '../shared/api-types'

const LEGACY_STORAGE_KEY = 'nexuskit_model_config'
const STORAGE_KEY = 'nexuskit_model_configs'

type LegacyStoredModelConfig = {
  id?: string
  name?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
  temperature?: number
  providerType?: string
  websiteUrl?: string
  apiKeyUrl?: string
  notes?: string
  createdAt?: number
  updatedAt?: number
}

type LegacyUniversalProvider = {
  id?: string
  name?: string
  providerType?: string
  baseUrl?: string
  apiKey?: string
  models?: {
    claude?: {
      model?: string
      haikuModel?: string
      sonnetModel?: string
      opusModel?: string
    }
    codex?: {
      model?: string
      reasoningEffort?: string
    }
    gemini?: {
      model?: string
    }
  }
  websiteUrl?: string
  apiKeyUrl?: string
  notes?: string
  icon?: string
  iconColor?: string
  createdAt?: number
  updatedAt?: number
}

function createModelId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `model_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function pickLegacyModelOptions(source: LegacyUniversalProvider) {
  return normalizeModelOptions([
    source.models?.codex?.model,
    source.models?.claude?.model,
    source.models?.claude?.sonnetModel,
    source.models?.claude?.haikuModel,
    source.models?.claude?.opusModel,
    source.models?.gemini?.model,
  ])
}

function pickLegacyModel(source: LegacyUniversalProvider) {
  return pickLegacyModelOptions(source)[0] ?? ''
}

function fromLegacyModel(value: LegacyStoredModelConfig): UniversalProvider | null {
  if (!value.baseUrl || !value.apiKey) return null
  const preset = findModelConfigPreset(value.providerType)
  const now = Date.now()
  const providerType = value.providerType || preset.providerType
  const apiFormat = preset.apiFormat || inferApiFormatFromBaseUrl(value.baseUrl)
  const model = value.modelId?.trim() || preset.defaultModel || getDefaultModelForFormat(apiFormat)
  const modelOptions = normalizeModelOptions([model])

  return {
    id: value.id || createModelId(),
    name: value.name || preset.name,
    providerType,
    baseUrl: value.baseUrl.trim(),
    apiKey: value.apiKey.trim(),
    model,
    modelOptions,
    apiFormat,
    modelsUrl: preset.modelsUrl,
    websiteUrl: value.websiteUrl || preset.websiteUrl,
    apiKeyUrl: value.apiKeyUrl || preset.apiKeyUrl,
    notes: value.notes,
    icon: preset.icon,
    iconColor: preset.iconColor,
    endpointCandidates: preset.endpointCandidates,
    isOfficial: preset.isOfficial,
    isPartner: preset.isPartner,
    primePartner: preset.primePartner,
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? now,
  }
}

function fromLegacyUniversalProvider(value: LegacyUniversalProvider): UniversalProvider | null {
  if (!value.baseUrl || !value.apiKey) return null
  const preset = findModelConfigPreset(value.providerType)
  const now = Date.now()
  const providerType = value.providerType || preset.providerType
  const apiFormat = preset.apiFormat || inferApiFormatFromBaseUrl(value.baseUrl)
  const model = pickLegacyModel(value) || preset.defaultModel || getDefaultModelForFormat(apiFormat)
  const modelOptions = normalizeModelOptions([model, ...pickLegacyModelOptions(value)])

  return {
    id: value.id || createModelId(),
    name: value.name?.trim() || preset.name,
    providerType,
    baseUrl: value.baseUrl.trim(),
    apiKey: value.apiKey.trim(),
    model,
    modelOptions,
    apiFormat,
    modelsUrl: preset.modelsUrl,
    websiteUrl: value.websiteUrl?.trim() || preset.websiteUrl,
    apiKeyUrl: value.apiKeyUrl?.trim() || preset.apiKeyUrl,
    notes: value.notes?.trim() || '',
    icon: value.icon || preset.icon,
    iconColor: value.iconColor || preset.iconColor,
    endpointCandidates: preset.endpointCandidates,
    isOfficial: preset.isOfficial,
    isPartner: preset.isPartner,
    primePartner: preset.primePartner,
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? now,
  }
}

function normalizeUniversalProvider(
  value: Partial<UniversalProvider> | LegacyUniversalProvider,
  fallback?: Partial<UniversalProvider>,
): UniversalProvider | null {
  if ('models' in value) {
    return fromLegacyUniversalProvider(value)
  }

  // 非旧结构的合并语义由 provider-draft 统一维护
  return normalizeProviderWithPreset(value, fallback)
}

function parseState(raw: string): StoredModelConfigState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredModelConfigState> & {
      models?: Array<Partial<UniversalProvider> | LegacyUniversalProvider>
      activeModelId?: string | null
    }
    const models = Array.isArray(parsed.models)
      ? parsed.models
          .map((item) => normalizeUniversalProvider(item))
          .filter((item): item is UniversalProvider => item !== null)
      : []

    if (models.length === 0) return null

    const activeModelId = models.some((item) => item.id === parsed.activeModelId)
      ? parsed.activeModelId ?? null
      : models[0].id

    return { models, activeModelId }
  } catch {
    return null
  }
}

function parseLegacyModel(raw: string) {
  try {
    const parsed = JSON.parse(raw) as LegacyStoredModelConfig
    return fromLegacyModel(parsed)
  } catch {
    return null
  }
}

function writeLegacyMirror(state: StoredModelConfigState) {
  const active = state.models.find((item) => item.id === state.activeModelId) ?? state.models[0] ?? null
  if (!active) {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return
  }

  localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({
    id: active.id,
    name: active.name,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    modelId: active.model,
    providerType: active.providerType,
    websiteUrl: active.websiteUrl,
    apiKeyUrl: active.apiKeyUrl,
    notes: active.notes,
    createdAt: active.createdAt,
    updatedAt: active.updatedAt,
  }))
}

export function createEmptyModelConfigState(): StoredModelConfigState {
  return {
    models: [],
    activeModelId: null,
  }
}

export function loadStoredModelConfigState(): StoredModelConfigState {
  const rawState = localStorage.getItem(STORAGE_KEY)
  const parsedState = rawState ? parseState(rawState) : null
  if (parsedState) {
    writeLegacyMirror(parsedState)
    return parsedState
  }

  const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
  const legacyModel = legacyRaw ? parseLegacyModel(legacyRaw) : null
  if (!legacyModel) return createEmptyModelConfigState()

  const migratedState = {
    models: [legacyModel],
    activeModelId: legacyModel.id,
  }
  saveStoredModelConfigState(migratedState)
  return migratedState
}

export function saveStoredModelConfigState(state: StoredModelConfigState) {
  const normalizedModels = state.models
    .map((item) => normalizeUniversalProvider(item, item))
    .filter((item): item is UniversalProvider => item !== null)
  const nextState: StoredModelConfigState = {
    models: normalizedModels,
    activeModelId: normalizedModels.some((item) => item.id === state.activeModelId)
      ? state.activeModelId
      : normalizedModels[0]?.id ?? null,
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState))
  writeLegacyMirror(nextState)
}

export function loadStoredModelConfig() {
  const state = loadStoredModelConfigState()
  if (state.models.length === 0) return null
  return state.models.find((item) => item.id === state.activeModelId) ?? state.models[0]
}

export function upsertStoredModelConfig(
  input: Omit<UniversalProvider, 'createdAt' | 'updatedAt'> &
  Partial<Pick<UniversalProvider, 'createdAt' | 'updatedAt'>>,
) {
  const state = loadStoredModelConfigState()
  const now = Date.now()
  const normalized = normalizeUniversalProvider({
    ...input,
    updatedAt: now,
  })
  if (!normalized) {
    throw new Error('模型配置缺少必要字段')
  }

  const existingIndex = state.models.findIndex((item) => item.id === normalized.id)
  const nextModels = existingIndex >= 0
    ? state.models.map((item, index) => (index === existingIndex
      ? {
          ...normalized,
          createdAt: item.createdAt ?? normalized.createdAt ?? now,
        }
      : item))
    : [...state.models, { ...normalized, createdAt: normalized.createdAt ?? now }]

  const nextState: StoredModelConfigState = {
    models: nextModels,
    activeModelId: state.activeModelId ?? normalized.id,
  }

  saveStoredModelConfigState(nextState)
  return nextState
}

export function deleteStoredModelConfig(id: string) {
  const state = loadStoredModelConfigState()
  const nextModels = state.models.filter((item) => item.id !== id)
  const nextState: StoredModelConfigState = {
    models: nextModels,
    activeModelId: state.activeModelId === id ? nextModels[0]?.id ?? null : state.activeModelId,
  }
  saveStoredModelConfigState(nextState)
  return nextState
}

export function setActiveStoredModelConfig(id: string) {
  const state = loadStoredModelConfigState()
  if (!state.models.some((item) => item.id === id)) return state
  const nextState = { ...state, activeModelId: id }
  saveStoredModelConfigState(nextState)
  return nextState
}

export function setStoredModelConfigCurrentModel(providerId: string, model: string) {
  const nextModel = model.trim()
  if (!nextModel) return loadStoredModelConfigState()

  const state = loadStoredModelConfigState()
  let changed = false
  const nextModels = state.models.map((item) => {
    if (item.id !== providerId) return item

    changed = true
    return {
      ...item,
      model: nextModel,
      modelOptions: normalizeModelOptions([nextModel, ...(item.modelOptions ?? [])]),
      updatedAt: Date.now(),
    }
  })

  if (!changed) return state

  const nextState = {
    ...state,
    models: nextModels,
  }
  saveStoredModelConfigState(nextState)
  return nextState
}
