import { useState } from 'react'
import { X, Save } from 'lucide-react'

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

  return (
    <div className="modal-backdrop">
      <div className="modal-panel w-full max-w-md rounded-[26px] p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">配置 AI 模型</h3>
          <button
            onClick={onClose}
            className="icon-action h-8 w-8"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="field-label">
              模型名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="我的 GPT-4"
              className="field-control"
            />
          </div>
          <div>
            <label className="field-label">
              API Base URL <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.baseUrl}
              onChange={(e) => handleChange('baseUrl', e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="field-control"
            />
          </div>
          <div>
            <label className="field-label">
              API Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => handleChange('apiKey', e.target.value)}
              placeholder="sk-..."
              className="field-control"
            />
          </div>
          <div>
            <label className="field-label">
              模型 ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.modelId}
              onChange={(e) => handleChange('modelId', e.target.value)}
              placeholder="gpt-4o"
              className="field-control"
            />
          </div>
          <div>
            <label className="field-label">Temperature</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={form.temperature}
              onChange={(e) => handleChange('temperature', Number(e.target.value))}
              className="field-control"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="secondary-action px-4 py-2 text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="primary-action px-4 py-2 text-sm"
          >
            <Save className="h-4 w-4" />
            保存配置
          </button>
        </div>

        <p className="helper-text">
          配置信息仅保存在浏览器本地，不会上传到任何服务器
        </p>
      </div>
    </div>
  )
}
