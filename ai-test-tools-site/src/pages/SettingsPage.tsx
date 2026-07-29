import { useState } from 'react'
import { ArrowLeft, Check, Database, Edit3, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { useGoBack } from '../hooks/useGoBack'
import { ModelConfigModal } from '../components/jmeter/ModelConfigModal'
import { CustomSelect } from '../components/ui/CustomSelect'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Tooltip } from '../components/ui/Tooltip'
import { deleteStoredModelConfig, loadStoredModelConfigState, setActiveStoredModelConfig, setStoredModelConfigCurrentModel, upsertStoredModelConfig } from '../lib/model-config-store'
import { findModelConfigPreset } from '../lib/model-config-presets'
import { getProviderModelOptions, type StoredModelConfig, type StoredModelConfigState } from '../shared/api-types'

export function SettingsPage() {
  const goBack = useGoBack()
  const [state, setState] = useState<StoredModelConfigState>(() => loadStoredModelConfigState())
  const [showModal, setShowModal] = useState(false)
  const [editingModel, setEditingModel] = useState<StoredModelConfig | null>(null)
  const [deletingModel, setDeletingModel] = useState<StoredModelConfig | null>(null)

  const models = state.models
  const activeModelId = state.activeModelId

  const refreshState = () => {
    setState(loadStoredModelConfigState())
  }

  const handleSaveModel = (config: StoredModelConfig) => {
    const nextState = upsertStoredModelConfig(config)
    setState(nextState)
    setEditingModel(null)
    setShowModal(false)
  }

  const handleConfirmDelete = () => {
    if (!deletingModel) return

    const modelId = deletingModel.id
    const nextState = deleteStoredModelConfig(modelId)
    setState(nextState)
    setDeletingModel(null)
    if (editingModel?.id === modelId) {
      setEditingModel(null)
    }
  }

  const handleSetActive = (modelId: string) => {
    const nextState = setActiveStoredModelConfig(modelId)
    setState(nextState)
  }

  const handleSetProviderModel = (providerId: string, modelId: string) => {
    const nextState = setStoredModelConfigCurrentModel(providerId, modelId)
    setState(nextState)
  }

  const handleCreate = () => {
    setEditingModel(null)
    setShowModal(true)
  }

  const handleEdit = (model: StoredModelConfig) => {
    setEditingModel(model)
    setShowModal(true)
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-4">
          <Tooltip content="返回">
            <button type="button" onClick={goBack} className="icon-action h-10 w-10 rounded-xl" aria-label="返回">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Tooltip>
          <div>
            <h1 className="page-title">设置</h1>
            <p className="page-subtitle">管理多条统一供应商配置，并指定 JMeter 与用例生成默认使用的当前供应商</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-accent/14 bg-white/64 px-3.5 py-1.5 text-xs font-medium text-accent shadow-[0_18px_40px_-32px_oklch(0.58_0.17_262/0.6)] backdrop-blur sm:flex">
          <ShieldCheck className="h-3.5 w-3.5" />
          浏览器本地保存
        </div>
      </div>

      <div className="surface-panel motion-card rounded-[28px] p-6">
        <div className="relative z-[1] mb-5 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/18 bg-accent/8 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-accent">
              <Sparkles className="h-3.5 w-3.5" />
              多供应商管理
            </div>
            <h2 className="mt-4 font-display text-xl font-semibold tracking-[-0.035em] text-fg">统一供应商列表</h2>
            <p className="mt-1.5 text-sm leading-6 text-muted">
              这里的统一供应商会同时服务于 JMeter AI 生成和测试用例生成。你可以保存多条，并随时切换默认供应商。
            </p>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            className="primary-action px-4 py-2.5 text-sm"
          >
            <Plus className="h-4 w-4" />
            添加统一供应商
          </button>
        </div>

        {models.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Database className="h-5 w-5" />
            </div>
            <div className="empty-state-title">暂未配置任何统一供应商</div>
            <div className="empty-state-description">
              新增一条统一供应商后，JMeter 脚本生成和用例生成功能就可以直接复用同一套模型配置。
            </div>
          </div>
        ) : (
          <div className="relative z-[1] space-y-3">
            {models.map((model, index) => {
              const active = activeModelId === model.id
              const preset = findModelConfigPreset(model.providerType)
              const providerModelOptions = getProviderModelOptions(model)
              return (
                <div
                  key={model.id}
                  className={`group motion-card motion-card-hover-glow rounded-[26px] p-4 ${
                    active
                      ? '!border-accent/32 bg-accent/5'
                      : ''
                  }`}
                >
                  <div className="relative z-[1] flex items-center gap-4">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300 ${
                        active
                          ? 'bg-accent text-white shadow-[0_10px_24px_-12px_oklch(0.58_0.17_262/0.7)]'
                          : 'bg-accent/8 text-accent'
                      }`}
                    >
                      {active ? <Check className="h-5 w-5" /> : <Edit3 className="h-5 w-5" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-base font-semibold text-fg">{model.name}</div>
                        {preset.isOfficial && <span className="badge badge-accent">官方</span>}
                        {!preset.isOfficial && preset.isPartner && <span className="badge badge-accent">合作</span>}
                        {active && <span className="badge badge-success">当前使用</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <a
                          href={model.baseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-sm font-mono text-accent hover:underline"
                          onClick={(e) => !model.baseUrl && e.preventDefault()}
                        >
                          {model.baseUrl || '-'}
                        </a>
                        <CustomSelect
                          value={model.model}
                          onChange={(value) => handleSetProviderModel(model.id, value)}
                          options={providerModelOptions.map((item) => ({ value: item, label: item }))}
                          className="w-auto min-w-[140px] max-w-[260px] font-mono [&_button]:px-2 [&_button]:py-1 [&_button]:text-xs"
                          placement="auto"
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                      {!active && (
                        <button
                          type="button"
                          onClick={() => handleSetActive(model.id)}
                          className="secondary-action px-3 py-2 text-xs"
                        >
                          设为当前
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleEdit(model)}
                        className="secondary-action px-3 py-2 text-xs"
                      >
                        编辑
                      </button>
                      <Tooltip content={`删除供应商配置 ${index + 1}`}>
                        <button
                          type="button"
                          onClick={() => setDeletingModel(model)}
                          className="icon-action h-9 w-9 rounded-xl text-muted transition-colors hover:!text-danger hover:!border-[oklch(0.52_0.18_25/0.3)]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="relative z-[1] mt-5 border-t border-[oklch(0.92_0.008_264)] pt-4">
          <p className="text-[11px] leading-[1.55] text-muted">
            所有统一供应商配置仅保存在当前浏览器的 `localStorage` 中，不会上传到服务器，也不会写入系统目录。
          </p>
        </div>
      </div>

      <ModelConfigModal
        open={showModal}
        initialConfig={editingModel}
        onClose={() => {
          setShowModal(false)
          setEditingModel(null)
          refreshState()
        }}
        onSave={handleSaveModel}
      />

      <ConfirmDialog
        open={Boolean(deletingModel)}
        title="删除供应商配置？"
        description={(
          <span>
            将删除「<span className="font-semibold text-fg">{deletingModel?.name}</span>」及其候选模型配置。此操作只影响当前浏览器本地保存的数据，删除后不可直接恢复。
          </span>
        )}
        confirmText="确认删除"
        danger
        onCancel={() => setDeletingModel(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
