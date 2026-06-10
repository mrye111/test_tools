import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Edit3, Check, ShieldCheck } from 'lucide-react'
import { ModelConfigModal } from '../components/jmeter/ModelConfigModal'

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
        <Link
          to="/"
          className="icon-action h-10 w-10"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-subtitle">管理 AI 模型配置</p>
        </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-[rgba(37,99,235,0.18)] bg-white/70 px-3 py-1.5 text-xs font-medium text-accent shadow-[0_18px_40px_-32px_rgba(37,99,235,0.8)] backdrop-blur sm:flex">
          <ShieldCheck className="h-4 w-4" />
          本地保存
        </div>
      </div>

      {/* Model List */}
      <div className="surface-panel motion-card stagger-1 rounded-[28px] p-6">
        <div className="relative z-[1] mb-5 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">AI 模型</h2>
            <p className="mt-1 text-sm leading-6 text-muted">用于 JMeter 和用例生成的 OpenAI 兼容模型配置。</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="primary-action px-4 py-2 text-sm"
          >
            <Plus className="h-4 w-4" />
            添加模型
          </button>
        </div>

        {models.length === 0 ? (
          <div className="relative z-[1] rounded-2xl border border-dashed border-slate-300/80 bg-white/58 py-14 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(37,99,235,0.08)] text-accent">
              <Edit3 className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-fg">暂未配置任何模型</p>
            <p className="mt-1 text-xs text-muted">点击上方“添加模型”开始配置</p>
          </div>
        ) : (
          <div className="relative z-[1] space-y-3">
            {models.map((model) => (
              <div
                key={model.name}
                className={`motion-card flex items-center justify-between rounded-2xl p-4 ${
                  activeModel === model.name
                    ? 'border-[rgba(37,99,235,0.34)] bg-[rgba(37,99,235,0.04)]'
                    : ''
                }`}
              >
                <div className="relative z-[1] flex min-w-0 items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    activeModel === model.name
                      ? 'bg-accent text-white'
                      : 'bg-[rgba(37,99,235,0.08)] text-accent'
                  }`}>
                    {activeModel === model.name ? <Check className="h-5 w-5" /> : <Edit3 className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-fg">{model.name}</div>
                    <div className="truncate text-xs text-muted">
                      {model.modelId} · {model.baseUrl}
                    </div>
                  </div>
                </div>
                <div className="relative z-[1] flex shrink-0 items-center gap-2">
                  {activeModel === model.name && (
                    <span className="rounded-full bg-[rgba(37,99,235,0.08)] px-2 py-0.5 text-[10px] font-medium text-accent">
                      当前使用
                    </span>
                  )}
                  <button
                    onClick={handleDelete}
                    className="icon-action h-8 w-8 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="relative z-[1] mt-5 border-t border-slate-200/70 pt-4 text-xs leading-5 text-muted">
          配置信息仅保存在浏览器本地 (localStorage)，不会上传到任何服务器
        </p>
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
