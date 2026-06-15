import { useState, useEffect } from 'react'
import { HTTP_METHODS, BODY_TYPES, type HttpMethod, type BodyType, type ParamItem } from '../../data/http-request-types'
import { JsonEditor } from '../editors/JsonEditor'
import { ParamTable } from '../editors/ParamTable'
import { CustomSelect } from '../ui/CustomSelect'
import { HeaderComboInput } from '../ui/HeaderComboInput'
import { HEADER_NAMES, getHeaderValuePresets } from '../../data/http-header-presets'
import { parseCurl } from '../../lib/curl-parser'
import { Code2, X } from 'lucide-react'

interface HttpRequestConfigProps {
  value: HttpRequestData
  onChange: (value: HttpRequestData) => void
}

export interface HttpRequestData {
  method: HttpMethod
  domain: string
  port: string
  protocol: string
  path: string
  bodyType: BodyType
  jsonBody: string
  formData: ParamItem[]
  queryParams: ParamItem[]
  xmlBody: string
  rawBody: string
  headers: Array<{ name: string; value: string }>
}

export function createDefaultHttpRequest(): HttpRequestData {
  return {
    method: 'GET',
    domain: '',
    port: '',
    protocol: 'https',
    path: '/',
    bodyType: 'none',
    jsonBody: '',
    formData: [],
    queryParams: [],
    xmlBody: '',
    rawBody: '',
    headers: [],
  }
}

const inputCls = 'field-control'
const labelCls = 'field-label text-xs'

export function HttpRequestConfig({ value, onChange }: HttpRequestConfigProps) {
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [jsonFormatError, setJsonFormatError] = useState<string | null>(null)
  const [curlOpen, setCurlOpen] = useState(false)
  const [curlText, setCurlText] = useState('')
  const [curlError, setCurlError] = useState<string | null>(null)

  const update = (field: keyof HttpRequestData, val: unknown) => {
    onChange({ ...value, [field]: val })
  }

  useEffect(() => {
    const methodConfig = HTTP_METHODS.find((m) => m.method === value.method)
    if (methodConfig && methodConfig.defaultBodyType !== value.bodyType) {
      const needsBody = ['POST', 'PUT', 'PATCH', 'PROPFIND', 'PROPPATCH', 'LOCK', 'REPORT', 'MKCALENDAR', 'SEARCH'].includes(value.method)
      if (!needsBody && value.bodyType !== 'none') {
        update('bodyType', 'none')
      } else if (needsBody && value.bodyType === 'none') {
        update('bodyType', methodConfig.defaultBodyType)
      }
    }
  }, [value.method])

  useEffect(() => {
    if (value.bodyType === 'json' && value.jsonBody.trim()) {
      try {
        JSON.parse(value.jsonBody)
        setJsonError(null)
      } catch (e) {
        setJsonError((e as Error).message)
      }
    } else {
      setJsonError(null)
    }
  }, [value.bodyType, value.jsonBody])

  const needsBody = value.bodyType !== 'none'

  return (
    <div className="space-y-5">
      {/* Request Line */}
      <div className="surface-panel rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">请求行</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setCurlOpen((v) => !v)
              setCurlError(null)
            }}
            className={`secondary-action px-2.5 py-1 text-[11px] ${curlOpen ? '!border-accent !text-accent' : ''}`}
          >
            <Code2 className="h-3.5 w-3.5" />
            {curlOpen ? '关闭' : '识别 curl'}
          </button>
        </div>

        {/* Curl import panel */}
        {curlOpen && (
          <div className="relative z-[1] mb-4 animate-fade-up rounded-xl border border-[oklch(0.92_0.008_260/0.8)] bg-[oklch(0.985_0.003_260/0.65)] p-3">
            <textarea
              value={curlText}
              onChange={(e) => {
                setCurlText(e.target.value)
                setCurlError(null)
              }}
              placeholder={'curl -X POST https://api.example.com/v1/users \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer token123" \\\n  -d \'{"name":"test","email":"test@example.com"}\''}
              rows={5}
              className="field-control font-mono text-[12px] !bg-white"
              spellCheck={false}
            />
            {curlError && (
              <p className="mt-2 text-[11px] text-danger">{curlError}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCurlError(null)
                  if (!curlText.trim()) {
                    setCurlError('请粘贴 curl 命令')
                    return
                  }
                  try {
                    const result = parseCurl(curlText)
                    onChange({
                      ...value,
                      method: result.method,
                      protocol: result.protocol,
                      domain: result.domain,
                      port: result.port,
                      path: result.path,
                      headers: result.headers,
                      bodyType: result.bodyType,
                      queryParams: result.queryParams,
                      jsonBody: result.bodyType === 'json' ? result.bodyData : value.jsonBody,
                      xmlBody: result.bodyType === 'xml' ? result.bodyData : value.xmlBody,
                      rawBody: result.bodyType === 'raw' ? result.bodyData : value.rawBody,
                      formData: result.bodyType === 'form'
                        ? result.bodyData.split('&').map((pair) => {
                            const eq = pair.indexOf('=')
                            return {
                              key: eq > -1 ? decodeURIComponent(pair.slice(0, eq)) : pair,
                              value: eq > -1 ? decodeURIComponent(pair.slice(eq + 1)) : '',
                              enabled: true,
                              encode: true,
                            }
                          })
                        : value.formData,
                    })
                    setCurlOpen(false)
                    setCurlText('')
                    setCurlError(null)
                  } catch (err) {
                    setCurlError(err instanceof Error ? err.message : '解析失败')
                  }
                }}
                className="primary-action px-3 py-1.5 text-[12px]"
              >
                解析并填入
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurlOpen(false)
                  setCurlText('')
                  setCurlError(null)
                }}
                className="secondary-action px-3 py-1.5 text-[12px]"
              >
                <X className="h-3.5 w-3.5" />
                取消
              </button>
            </div>
          </div>
        )}

        <div className="relative z-[1] grid grid-cols-[100px_70px_1fr_70px_1fr] items-end gap-2.5 max-lg:grid-cols-[90px_65px_1fr_65px_1fr] max-sm:grid-cols-2 max-sm:gap-3">
          <div>
            <label className={labelCls}>方法</label>
            <CustomSelect
              value={value.method}
              onChange={(v) => update('method', v)}
              options={HTTP_METHODS.map((m) => ({ value: m.method, label: m.label }))}
            />
          </div>
          <div>
            <label className={labelCls}>协议</label>
            <CustomSelect
              value={value.protocol}
              onChange={(v) => update('protocol', v)}
              options={[
                { value: 'https', label: 'HTTPS' },
                { value: 'http', label: 'HTTP' },
              ]}
            />
          </div>
          <div>
            <label className={labelCls}>域名 <span className="text-[#dc2626]">*</span></label>
            <input type="text" value={value.domain} onChange={(e) => update('domain', e.target.value)} placeholder="api.example.com" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>端口</label>
            <input type="number" value={value.port} onChange={(e) => update('port', e.target.value)} placeholder="443" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>路径 <span className="text-[#dc2626]">*</span></label>
            <input type="text" value={value.path} onChange={(e) => update('path', e.target.value)} placeholder="/api/users" className={inputCls} />
          </div>
        </div>
      </div>

      {/* Body Type */}
      {['POST', 'PUT', 'PATCH', 'PROPFIND', 'PROPPATCH', 'LOCK', 'REPORT', 'MKCALENDAR', 'SEARCH'].includes(value.method) && (
        <div className="surface-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">请求体</span>
          </div>
          <div className="relative z-[1] flex flex-wrap gap-2">
            {BODY_TYPES.filter((bt) => bt.type !== 'none').map((bt) => (
              <button
                key={bt.type}
                type="button"
                onClick={() => update('bodyType', bt.type)}
                className={`rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-all duration-150 ease-out ${
                  value.bodyType === bt.type
                    ? 'bg-accent text-white shadow-[0_12px_24px_-18px_rgba(37,99,235,0.8)]'
                    : 'border border-slate-200 bg-white text-muted hover:border-accent hover:text-accent'
                }`}
              >
                {bt.label}
              </button>
            ))}
          </div>
          {value.bodyType && (
            <p className="relative z-[1] mt-2 text-[11px] text-muted">
              Content-Type: {BODY_TYPES.find((bt) => bt.type === value.bodyType)?.contentType || '无'}
            </p>
          )}
        </div>
      )}

      {/* Query Params — 仅无 body 的方法显示 */}
      {!needsBody && (
        <div className="surface-panel rounded-2xl p-4">
          <ParamTable
            label="Query 参数"
            value={value.queryParams}
            onChange={(v) => update('queryParams', v)}
            showEncode={true}
          />
        </div>
      )}

      {/* Body Content */}
      {needsBody && (
        <div className="surface-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">请求体内容</span>
          </div>

          {value.bodyType === 'json' && (
            <JsonEditor
              value={value.jsonBody}
              onChange={(v) => update('jsonBody', v)}
              placeholder='{"key": "value"}'
              minHeight="280px"
              error={jsonFormatError || (jsonError ? `JSON 格式错误: ${jsonError}` : null)}
              toolbar={
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setJsonFormatError(null)
                      if (!value.jsonBody.trim()) return
                      try {
                        update('jsonBody', JSON.stringify(JSON.parse(value.jsonBody), null, 2))
                      } catch (e) {
                        setJsonFormatError(`格式化失败: ${(e as Error).message}`)
                      }
                    }}
                    className="rounded-md bg-white/80 px-2 py-0.5 text-[11px] font-medium text-muted shadow-sm ring-1 ring-slate-200 transition-all hover:text-accent hover:ring-accent"
                  >
                    格式化
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setJsonFormatError(null)
                      if (!value.jsonBody.trim()) return
                      try {
                        update('jsonBody', JSON.stringify(JSON.parse(value.jsonBody)))
                      } catch (e) {
                        setJsonFormatError(`压缩失败: ${(e as Error).message}`)
                      }
                    }}
                    className="rounded-md bg-white/80 px-2 py-0.5 text-[11px] font-medium text-muted shadow-sm ring-1 ring-slate-200 transition-all hover:text-accent hover:ring-accent"
                  >
                    压缩
                  </button>
                </>
              }
            />
          )}

          {value.bodyType === 'form' && (
            <ParamTable label="Form 参数" value={value.formData} onChange={(v) => update('formData', v)} showEncode={true} />
          )}

          {value.bodyType === 'multipart' && (
            <div className="space-y-3">
              <ParamTable label="表单字段" value={value.formData} onChange={(v) => update('formData', v)} showEncode={false} />
              <div>
                <label className={labelCls}>文件上传（每行一个文件路径）</label>
                <textarea value={value.rawBody} onChange={(e) => update('rawBody', e.target.value)} placeholder="/path/to/file1.jpg&#10;/path/to/file2.pdf" rows={3} className={inputCls} />
              </div>
            </div>
          )}

          {value.bodyType === 'xml' && (
            <JsonEditor value={value.xmlBody} onChange={(v) => update('xmlBody', v)} placeholder='<root><item>value</item></root>' />
          )}

          {value.bodyType === 'raw' && (
            <textarea value={value.rawBody} onChange={(e) => update('rawBody', e.target.value)} placeholder="输入原始文本内容" rows={6} className={`${inputCls} font-mono`} />
          )}
        </div>
      )}

      {/* Headers */}
      <div className="surface-panel rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">请求头</span>
          </div>
          <span className="text-[10px] text-muted">支持手动输入或从预设中选择</span>
        </div>
        <div className="relative z-[1] space-y-2">
          {value.headers.map((header, index) => {
            const valueSuggestions = getHeaderValuePresets(header.name)

            const handleNameChange = (name: string) => {
              const u = [...value.headers]
              const presets = getHeaderValuePresets(name)
              // key 清空时同步清空 value；key 有预设值时自动填入第一个建议值
              const autoValue = name.trim()
                ? presets.length > 0
                  ? presets[0]
                  : u[index].value
                : ''
              u[index] = { name, value: autoValue }
              update('headers', u)
            }

            const handleValueChange = (val: string) => {
              const u = [...value.headers]
              u[index] = { ...u[index], value: val }
              update('headers', u)
            }

            const handleRemove = () => {
              update('headers', value.headers.filter((_, i) => i !== index))
            }

            return (
              <div key={index} className="flex items-center gap-2">
                <HeaderComboInput
                  value={header.name}
                  onChange={handleNameChange}
                  placeholder="Header 名称"
                  suggestions={HEADER_NAMES}
                />
                <HeaderComboInput
                  value={header.value}
                  onChange={handleValueChange}
                  placeholder="Header 值"
                  suggestions={valueSuggestions}
                />
                <button
                  type="button"
                  onClick={handleRemove}
                  className="icon-action h-10 w-10 shrink-0 hover:text-[#dc2626]"
                >
                  ×
                </button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => update('headers', [...value.headers, { name: '', value: '' }])}
            className="secondary-action mt-1 px-3 py-1.5 text-[12px]"
          >
            + 添加请求头
          </button>
        </div>
      </div>
    </div>
  )
}
