import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Globe,
  KeyRound,
  Plus,
  Save,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { ModalShell } from '../ui/ModalShell'
import { useErrorDialog } from '../ui/ErrorDialogProvider'
import { MODEL_CONFIG_PRESETS, findModelConfigPreset } from '../../lib/model-config-presets'
import { fetchModelsForConfig, type FetchedModel } from '../../lib/model-fetch-api'
import {
  applyPresetToDraft,
  createProviderDraft,
  normalizeModelOptions,
  normalizeProviderDraft,
} from '../../lib/provider-draft'
import {
  getDefaultModelForFormat,
  inferApiFormatFromBaseUrl,
  type AiApiFormat,
  type UniversalProvider,
} from '../../shared/api-types'

interface Props {
  /** 由父组件控制显隐；置 false 时播放退出动画后卸载（组件需保持挂载） */
  open: boolean
  initialConfig?: UniversalProvider | null
  onClose: () => void
  onSave: (config: UniversalProvider) => void
}

function groupedModels(models: FetchedModel[]) {
  const groups = new Map<string, FetchedModel[]>()
  for (const model of models) {
    const key = model.ownedBy || 'Other'
    const current = groups.get(key) ?? []
    current.push(model)
    groups.set(key, current)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function mergeModelDropdownOptions(models: FetchedModel[]) {
  const byId = new Map<string, FetchedModel>()

  for (const model of models) {
    const id = model.id.trim()
    if (!id) continue

    const existing = byId.get(id)
    if (!existing || (!existing.ownedBy && model.ownedBy)) {
      byId.set(id, {
        id,
        ownedBy: model.ownedBy,
      })
    }
  }

  return [...byId.values()]
}

function formatApiFormatLabel(apiFormat: AiApiFormat) {
  if (apiFormat === 'anthropic') return 'Anthropic Messages'
  if (apiFormat === 'openai_chat') return 'OpenAI Chat'
  if (apiFormat === 'gemini_native') return 'Gemini Native'
  return 'OpenAI Responses'
}

export function ModelConfigModal({ open, initialConfig, onClose, onSave }: Props) {
  type DraftErrorField = 'name' | 'baseUrl' | 'apiKey' | 'model'
  const { showError } = useErrorDialog()
  // 关闭期间 initialConfig 可能被父组件清空，缓存编辑态以维持退出动画中的标题；
  // 用 prev-state 模式在打开沿同步（不写 ref，保持 render 纯函数）
  const [isEditMode, setIsEditMode] = useState(Boolean(initialConfig))
  const [prevOpenForMode, setPrevOpenForMode] = useState(open)
  if (open !== prevOpenForMode) {
    setPrevOpenForMode(open)
    if (open) setIsEditMode(Boolean(initialConfig))
  }
  const [draft, setDraft] = useState<UniversalProvider>(() => createProviderDraft(initialConfig))
  const [selectedPresetType, setSelectedPresetType] = useState<string>(() => initialConfig?.providerType || MODEL_CONFIG_PRESETS[0].providerType)
  const [showApiKey, setShowApiKey] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'baseUrl' | 'apiKey' | 'model', string>>>({})
  const [loadingModels, setLoadingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([])
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [pendingDeleteModelId, setPendingDeleteModelId] = useState<string | null>(null)

  // 组件现在常驻挂载，每次从关闭到打开时重建草稿（等价于原先的条件挂载 + key 重挂载）；
  // 同时递增会话号，使上一会话在途的 fetchModels 回调失效（旧请求结果不注入新表单）
  const prevOpenRef = useRef(open)
  const fetchSessionRef = useRef(0)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      fetchSessionRef.current += 1
      setDraft(createProviderDraft(initialConfig))
      setSelectedPresetType(initialConfig?.providerType || MODEL_CONFIG_PRESETS[0].providerType)
      setShowApiKey(false)
      setFieldErrors({})
      setLoadingModels(false)
      setFetchedModels([])
      setShowModelMenu(false)
      setPendingDeleteModelId(null)
    }
    prevOpenRef.current = open
  }, [open, initialConfig])

  const selectedPreset = useMemo(() => findModelConfigPreset(selectedPresetType), [selectedPresetType])

  const candidateModels = useMemo(
    () => normalizeModelOptions(draft.modelOptions ?? []),
    [draft.modelOptions],
  )

  const modelDropdownOptions = useMemo(
    () => mergeModelDropdownOptions([
      ...fetchedModels,
      ...candidateModels.map((model) => ({ id: model, ownedBy: null })),
    ]),
    [candidateModels, fetchedModels],
  )

  const modelGroups = useMemo(() => groupedModels(modelDropdownOptions), [modelDropdownOptions])

  const updateDraft = <K extends keyof UniversalProvider>(key: K, value: UniversalProvider[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (key === 'name' || key === 'baseUrl' || key === 'apiKey' || key === 'model') {
      const field = key as DraftErrorField
      setFieldErrors((current) => {
        if (!current[field]) return current
        const next = { ...current }
        delete next[field]
        return next
      })
    }
  }

  const setCurrentModel = (modelId: string) => {
    const nextModel = modelId.trim()
    if (!nextModel) return

    setDraft((current) => ({
      ...current,
      model: nextModel,
      modelOptions: normalizeModelOptions([...(current.modelOptions ?? []), nextModel]),
    }))
    setPendingDeleteModelId(null)
    setFieldErrors((current) => {
      if (!current.model) return current
      const next = { ...current }
      delete next.model
      return next
    })
  }

  const handleAddCurrentModelOption = () => {
    if (!validateDraft(['model'])) return
    setCurrentModel(draft.model)
  }

  const handleRemoveModelOption = (modelId: string) => {
    setPendingDeleteModelId(null)
    setDraft((current) => {
      const nextOptions = normalizeModelOptions(
        (current.modelOptions ?? []).filter((item) => item.trim() !== modelId),
      )
      const nextModel = current.model.trim() === modelId
        ? nextOptions[0] ?? ''
        : current.model

      return {
        ...current,
        model: nextModel,
        modelOptions: nextOptions,
      }
    })
  }

  const handleRequestRemoveModelOption = (modelId: string) => {
    if (pendingDeleteModelId !== modelId) {
      setPendingDeleteModelId(modelId)
      return
    }

    handleRemoveModelOption(modelId)
  }

  const inputClass = (field: keyof typeof fieldErrors) => `field-control ${fieldErrors[field] ? 'field-control-error' : ''}`

  const validateDraft = (fields: Array<keyof typeof fieldErrors>) => {
    const nextErrors: Partial<Record<'name' | 'baseUrl' | 'apiKey' | 'model', string>> = {}

    if (fields.includes('name') && !draft.name.trim()) {
      nextErrors.name = '请输入名称'
    }

    if (fields.includes('baseUrl')) {
      if (!draft.baseUrl.trim()) {
        nextErrors.baseUrl = '请输入 API 地址'
      } else if (!/^https?:\/\//i.test(draft.baseUrl.trim())) {
        nextErrors.baseUrl = '请输入以 http:// 或 https:// 开头的 API 地址'
      }
    }

    if (fields.includes('apiKey') && !draft.apiKey.trim()) {
      nextErrors.apiKey = '请输入 API Key'
    }

    if (fields.includes('model') && !draft.model.trim()) {
      nextErrors.model = '请输入模型名称'
    }

    setFieldErrors((current) => ({ ...current, ...nextErrors }))
    return Object.keys(nextErrors).length === 0
  }

  const handlePresetSelect = (providerType: string) => {
    setSelectedPresetType(providerType)
    setFetchedModels([])
    setShowModelMenu(false)
    setPendingDeleteModelId(null)
    setDraft((current) => applyPresetToDraft(current, providerType, { keepCurrentName: isEditMode }))
    setFieldErrors({})
  }

  const handleFetchModels = async () => {
    if (!validateDraft(['baseUrl', 'apiKey'])) return

    setPendingDeleteModelId(null)
    setLoadingModels(true)
    // 会话防护：请求在途时弹窗被关闭重开（状态已重置），旧请求的回调不得落地到本次会话
    const session = fetchSessionRef.current
    const isCurrentSession = () => session === fetchSessionRef.current
    try {
      const models = await fetchModelsForConfig({
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        apiFormat: draft.apiFormat,
        modelsUrl: draft.modelsUrl,
      })
      if (!isCurrentSession()) return
      setFetchedModels(models)
      setShowModelMenu(models.length > 0)
      if (models.length === 0) {
        showError('当前供应商未返回任何可选模型', { title: '未获取到模型' })
      }
    } catch (fetchError) {
      if (!isCurrentSession()) return
      showError(fetchError, {
        title: '获取模型失败',
        fallbackMessage: '获取模型列表失败，请检查配置后重试。',
      })
    } finally {
      if (isCurrentSession()) setLoadingModels(false)
    }
  }

  const handleSave = () => {
    if (!validateDraft(['name', 'baseUrl', 'apiKey', 'model'])) return
    onSave(normalizeProviderDraft(draft))
  }

  return (
    <ModalShell open={open} onClose={onClose}>
      <div
        className="modal-panel w-full max-w-[980px] rounded-[30px] p-0 max-sm:max-w-full"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-[88vh] max-h-[88vh] min-h-0 flex-col overflow-hidden">
          <div className="border-b border-[oklch(0.92_0.008_264/0.88)] bg-[linear-gradient(180deg,oklch(0.995_0.002_264),oklch(1_0_0/0.88))] px-6 py-4 max-sm:px-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-accent">
                  <Sparkles className="h-3.5 w-3.5" />
                  统一供应商
                </div>
                <h3 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-fg">
                  {isEditMode ? '编辑统一供应商' : '添加统一供应商'}
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted">
                  预设供应商已按内置模板配置，可维护多个候选模型，并自动兼容不同 API 请求格式。
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="icon-action h-9 w-9 rounded-xl"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white/78">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 max-sm:px-4">
              <div className="space-y-6">
                {!isEditMode && (
                  <div className="rounded-lg border border-[oklch(0.92_0.008_264/0.88)] bg-white/78 p-4">
                    <h5 className="font-display text-base font-semibold text-fg">选择预设类型</h5>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      点击下方预设按钮快速应用内置模板配置。
                    </p>
                    <div className="mt-4 flex max-h-[220px] flex-wrap gap-2 overflow-y-auto pr-1">
                      {MODEL_CONFIG_PRESETS.map((preset) => {
                        const active = preset.providerType === selectedPresetType
                        return (
                          <button
                            key={preset.providerType}
                            type="button"
                            onClick={() => handlePresetSelect(preset.providerType)}
                            className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-all ${
                              active
                                ? 'border-accent/35 bg-accent/10 text-accent shadow-[0_10px_24px_-18px_oklch(0.58_0.17_262/0.5)]'
                                : 'border-[oklch(0.92_0.008_264/0.88)] bg-white/72 text-fg hover:border-accent/25 hover:bg-white'
                            }`}
                          >
                            <div
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                              style={{
                                color: preset.iconColor || 'oklch(0.58 0.17 262)',
                                background: `color-mix(in oklch, ${preset.iconColor || 'oklch(0.58 0.17 262)'} 10%, transparent)`,
                              }}
                            >
                              {preset.name.slice(0, 1)}
                            </div>
                            <span className="truncate">{preset.name}</span>
                            {preset.primePartner && (
                              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#f6a300] px-1 text-white">
                                <Star className="h-2.5 w-2.5 fill-current" />
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                    {selectedPreset.description && (
                      <p className="helper-text mt-3">{selectedPreset.description}</p>
                    )}
                  </div>
                )}

                <div className="space-y-4 rounded-lg border border-[oklch(0.92_0.008_264/0.88)] bg-white/78 p-4">
                  <div>
                    <h5 className="font-display text-base font-semibold text-fg">基础信息</h5>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      预设供应商会自动填入请求地址、官网地址和 API Key 跳转地址。
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="field-label field-label-required">名称</label>
                      <input
                        value={draft.name}
                        onChange={(event) => updateDraft('name', event.target.value)}
                        placeholder="例如：我的 OpenRouter"
                        className={inputClass('name')}
                        aria-invalid={Boolean(fieldErrors.name)}
                      />
                      {fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}
                    </div>

                    <div>
                      <label className="field-label field-label-required">API 地址</label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted">
                          <Globe className="h-4 w-4" />
                        </div>
                        <input
                          value={draft.baseUrl}
                          onChange={(event) => {
                            const nextBaseUrl = event.target.value
                            updateDraft('baseUrl', nextBaseUrl)
                            if (selectedPreset.isCustomTemplate) {
                              updateDraft('apiFormat', inferApiFormatFromBaseUrl(nextBaseUrl))
                            }
                          }}
                          placeholder="https://api.example.com/v1"
                          className={`${inputClass('baseUrl')} !pl-12`}
                          aria-invalid={Boolean(fieldErrors.baseUrl)}
                        />
                      </div>
                      {fieldErrors.baseUrl && <p className="field-error">{fieldErrors.baseUrl}</p>}
                    </div>

                    <div>
                      <label className="field-label field-label-required">API Key</label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted">
                          <KeyRound className="h-4 w-4" />
                        </div>
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={draft.apiKey}
                          onChange={(event) => updateDraft('apiKey', event.target.value)}
                          placeholder="sk-..."
                          className={`${inputClass('apiKey')} !pl-12 !pr-12`}
                          aria-invalid={Boolean(fieldErrors.apiKey)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey((value) => !value)}
                          className="absolute right-2 top-1/2 z-[1] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl border border-[oklch(0.92_0.008_264/0.88)] bg-white/82 text-fg-soft shadow-[inset_0_1px_0_oklch(1_0_0/0.7)] transition-all duration-200 hover:border-accent/35 hover:bg-white hover:text-accent hover:shadow-[0_4px_12px_-6px_oklch(0.18_0.02_264/0.06),inset_0_1px_0_oklch(1_0_0/0.7)]"
                          aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                        >
                          {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {fieldErrors.apiKey && <p className="field-error">{fieldErrors.apiKey}</p>}
                    </div>

                    <div>
                      <label className="field-label">API 格式</label>
                      <div className="field-control flex items-center justify-between bg-[oklch(0.985_0.003_264/0.92)] text-sm text-fg">
                        <span>{formatApiFormatLabel(draft.apiFormat)}</span>
                        <span className="text-[11px] text-muted">{draft.apiFormat}</span>
                      </div>
                      <p className="helper-text">
                        {selectedPreset.isCustomTemplate
                          ? '自定义供应商会根据请求地址自动推断 API 格式。'
                          : '预设供应商的 API 格式已按内置模板固定。'}
                      </p>
                    </div>

                    <div>
                      <label className="field-label">官网地址</label>
                      <input
                        value={draft.websiteUrl ?? ''}
                        onChange={(event) => updateDraft('websiteUrl', event.target.value)}
                        placeholder="https://example.com"
                        className="field-control"
                      />
                    </div>

                    <div>
                      <label className="field-label">模型列表地址</label>
                      <input
                        value={draft.modelsUrl ?? ''}
                        onChange={(event) => updateDraft('modelsUrl', event.target.value)}
                        placeholder="留空则自动推导 /v1/models"
                        className="field-control"
                      />
                      <p className="helper-text">仅在供应商模型列表端点和标准路径不同的时候填写。</p>
                    </div>

                    <div>
                      <label className="field-label">备注</label>
                      <textarea
                        value={draft.notes ?? ''}
                        onChange={(event) => updateDraft('notes', event.target.value)}
                        rows={3}
                        placeholder="可选：添加备注信息"
                        className="field-control px-4 py-3"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-[oklch(0.92_0.008_264/0.88)] bg-white/78 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h5 className="font-display text-base font-semibold text-fg">模型配置</h5>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        维护当前模型和候选模型，运行时只使用当前模型。
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {draft.apiKeyUrl && (
                        <a
                          href={draft.apiKeyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="secondary-action px-3 py-2 text-xs no-underline"
                        >
                          获取 API Key
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={handleFetchModels}
                        className="secondary-action px-3 py-2 text-xs"
                        disabled={loadingModels}
                        title="获取模型列表"
                      >
                        <Download className={`h-4 w-4 ${loadingModels ? 'animate-bounce' : ''}`} />
                        获取模型列表
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="field-label field-label-required">模型 ID</label>
                      <div className="relative">
                        <div className="flex gap-2">
                          <input
                            value={draft.model}
                            onChange={(event) => updateDraft('model', event.target.value)}
                            placeholder={selectedPreset.defaultModel || getDefaultModelForFormat(draft.apiFormat)}
                            className={`${inputClass('model')} flex-1`}
                            aria-invalid={Boolean(fieldErrors.model)}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDeleteModelId(null)
                              setShowModelMenu((value) => !value)
                            }}
                            className="secondary-action h-[42px] w-[52px] shrink-0 px-0"
                            title="选择已获取模型"
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${showModelMenu ? 'rotate-180' : ''}`} />
                          </button>
                        </div>

                        {showModelMenu && (
                          <div className="liquid-glass absolute left-0 right-0 top-[calc(100%+8px)] z-[30] max-h-[280px] overflow-y-auto rounded-2xl p-2">
                            {modelDropdownOptions.length === 0 ? (
                              <div className="rounded-xl bg-[oklch(0.985_0.003_264/0.88)] px-4 py-6 text-center text-sm text-muted">
                                请先点击右上角“获取模型列表”，或手动添加候选模型
                              </div>
                            ) : (
                              modelGroups.map(([vendor, models]) => (
                                <div key={vendor} className="mb-2 last:mb-0">
                                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                                    {vendor}
                                  </div>
                                  <div className="space-y-1">
                                    {models.map((model) => (
                                      <button
                                        key={model.id}
                                        type="button"
                                        onClick={() => {
                                          setCurrentModel(model.id)
                                          setShowModelMenu(false)
                                        }}
                                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                                          draft.model === model.id
                                            ? 'bg-accent/10 text-accent'
                                            : 'hover:bg-accent/5'
                                        }`}
                                      >
                                        <span className="truncate">{model.id}</span>
                                        {draft.model === model.id && <Check className="h-4 w-4 shrink-0" />}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                      {fieldErrors.model && <p className="field-error">{fieldErrors.model}</p>}
                      <p className="helper-text">
                        点击右上角“获取模型列表”后，可通过输入框右侧下拉快速回填并加入候选模型。
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAddCurrentModelOption}
                        className="secondary-action px-3 py-2 text-xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        添加为候选模型
                      </button>
                      <span className="text-[11px] leading-5 text-muted">
                        保存后可在统一供应商列表里切换这些模型。
                      </span>
                    </div>

                    <div className="rounded-[20px] border border-[oklch(0.92_0.008_264/0.88)] bg-[oklch(0.985_0.003_264/0.72)] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-fg">候选模型</div>
                        <span className="text-[11px] font-medium text-muted">{candidateModels.length} 个</span>
                      </div>
                      {candidateModels.length === 0 ? (
                        <div className="mt-3 rounded-2xl bg-white/68 px-4 py-5 text-center text-xs leading-5 text-muted">
                          还没有候选模型，输入模型 ID 后点击“添加为候选模型”。
                        </div>
                      ) : (
                        <div className="mt-3 max-h-[260px] space-y-2 overflow-y-auto pr-1">
                          {candidateModels.map((modelId) => {
                            const current = draft.model.trim() === modelId
                            const onlyOption = candidateModels.length <= 1
                            const confirmingDelete = pendingDeleteModelId === modelId

                            return (
                              <div
                                key={modelId}
                                className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${
                                  current
                                    ? 'border-accent/30 bg-accent/10'
                                    : 'border-[oklch(0.92_0.008_264/0.88)] bg-white/72'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="truncate font-mono text-[12px] text-fg">{modelId}</div>
                                  {current && (
                                    <div className="mt-0.5 text-[11px] font-medium text-accent">当前使用</div>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  {!current && (
                                    <button
                                      type="button"
                                      onClick={() => setCurrentModel(modelId)}
                                      className="secondary-action px-2.5 py-1.5 text-[11px]"
                                    >
                                      设为当前
                                    </button>
                                  )}
                                  {confirmingDelete ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleRequestRemoveModelOption(modelId)}
                                        className="rounded-xl border border-[oklch(0.52_0.18_25/0.26)] bg-[oklch(0.97_0.01_25/0.92)] px-2.5 py-1.5 text-[11px] font-semibold text-danger transition-colors hover:bg-[oklch(0.95_0.02_25)]"
                                      >
                                        确认删除
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setPendingDeleteModelId(null)}
                                        className="secondary-action px-2.5 py-1.5 text-[11px]"
                                      >
                                        取消
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleRequestRemoveModelOption(modelId)}
                                      className="icon-action h-8 w-8 rounded-xl text-muted transition-colors hover:!text-danger hover:!border-[oklch(0.52_0.18_25/0.3)]"
                                      disabled={current && onlyOption}
                                      title={current && onlyOption ? '至少保留一个候选模型' : '移除候选模型'}
                                      aria-label="移除候选模型"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="field-label">最大输出 Token</label>
                      <input
                        type="number"
                        min={1024}
                        step={1024}
                        value={draft.maxOutputTokens ?? ''}
                        onChange={(event) => {
                          const raw = event.target.value.trim()
                          const parsed = Number(raw)
                          updateDraft('maxOutputTokens', raw && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined)
                        }}
                        placeholder="留空按模型默认值"
                        className="field-control"
                      />
                      <p className="helper-text">可选：限制单次请求的最大输出 token。推理型模型（带思考链）建议调大，避免输出额度被思考过程耗尽。</p>
                    </div>
                  </div>
                </div>

                {(draft.websiteUrl || draft.apiKeyUrl || draft.endpointCandidates?.length) && (
                  <div className="rounded-lg border border-[oklch(0.92_0.008_264/0.88)] bg-white/78 p-4">
                    <h5 className="font-display text-base font-semibold text-fg">预设信息</h5>
                    <div className="mt-3 space-y-3 text-[12px] leading-5 text-muted">
                      {draft.websiteUrl && (
                        <div className="flex items-start gap-2">
                          <span className="mt-[2px] text-accent"><Globe className="h-3.5 w-3.5" /></span>
                          <a href={draft.websiteUrl} target="_blank" rel="noreferrer" className="break-all text-accent no-underline">
                            {draft.websiteUrl}
                          </a>
                        </div>
                      )}
                      {draft.endpointCandidates && draft.endpointCandidates.length > 0 && (
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">候选地址</div>
                          <div className="space-y-1">
                            {draft.endpointCandidates.slice(0, 4).map((candidate) => (
                              <button
                                key={candidate}
                                type="button"
                                onClick={() => updateDraft('baseUrl', candidate)}
                                className="block break-all text-left text-accent transition-opacity hover:opacity-80"
                              >
                                {candidate}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[oklch(0.92_0.008_264/0.88)] bg-white/86 px-6 py-4 max-sm:px-4">
              <div className="text-[11px] leading-5 text-muted">
                统一供应商仅保存在浏览器本地 `localStorage`，不会上传到服务器。
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="secondary-action px-5 py-2.5 text-sm"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="primary-action px-5 py-2.5 text-sm"
                >
                  <Save className="h-4 w-4" />
                  {isEditMode ? '保存修改' : '添加统一供应商'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </ModalShell>
  )
}
