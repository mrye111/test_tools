import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2, Settings, Sparkles } from 'lucide-react'
import { ModelConfigModal } from './ModelConfigModal'
import { downloadGeneratedJmx, generateJmeterWithAi, getJmeterAiConfig, type AiConfigStatus, type AiGenerateResponse, type JmeterTool } from '../../lib/jmeter-api'
import { createGeneratedPlanTarget, type GeneratedPlanResult } from '../../lib/jmeter-builders'
import { GeneratedPlanResult as GeneratedPlanResultPanel } from './GeneratedPlanResult'

interface Props {
  tools: JmeterTool[]
  loading: boolean
  backendError: string | null
}

interface ModelConfig {
  name: string
  baseUrl: string
  apiKey: string
  modelId: string
  temperature: number
}

type AiGenerationEvent = {
  type: 'status' | 'assistant' | 'tool' | 'error' | 'done'
  title: string
  content: string
}

const EXAMPLES = [
  '测试百度首页的并发访问性能，100 个用户同时访问，持续 30 秒，校验响应状态码为 200，并生成聚合报告。',
  '对 https://api.example.com/login 发起 POST JSON 请求，50 个线程、循环 20 次，请求体包含用户名和密码，并断言返回状态码 200。',
  '对内部 LDAP 目录做查询性能测试，20 个并发，搜索基是 dc=example,dc=com，过滤条件是 (uid=testuser)。',
]

function eventColor(type: AiGenerationEvent['type']) {
  if (type === 'error') return 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
  if (type === 'done') return 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
  if (type === 'tool') return 'border-[#dbeafe] bg-[#eff6ff] text-[#1d4ed8]'
  if (type === 'assistant') return 'border-[#dbeafe] bg-[#f8fbff] text-[#1d4ed8]'
  return 'border-slate-200 bg-slate-50 text-[#334155]'
}

function loadModelConfig() {
  const saved = localStorage.getItem('nexuskit_model_config')
  if (!saved) return null

  try {
    const parsed = JSON.parse(saved) as Partial<ModelConfig>
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.modelId) return null
    return {
      name: parsed.name || '默认模型',
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
      modelId: parsed.modelId,
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.2,
    } satisfies ModelConfig
  } catch {
    return null
  }
}

function toGeneratedPlanResult(response: AiGenerateResponse): GeneratedPlanResult {
  return {
    planName: response.planName,
    savedPath: response.outputPath,
    downloadName: response.outputPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'ai-generated.jmx',
    saveMessage: response.saveResult,
    validation: response.validation,
    tree: response.tree,
    steps: response.toolCalls.map((call) => ({
      tool: call.name,
      text: call.result,
    })),
  }
}

function toAiEvents(response: AiGenerateResponse): AiGenerationEvent[] {
  const events: AiGenerationEvent[] = [
    {
      type: 'assistant',
      title: 'AI 总结',
      content: response.summary,
    },
  ]

  for (const call of response.toolCalls) {
    events.push({
      type: 'tool',
      title: `调用 ${call.name}`,
      content: `参数:\n${JSON.stringify(call.arguments, null, 2)}\n\n结果:\n${call.result}`,
    })
  }

  events.push({
    type: 'tool',
    title: '校验结果',
    content: response.validation,
  })
  events.push({
    type: 'tool',
    title: '保存结果',
    content: response.saveResult,
  })
  events.push({
    type: 'done',
    title: '生成完成',
    content: response.outputPath,
  })
  return events
}

export function AIGenerateTab({ tools, loading, backendError }: Props) {
  const [description, setDescription] = useState('')
  const [running, setRunning] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null)
  const [aiConfigStatus, setAiConfigStatus] = useState<AiConfigStatus | null>(null)
  const [events, setEvents] = useState<AiGenerationEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [result, setResult] = useState<GeneratedPlanResult | null>(null)
  const [downloading, setDownloading] = useState(false)
  const eventsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setModelConfig(loadModelConfig())
    void getJmeterAiConfig()
      .then(setAiConfigStatus)
      .catch(() => setAiConfigStatus(null))
  }, [])

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const appendEvent = (event: AiGenerationEvent) => {
    setEvents((prev) => [...prev, event])
  }

  const handleGenerate = async () => {
    if (!description.trim()) return
    if (!modelConfig) {
      setShowConfig(true)
      return
    }

    setRunning(true)
    setError(null)
    setSummary('')
    setNotes([])
    setResult(null)
    setEvents([])

    try {
      const outputTarget = createGeneratedPlanTarget('ai-generated')
      appendEvent({
        type: 'status',
        title: '请求已提交',
        content: '前端正在把自然语言需求和模型配置发送给后端 AI 生成接口。',
      })
      const generated = await generateJmeterWithAi({
        prompt: description,
        output_path: outputTarget.filename,
        ai_config: {
          base_url: modelConfig.baseUrl,
          api_key: modelConfig.apiKey,
          model: modelConfig.modelId,
        },
        temperature: modelConfig.temperature,
      })
      setSummary(generated.summary)
      setNotes(generated.notes ?? [])
      setResult(toGeneratedPlanResult(generated))
      setEvents(toAiEvents(generated))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 生成失败'
      setError(message)
      appendEvent({
        type: 'error',
        title: '生成失败',
        content: message,
      })
    } finally {
      setRunning(false)
    }
  }

  const handleDownload = async () => {
    if (!result) return
    setDownloading(true)
    setError(null)
    try {
      await downloadGeneratedJmx(result.savedPath, result.downloadName)
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载 JMX 文件失败')
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
            用自然语言描述测试目标，前端会把需求和模型配置发送给后端 `/ai/generate-jmeter`，由后端完成 AI 规划、工具调用与 `.jmx` 保存。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/settings"
            className="secondary-action px-4 py-2 text-sm no-underline"
          >
            <Settings className="h-4 w-4" />
            模型设置
          </Link>
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
      </div>

      <div className={`px-4 py-3 ${
        modelConfig
          ? 'status-panel'
          : 'status-panel danger-panel'
      }`}>
        {modelConfig ? (
          <div className="relative z-[1] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-[#1d4ed8]">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-semibold">当前模型已配置</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#475569]">
              <span>名称: {modelConfig.name}</span>
              <span>模型: {modelConfig.modelId}</span>
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
                请先配置一个 OpenAI 兼容模型接口，前端才能把自然语言请求发送给后端 AI 生成接口。
              </div>
            </div>
          </div>
        )}
      </div>

      {backendError && (
        <div className="status-panel danger-panel px-4 py-3 text-sm text-[#b91c1c]">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">JMeter 后端不可用</div>
              <div className="mt-1 text-xs leading-5">{backendError}</div>
            </div>
          </div>
        </div>
      )}

      <div className="surface-panel rounded-2xl p-4">
        <div className="relative z-[1]">
        <label className="field-label">测试需求描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="例如：压测登录接口，POST 到 https://api.example.com/login，100 个并发，循环 10 次，请求体是 JSON，断言状态码 200，输出聚合报告。"
          rows={6}
          className="field-control px-4 py-3"
        />

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
            disabled={running || !description.trim() || loading || !!backendError || tools.length === 0}
            className="primary-action px-6 py-2.5 text-sm disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {running ? 'AI 生成中...' : '开始 AI 生成'}
          </button>
          <span className="text-xs text-muted">
            后端会自动调用工具，并在完成后保存到 `server/generated/`
          </span>
        </div>
        </div>
      </div>

      {(events.length > 0 || error || summary) && (
        <div className="surface-panel rounded-2xl p-4">
          <div className="relative z-[1] mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted">执行过程</div>
          <div className="max-h-[360px] space-y-3 overflow-y-auto">
            {events.map((event, index) => (
              <div key={`${event.title}-${index}`} className={`relative z-[1] rounded-xl border px-3 py-2 ${eventColor(event.type)}`}>
                <div className="text-xs font-semibold uppercase tracking-wider">{event.title}</div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-6">{event.content}</pre>
              </div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        </div>
      )}

      {summary && (
        <div className="status-panel p-4">
          <div className="relative z-[1] mb-2 text-xs font-semibold uppercase tracking-wider text-[#1d4ed8]">AI 总结</div>
          <p className="relative z-[1] whitespace-pre-wrap break-words text-sm leading-6 text-[#1e3a8a]">{summary}</p>
          {notes.length > 0 && (
            <div className="relative z-[1] mt-3 space-y-1">
              {notes.map((note, index) => (
                <div key={`${note}-${index}`} className="text-xs leading-5 text-[#1d4ed8]">
                  {index + 1}. {note}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <GeneratedPlanResultPanel
        result={result}
        error={error}
        downloading={downloading}
        onDownload={handleDownload}
      />

      {showConfig && (
        <ModelConfigModal
          onClose={() => setShowConfig(false)}
          onSave={() => {
            setModelConfig(loadModelConfig())
            setShowConfig(false)
          }}
        />
      )}
    </div>
  )
}
