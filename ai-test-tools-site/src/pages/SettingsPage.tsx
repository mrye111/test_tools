import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Edit3, Check, ShieldCheck, Database } from 'lucide-react'
import { ModelConfigModal } from '../components/jmeter/ModelConfigModal'
import { Tooltip } from '../components/ui/Tooltip'

interface ModelConfig {
  name: string
  baseUrl: string
  apiKey: string
  modelId: string
  temperature: number
}

export function SettingsPage() {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [showModal, setShowModal] = useState(false)
  const [activeModel, setActiveModel] = useState<string | null>(null)

  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = () => {
    const saved = localStorage.getItem('nexuskit_model_config')
    if (saved) {
      try {
        const config = JSON.parse(saved)
        setModels([config])
        setActiveModel(config.name)
      } catch {}
    }
  }

  const handleDelete = () => {
    localStorage.removeItem('nexuskit_model_config')
    setModels([])
    setActiveModel(null)
  }

  return (
    <div className="page-shell max-w-[860px]">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-4">
          <Tooltip content="返回首页">
            <Link to="/" className="icon-action h-10 w-10 rounded-xl">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Tooltip>
          <div>
            <h1 className="page-title">设置</h1>
            <p className="page-subtitle">管理 AI 模型配置与偏好</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-[oklch(0.62_0.18_265/0.14)] bg-white/64 px-3.5 py-1.5 text-xs font-medium text-accent shadow-[0_18px_40px_-32px_oklch(0.62_0.18_265/0.6)] backdrop-blur sm:flex">
          <ShieldCheck className="h-3.5 w-3.5" />
          本地保存
        </div>
      </div>

      {/* Model List */}
      <div className="surface-panel motion-card stagger-1 rounded-[28px] p-6">
        <div className="relative z-[1] mb-6 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">AI 模型</h2>
            <p className="mt-1.5 text-sm leading-6 text-muted">
              用于 JMeter 和用例生成的 OpenAI 兼容模型配置
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="primary-action px-4 py-2.5 text-sm"
          >
            <Plus className="h-4 w-4" />
            添加模型
          </button>
        </div>

        {models.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Database className="h-5 w-5" />
            </div>
            <div className="empty-state-title">暂未配置任何模型</div>
            <div className="empty-state-description">
              添加一个 OpenAI 兼容的 AI 模型配置，即可开始使用 JMeter 脚本生成和测试用例生成功能
            </div>
          </div>
        ) : (
          <div className="relative z-[1] space-y-3">
            {models.map((model) => (
              <div
                key={model.name}
                className={`motion-card motion-card-hover-glow flex items-center justify-between rounded-2xl p-4 ${
                  activeModel === model.name
                    ? '!border-[oklch(0.62_0.18_265/0.28)] bg-[oklch(0.62_0.18_265/0.03)]'
                    : ''
                }`}
              >
                <div className="relative z-[1] flex min-w-0 items-center gap-3.5">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-300 ${
                      activeModel === model.name
                        ? 'bg-accent text-white shadow-[0_8px_20px_-10px_oklch(0.62_0.18_265/0.6)]'
                        : 'bg-[oklch(0.62_0.18_265/0.06)] text-accent'
                    }`}
                  >
                    {activeModel === model.name ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <Edit3 className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-fg">{model.name}</div>
                    <div className="truncate text-[11px] text-muted">
                      {model.modelId} &middot; {model.baseUrl}
                    </div>
                  </div>
                </div>
                <div className="relative z-[1] flex shrink-0 items-center gap-2.5">
                  {activeModel === model.name && (
                    <span className="badge badge-accent">当前使用</span>
                  )}
                  <Tooltip content="删除此模型配置">
                    <button
                      onClick={handleDelete}
                      className="icon-action h-9 w-9 rounded-xl text-muted transition-colors hover:!text-danger hover:!border-[oklch(0.52_0.18_25/0.3)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="relative z-[1] mt-6 border-t border-[oklch(0.92_0.008_260)] pt-4">
          <p className="text-[11px] leading-[1.55] text-muted">
            配置信息仅保存在浏览器本地 (localStorage)，不会上传到任何服务器
          </p>
        </div>
      </div>

      {showModal && (
        <ModelConfigModal
          onClose={() => setShowModal(false)}
          onSave={() => {
            setShowModal(false)
            loadModels()
          }}
        />
      )}
    </div>
  )
}
