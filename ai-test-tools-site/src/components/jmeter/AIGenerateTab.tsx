import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Settings, Sparkles } from 'lucide-react'
import { ModelConfigModal } from './ModelConfigModal'
import { downloadGeneratedJmx, getJmeterAiConfig, getPrimaryModelLabel, type AiConfigStatus, type JmeterTool } from '../../lib/jmeter-api'
import { normalizeErrorMessage } from '../../lib/app-error'
import { AiGenerationExecutionModal } from './AiGenerationExecutionModal'
import { useAiGenerationPlayback } from '../../hooks/useAiGenerationPlayback'
import { loadStoredModelConfig, upsertStoredModelConfig } from '../../lib/model-config-store'
import type { StoredModelConfig } from '../../shared/api-types'

interface Props {
  tools: JmeterTool[]
  loading: boolean
  backendError: string | null
}

const EXAMPLES = [
  '测试百度首页的并发访问性能，100 个用户同时访问，持续 30 秒，校验响应状态码为 200，并生成聚合报告。',
  '对 https://api.example.com/login 发起 POST JSON 请求，50 个线程、循环 20 次，请求体包含用户名和密码，并断言返回状态码 200。',
  '对内部 LDAP 目录做查询性能测试，20 个并发，搜索基是 dc=example,dc=com，过滤条件是 (uid=testuser)。',
]

export function AIGenerateTab({ tools, loading, backendError }: Props) {
  const [description, setDescription] = useState('')
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [modelConfig, setModelConfig] = useState<StoredModelConfig | null>(null)
  const [aiConfigStatus, setAiConfigStatus] = useState<AiConfigStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [showExecutionModal, setShowExecutionModal] = useState(false)
  const playback = useAiGenerationPlayback()

  useEffect(() => {
    setModelConfig(loadStoredModelConfig())
    void getJmeterAiConfig()
      .then(setAiConfigStatus)
      .catch(() => setAiConfigStatus(null))
  }, [])

  const handleGenerate = async () => {
    if (!description.trim()) {
      setDescriptionError('请输入测试需求描述')
      return
    }
    if (!modelConfig) {
      setShowConfig(true)
      return
    }

    setShowExecutionModal(true)
    await playback.start({ prompt: description, modelConfig })
  }

  const handleDownload = async () => {
    if (!playback.result) return
    setDownloading(true)
    playback.setError(null)
    try {
      await downloadGeneratedJmx(playback.result.savedPath, playback.result.downloadName)
    } catch (err) {
      playback.setError(normalizeErrorMessage(err, { fallbackMessage: '下载 JMX 文件失败，请稍后重试。' }))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mb-2 font-display text-xl font-semibold tracking-[-0.035em] text-fg">AI 自然语言生成</h2>
          <p className="text-sm leading-6 text-muted">
            用自然语言描述你想怎么测试这个功能，AI 会帮你生成对应的 JMeter 测试计划。
          </p>
        </div>

        {!modelConfig && (
          <button
            type="button"
            onClick={() => setShowConfig(true)}
            className="primary-action px-4 py-2 text-sm"
          >
            <Settings className="h-4 w-4" />
            快速配置模型
          </button>
        )}
      </div>

      <div className={`px-4 py-3 ${
        modelConfig
          ? 'status-panel'
          : 'status-panel danger-panel'
      }`}>
        {modelConfig ? (
          <div className="relative z-[1] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-accent">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-semibold">当前模型已配置</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#475569]">
              <span>名称: {modelConfig.name}</span>
              <span>模型: {getPrimaryModelLabel(modelConfig)}</span>
              <span>格式: {modelConfig.apiFormat}</span>
              <span>工具数: {tools.length}</span>
              {aiConfigStatus && <span>模式: {aiConfigStatus.mode}</span>}
            </div>
          </div>
        ) : (
          <div className="relative z-[1] flex items-start gap-2 text-sm text-[#92400e]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">尚未配置 AI 模型</div>
              <div className="mt-1 text-xs leading-5">
                请先配置一个 AI 模型，配置完成后就可以直接用自然语言生成测试计划。
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="surface-panel rounded-2xl p-4">
        <div className="relative z-[1]">
        <label className="field-label">测试需求描述</label>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            if (descriptionError) setDescriptionError(null)
          }}
          placeholder="例如：测试登录功能，100 个用户同时登录，持续 5 分钟，看看响应时间和成功率。"
          rows={6}
          className={`field-control px-4 py-3 ${descriptionError ? 'field-control-error' : ''}`}
        />
        {descriptionError && <p className="field-error">{descriptionError}</p>}

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setDescription(example)}
              className="secondary-action rounded-full px-3 py-1.5 text-xs"
            >
              使用示例
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={playback.running || loading || !!backendError || tools.length === 0}
            className="primary-action px-6 py-2.5 text-sm disabled:opacity-50"
          >
            {playback.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {playback.running ? 'AI 生成中...' : '开始 AI 生成'}
          </button>
          <span className="text-xs text-muted">
            生成完成后可以直接下载 `.jmx` 文件
          </span>
        </div>
        </div>
      </div>

      {showConfig && (
        <ModelConfigModal
          onClose={() => setShowConfig(false)}
          onSave={(config) => {
            upsertStoredModelConfig(config)
            setModelConfig(loadStoredModelConfig())
            setShowConfig(false)
          }}
        />
      )}

      <AiGenerationExecutionModal
        open={showExecutionModal}
        playback={playback}
        downloading={downloading}
        onClose={() => setShowExecutionModal(false)}
        onDownload={handleDownload}
      />
    </div>
  )
}
