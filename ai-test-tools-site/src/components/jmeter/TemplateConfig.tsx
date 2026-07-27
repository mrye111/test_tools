import { useState } from 'react'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import { templateParamCards, type JmeterTemplate, type TemplateParam } from '../../data/jmeter-templates'
import { HttpRequestConfig } from './HttpRequestConfig'
import { createDefaultHttpRequest, type HttpRequestData } from '../../lib/jmeter-types'
import { CustomSelect } from '../ui/CustomSelect'
import { useErrorDialog } from '../ui/ErrorDialogProvider'
import { downloadGeneratedJmx } from '../../lib/jmeter-api'
import { type GeneratedPlanResult, generateTemplatePlan } from '../../lib/jmeter-builders'
import { GeneratedPlanResult as GeneratedPlanResultPanel } from './GeneratedPlanResult'

interface Props {
  template: JmeterTemplate
  onBack: () => void
}

const inputCls = 'field-control'
const labelCls = 'field-label text-xs'
const COMMON_PARAM_KEYS = ['threads', 'ramp_up', 'loops', 'aggregate_report', 'assertion_code']

function buildTemplateParamCards(template: JmeterTemplate) {
  const paramMap = new Map(template.params.map((param) => [param.key, param]))
  const configuredCards = templateParamCards[template.id]

  if (configuredCards) {
    return configuredCards
      .map((card) => ({
        ...card,
        params: card.keys.map((key) => paramMap.get(key)).filter((param): param is TemplateParam => Boolean(param)),
      }))
      .filter((card) => card.params.length > 0)
  }

  const params = template.params.filter((param) => !COMMON_PARAM_KEYS.includes(param.key))
  if (params.length === 0) return []
  return [{ title: '模板参数', description: '配置当前模板需要的业务参数。', params }]
}

export function TemplateConfig({ template, onBack }: Props) {
  const { showError } = useErrorDialog()
  const [values, setValues] = useState<Record<string, string | number>>(() => {
    const init: Record<string, string | number> = {}
    template.params.forEach((p) => {
      if (p.default !== undefined) init[p.key] = p.default
    })
    return init
  })
  const [httpData, setHttpData] = useState<HttpRequestData>(createDefaultHttpRequest)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GeneratedPlanResult | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const handleChange = (key: string, value: string | number) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const paramCards = buildTemplateParamCards(template)

  const clearFieldError = (key: string) => {
    setFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const validateForm = () => {
    const nextErrors: Record<string, string> = {}

    if (template.id === 'http-stress') {
      if (!httpData.domain.trim()) nextErrors.domain = '请输入目标域名'
      if (!httpData.path.trim()) nextErrors.path = '请输入请求路径'
    }

    template.params
      .filter((param) => param.required)
      .forEach((param) => {
        const rawValue = values[param.key]
        if (rawValue == null || String(rawValue).trim() === '') {
          nextErrors[param.key] = `请输入${param.label}`
        }
      })

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const renderParamField = (param: TemplateParam) => (
    <div key={param.key} className={param.type === 'textarea' ? 'col-span-2 max-sm:col-span-1' : ''}>
      <label className={labelCls}>
        {param.label}
        {param.required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {param.type === 'text' && (
        <input
          type="text"
          value={values[param.key] ?? ''}
          onChange={(event) => handleChange(param.key, event.target.value)}
          placeholder={param.placeholder}
          className={`${inputCls} ${fieldErrors[param.key] ? 'field-control-error' : ''}`}
          aria-invalid={Boolean(fieldErrors[param.key])}
        />
      )}
      {param.type === 'number' && (
        <input
          type="number"
          value={values[param.key] ?? ''}
          onChange={(event) => handleChange(param.key, event.target.value === '' ? '' : Number(event.target.value))}
          placeholder={param.placeholder}
          className={`${inputCls} ${fieldErrors[param.key] ? 'field-control-error' : ''}`}
          aria-invalid={Boolean(fieldErrors[param.key])}
        />
      )}
      {param.type === 'select' && (
        <CustomSelect
          value={String(values[param.key] ?? param.default ?? '')}
          onChange={(value) => handleChange(param.key, value)}
          options={param.options?.map((option) => ({ value: String(option.value), label: option.label })) || []}
          className={fieldErrors[param.key] ? 'field-select-error' : ''}
        />
      )}
      {param.type === 'textarea' && (
        <textarea
          value={values[param.key] ?? ''}
          onChange={(event) => handleChange(param.key, event.target.value)}
          placeholder={param.placeholder}
          rows={5}
          className={`${inputCls} ${fieldErrors[param.key] ? 'field-control-error' : ''}`}
          aria-invalid={Boolean(fieldErrors[param.key])}
        />
      )}
      {fieldErrors[param.key] && <p className="field-error">{fieldErrors[param.key]}</p>}
      {param.description && <p className="helper-text">{param.description}</p>}
    </div>
  )

  const handleSubmit = async () => {
    if (!validateForm()) return
    setLoading(true)
    setError(null)
    try {
      const nextResult = await generateTemplatePlan({
        template,
        values,
        httpData,
      })
      setResult(nextResult)
    } catch (err) {
      setResult(null)
      showError(err, {
        title: '生成 JMX 失败',
        fallbackMessage: '生成 JMX 文件失败，请检查后端服务是否启动。',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!result) return
    setDownloading(true)
    setError(null)
    try {
      await downloadGeneratedJmx(result.savedPath, result.downloadName)
    } catch (err) {
      showError(err, {
        title: '下载失败',
        fallbackMessage: '下载 JMX 文件失败，请稍后重试。',
      })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="icon-action h-9 w-9">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="font-display text-lg font-semibold tracking-[-0.035em] text-fg">
            <span className="mr-2 rounded-lg bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent">{template.icon}</span>
            {template.name}
          </h2>
          <p className="text-xs leading-5 text-muted">{template.description}</p>
        </div>
      </div>

      {/* HTTP Request Config */}
      {template.id === 'http-stress' && (
        <HttpRequestConfig
          value={httpData}
          onChange={setHttpData}
          fieldErrors={{
            domain: fieldErrors.domain,
            path: fieldErrors.path,
          }}
          onFieldChange={(field) => clearFieldError(field)}
        />
      )}

      {/* Other template params */}
      {template.id !== 'http-stress' && paramCards.map((card) => (
        <div key={card.title} className="surface-panel rounded-2xl p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-accent" />
                <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">{card.title}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">{card.description}</p>
            </div>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
              {template.samplerType}
            </span>
          </div>
          <div className="relative z-[1] grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {card.params.map(renderParamField)}
          </div>
        </div>
      ))}

      {/* Common Params */}
      <div className="surface-panel rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">压测参数</span>
        </div>
        <div className="relative z-[1] grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          {template.params
            .filter((param) => COMMON_PARAM_KEYS.includes(param.key))
            .map(renderParamField)}
        </div>
      </div>

      <GeneratedPlanResultPanel
        result={result}
        error={error}
        downloading={downloading}
        onDownload={handleDownload}
      />

      {/* Submit */}
      <div className="sticky bottom-0 -mx-6 -mb-6 border-t border-border/80 bg-white/82 px-6 py-4 backdrop-blur-xl max-sm:-mx-4 max-sm:px-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] text-muted">模板: {template.samplerType}</span>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="primary-action px-5 py-2.5 text-[13px] disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {loading ? '生成中...' : '生成并保存 .jmx'}
          </button>
        </div>
      </div>
    </div>
  )
}
