import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, Cloud, Database, Edit3, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { useGoBack } from '../hooks/useGoBack'
import { ModelConfigModal, type ModelConfigSaveTarget } from '../components/jmeter/ModelConfigModal'
import { CustomSelect } from '../components/ui/CustomSelect'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Tooltip } from '../components/ui/Tooltip'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { useAuth } from '../lib/auth-context'
import {
  createCloudModelConfig,
  deleteCloudModelConfig,
  listCloudModelConfigs,
  updateCloudModelConfig,
  type CloudModelConfigView,
} from '../lib/auth-api'
import { deleteStoredModelConfig, loadStoredModelConfigState, parseCloudActiveModelId, saveStoredModelConfigState, setActiveCloudModelConfig, setActiveStoredModelConfig, setStoredModelConfigCurrentModel, upsertStoredModelConfig } from '../lib/model-config-store'
import { findModelConfigPreset } from '../lib/model-config-presets'
import { getProviderModelOptions, type StoredModelConfig, type StoredModelConfigState, type UniversalProvider } from '../shared/api-types'

/** 云端视图 → 编辑草稿：明文密钥不落地（留空 = 保存时保持不变），掩码/版本/服务端 ISO 时间戳不带回本地数值字段。 */
function cloudViewToProvider(view: CloudModelConfigView): UniversalProvider {
  const draft: Record<string, unknown> = { ...view, apiKey: '' }
  delete draft['apiKeyMask']
  delete draft['version']
  delete draft['createdAt']
  delete draft['updatedAt']
  // 删除上述四个服务端字段后，结构即 UniversalProvider（前端客户端是唯一写入方，契约稳定）
  return draft as unknown as UniversalProvider
}

/** 删除确认目标：本地/云端统一走一个 ConfirmDialog。 */
interface DeletingTarget {
  storage: 'local' | 'cloud'
  id: string
  name: string
}

export function SettingsPage() {
  const goBack = useGoBack()
  const { showError } = useErrorDialog()
  const { status } = useAuth()
  const cloudEnabled = status === 'authenticated'
  const [state, setState] = useState<StoredModelConfigState>(() => loadStoredModelConfigState())
  const [cloudModels, setCloudModels] = useState<CloudModelConfigView[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingModel, setEditingModel] = useState<StoredModelConfig | null>(null)
  const [editingCloud, setEditingCloud] = useState<{ apiKeyMask: string | null; version: number } | null>(null)
  const [deletingTarget, setDeletingTarget] = useState<DeletingTarget | null>(null)
  const [deleting, setDeleting] = useState(false)

  const models = state.models
  const activeModelId = state.activeModelId
  // 当前指针指向的云端条目（activeModelId = cloud:<id>，指针归浏览器，spec §4）
  const activeCloudId = parseCloudActiveModelId(activeModelId)

  const refreshState = () => {
    setState(loadStoredModelConfigState())
  }

  // 云端配置零本地缓存：未登录不可见（页面本身有登录守卫，这里兜底），登录后实时拉取
  const fetchCloudConfigs = useCallback(
    () => (cloudEnabled ? listCloudModelConfigs() : Promise.resolve<CloudModelConfigView[]>([])),
    [cloudEnabled],
  )

  useEffect(() => {
    let cancelled = false
    fetchCloudConfigs()
      .then((configs) => {
        if (!cancelled) setCloudModels(configs)
      })
      .catch(() => {
        // 拉取失败不阻塞本地列表展示
        if (!cancelled) setCloudModels([])
      })
    return () => {
      cancelled = true
    }
  }, [fetchCloudConfigs])

  /** 云端数据变更（保存/删除/迁移/409 冲突）后重新拉取；失败保留当前列表，不影响已完成的操作 */
  const refreshCloud = useCallback(async () => {
    try {
      setCloudModels(await fetchCloudConfigs())
    } catch {
      // 拉取失败保留当前列表
    }
  }, [fetchCloudConfigs])

  /**
   * 保存编排（切换=迁移，任一时刻一条配置只有一个家）：
   * - 目标云端：新建 POST / 编辑 PUT（带 version 乐观锁）；本地原件上云成功后删本地
   * - 目标本地：upsert localStorage；云端原件下载落地后删云端
   * 抛错（如 409）由弹窗统一提示，此处不关闭弹窗。
   */
  const handleSaveModel = async (config: StoredModelConfig, target: ModelConfigSaveTarget) => {
    if (target.storage === 'cloud') {
      if (editingCloud) {
        await updateCloudModelConfig(config.id, config, editingCloud.version, config.apiKey || undefined)
      } else {
        await createCloudModelConfig(config, config.apiKey || undefined)
        if (editingModel) deleteStoredModelConfig(editingModel.id)
      }
      await refreshCloud()
    } else {
      upsertStoredModelConfig(config)
      if (editingCloud) {
        await deleteCloudModelConfig(editingModel?.id ?? config.id)
        await refreshCloud()
      }
    }
    setState(loadStoredModelConfigState())
    setEditingModel(null)
    setEditingCloud(null)
    setShowModal(false)
  }

  const handleConfirmDelete = async () => {
    if (!deletingTarget || deleting) return

    setDeleting(true)
    try {
      if (deletingTarget.storage === 'cloud') {
        await deleteCloudModelConfig(deletingTarget.id)
        // 删的是当前指针指向的云端条目：指针立即归位本机第一条，不等下次生成时才回退
        if (activeCloudId === deletingTarget.id) {
          const current = loadStoredModelConfigState()
          saveStoredModelConfigState({ ...current, activeModelId: current.models[0]?.id ?? null })
        }
        await refreshCloud()
      } else {
        deleteStoredModelConfig(deletingTarget.id)
      }
    } catch (deleteError) {
      showError(deleteError, { title: '删除失败', fallbackMessage: '删除供应商配置失败，请稍后重试。' })
      return
    } finally {
      setDeleting(false)
    }

    setState(loadStoredModelConfigState())
    if (editingModel?.id === deletingTarget.id) {
      setEditingModel(null)
      setEditingCloud(null)
    }
    setDeletingTarget(null)
  }

  const handleSetActive = (modelId: string) => {
    const nextState = setActiveStoredModelConfig(modelId)
    setState(nextState)
  }

  /** 云端条目设为当前：只写指针（配置本体实时从服务端取，密钥不出服务端）。 */
  const handleSetActiveCloud = (id: string) => {
    setState(setActiveCloudModelConfig(id))
  }

  const handleSetProviderModel = (providerId: string, modelId: string) => {
    const nextState = setStoredModelConfigCurrentModel(providerId, modelId)
    setState(nextState)
  }

  const handleCreate = () => {
    setEditingModel(null)
    setEditingCloud(null)
    setShowModal(true)
  }

  const handleEdit = (model: StoredModelConfig) => {
    setEditingModel(model)
    setEditingCloud(null)
    setShowModal(true)
  }

  const handleEditCloud = (view: CloudModelConfigView) => {
    setEditingModel(cloudViewToProvider(view))
    setEditingCloud({ apiKeyMask: view.apiKeyMask, version: view.version })
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
          本地 / 云端双存储
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

        {models.length === 0 && cloudModels.length === 0 ? (
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
                          onClick={() => setDeletingTarget({ storage: 'local', id: model.id, name: model.name })}
                          className="icon-action h-9 w-9 rounded-xl text-muted transition-colors hover:!text-danger hover:!border-[oklch(0.52_0.18_25/0.3)]"
                          aria-label={`删除本地配置 ${model.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              )
            })}

            {cloudModels.map((cloud) => {
              const active = activeCloudId === cloud.id
              return (
              <div
                key={cloud.id}
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
                    {active ? <Check className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold text-fg">{cloud.name}</div>
                      <span className="badge badge-accent">云端</span>
                      {active && <span className="badge badge-success">当前使用</span>}
                      {cloud.apiKeyMask && (
                        <span className="text-[11px] font-mono text-muted">密钥 {cloud.apiKeyMask}</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <a
                        href={cloud.baseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-sm font-mono text-accent hover:underline"
                        onClick={(e) => !cloud.baseUrl && e.preventDefault()}
                      >
                        {cloud.baseUrl || '-'}
                      </a>
                      {/* 云端条目改模型走编辑弹窗（带乐观锁）；此处只读展示当前模型 */}
                      <span className="font-mono text-xs text-muted">{cloud.model}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                    {!active && (
                      <button
                        type="button"
                        onClick={() => handleSetActiveCloud(cloud.id)}
                        className="secondary-action px-3 py-2 text-xs"
                      >
                        设为当前
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleEditCloud(cloud)}
                      className="secondary-action px-3 py-2 text-xs"
                    >
                      编辑
                    </button>
                    <Tooltip content={`删除云端配置 ${cloud.name}`}>
                      <button
                        type="button"
                        onClick={() => setDeletingTarget({ storage: 'cloud', id: cloud.id, name: cloud.name })}
                        className="icon-action h-9 w-9 rounded-xl text-muted transition-colors hover:!text-danger hover:!border-[oklch(0.52_0.18_25/0.3)]"
                        aria-label={`删除云端配置 ${cloud.name}`}
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
            本地配置仅保存在当前浏览器的 `localStorage`，不上传服务器；云端配置加密入库并挂当前账号，密钥保存后只回显掩码。每条配置可在编辑弹窗中切换存储位置（切换即迁移，任一时刻只有一个家）。
          </p>
        </div>
      </div>

      <ModelConfigModal
        open={showModal}
        initialConfig={editingModel}
        cloudStorage={cloudEnabled
          ? { editing: editingCloud, onChanged: () => void refreshCloud() }
          : undefined}
        onClose={() => {
          setShowModal(false)
          setEditingModel(null)
          setEditingCloud(null)
          refreshState()
        }}
        onSave={handleSaveModel}
      />

      <ConfirmDialog
        open={Boolean(deletingTarget)}
        title={deletingTarget?.storage === 'cloud' ? '删除云端配置？' : '删除供应商配置？'}
        description={(
          <span>
            将删除「<span className="font-semibold text-fg">{deletingTarget?.name}</span>」及其候选模型配置。
            {deletingTarget?.storage === 'cloud'
              ? '此操作删除服务端保存的云端配置，所有设备同步生效，删除后不可直接恢复。'
              : '此操作只影响当前浏览器本地保存的数据，删除后不可直接恢复。'}
          </span>
        )}
        confirmText={deleting ? '删除中…' : '确认删除'}
        danger
        onCancel={() => setDeletingTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  )
}
