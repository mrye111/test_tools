import { useState } from 'react'
import { X, Save, Key, Globe, Tag, Thermometer, Cpu } from 'lucide-react'

interface Props {
  onClose: () => void
  onSave: () => void
}

export function ModelConfigModal({ onClose, onSave }: Props) {
  const [form, setForm] = useState(() => {
    const saved = localStorage.getItem('nexuskit_model_config')
    if (saved) {
      try { return JSON.parse(saved) } catch {}
    }
    return {
      name: '',
      baseUrl: '',
      apiKey: '',
      modelId: '',
      temperature: 0.2,
    }
  })

  const handleChange = (key: string, value: string | number) => {
    setForm((prev: Record<string, unknown>) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    if (!form.name || !form.baseUrl || !form.apiKey || !form.modelId) {
      alert('请填写所有必填字段')
      return
    }
    localStorage.setItem('nexuskit_model_config', JSON.stringify(form))
    onSave()
  }

  const fields = [
    {
      key: 'name',
      label: '模型名称',
      placeholder: '我的 GPT-4',
      icon: Tag,
      type: 'text',
      required: true,
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      placeholder: 'https://api.openai.com/v1',
      icon: Globe,
      type: 'text',
      required: true,
    },
    {
      key: 'apiKey',
      label: 'API Key',
      placeholder: 'sk-...',
      icon: Key,
      type: 'password',
      required: true,
    },
    {
      key: 'modelId',
      label: '模型 ID',
      placeholder: 'gpt-4o',
      icon: Cpu,
      type: 'text',
      required: true,
    },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel w-full max-w-md rounded-[28px] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">
              配置 AI 模型
            </h3>
            <p className="mt-1 text-xs text-muted">
              OpenAI 兼容格式，支持国内外主流模型
            </p>
          </div>
          <button
            onClick={onClose}
            className="icon-action h-8 w-8 rounded-xl"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {fields.map((field, i) => {
            const Icon = field.icon
            return (
              <div
                key={field.key}
                style={{ animationDelay: `${0.06 * (i + 1)}s` }}
                className="animate-fade-up"
              >
                <label className={`field-label ${field.required ? 'field-label-required' : ''}`}>
                  {field.label}
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted">
                    <Icon className="h-4 w-4" />
                  </div>
                  <input
                    type={field.type}
                    value={String(form[field.key as keyof typeof form] ?? '')}
                    onChange={(e) => handleChange(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                    placeholder={field.placeholder}
                    className="field-control pl-10"
                  />
                </div>
              </div>
            )
          })}

          {/* Temperature */}
          <div style={{ animationDelay: '0.3s' }} className="animate-fade-up">
            <label className="field-label">
              <span className="flex items-center gap-1.5">
                <Thermometer className="h-3.5 w-3.5 text-muted" />
                Temperature
              </span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={form.temperature}
                onChange={(e) => handleChange('temperature', Number(e.target.value))}
                className="h-2 flex-1 appearance-none rounded-full bg-[oklch(0.9_0.01_260)] accent-accent"
              />
              <span className="w-10 text-center font-mono text-sm tabular-nums text-accent">
                {form.temperature.toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div
          className="mt-6 flex animate-fade-up justify-end gap-3"
          style={{ animationDelay: '0.36s' }}
        >
          <button
            onClick={onClose}
            className="secondary-action px-5 py-2.5 text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="primary-action px-5 py-2.5 text-sm"
          >
            <Save className="h-4 w-4" />
            保存配置
          </button>
        </div>

        {/* Footer note */}
        <div className="mt-4 rounded-xl border border-[oklch(0.92_0.008_260)] bg-[oklch(0.985_0.003_260/0.5)] px-4 py-3">
          <p className="text-[11px] leading-[1.55] text-muted">
            配置信息仅保存在浏览器本地 (localStorage)，不会上传到任何服务器
          </p>
        </div>
      </div>
    </div>
  )
}
