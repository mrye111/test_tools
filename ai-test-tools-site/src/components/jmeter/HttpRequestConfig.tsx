import { useState, useEffect } from 'react'
import { HTTP_METHODS, BODY_TYPES, type HttpMethod, type BodyType, type ParamItem } from '../../data/http-request-types'
import { JsonEditor } from '../editors/JsonEditor'
import { ParamTable } from '../editors/ParamTable'
import { CustomSelect } from '../ui/CustomSelect'

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
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">请求行</span>
        </div>
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

      {/* Query Params */}
      <div className="surface-panel rounded-2xl p-4">
        <ParamTable
          label="Query 参数"
          value={value.queryParams}
          onChange={(v) => update('queryParams', v)}
          showEncode={true}
        />
      </div>

      {/* Body Content */}
      {needsBody && (
        <div className="surface-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">请求体内容</span>
          </div>

          {value.bodyType === 'json' && (
            <div>
              <JsonEditor value={value.jsonBody} onChange={(v) => update('jsonBody', v)} placeholder='{"key": "value"}' />
              {jsonError && (
                <p className="mt-1.5 text-[11px] text-[#dc2626]">JSON 格式错误: {jsonError}</p>
              )}
              <div className="mt-2 flex gap-1.5">
                <button type="button" onClick={() => { try { update('jsonBody', JSON.stringify(JSON.parse(value.jsonBody), null, 2)) } catch {} }} className="secondary-action px-2.5 py-1 text-[11px]">格式化</button>
                <button type="button" onClick={() => { try { update('jsonBody', JSON.stringify(JSON.parse(value.jsonBody))) } catch {} }} className="secondary-action px-2.5 py-1 text-[11px]">压缩</button>
              </div>
            </div>
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
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">请求头</span>
        </div>
        <div className="relative z-[1] space-y-2">
          {value.headers.map((header, index) => (
            <div key={index} className="flex items-center gap-2">
              <input type="text" value={header.name} onChange={(e) => { const u = [...value.headers]; u[index] = { ...u[index], name: e.target.value }; update('headers', u) }} placeholder="Header-Name" className={`${inputCls} flex-1`} />
              <input type="text" value={header.value} onChange={(e) => { const u = [...value.headers]; u[index] = { ...u[index], value: e.target.value }; update('headers', u) }} placeholder="Header-Value" className={`${inputCls} flex-1`} />
              <button type="button" onClick={() => update('headers', value.headers.filter((_, i) => i !== index))} className="icon-action h-10 w-10 shrink-0 hover:text-[#dc2626]">×</button>
            </div>
          ))}
          <button type="button" onClick={() => update('headers', [...value.headers, { name: '', value: '' }])} className="secondary-action mt-1 px-3 py-1.5 text-[12px]">添加请求头</button>
        </div>
      </div>
    </div>
  )
}
