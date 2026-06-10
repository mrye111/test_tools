import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Wrench } from 'lucide-react'
import { callJmeterTool, type JmeterTool, type JmeterToolSchema } from '../../lib/jmeter-api'

interface Props {
  tools: JmeterTool[]
  loading: boolean
  backendError: string | null
  onRefresh: () => void | Promise<void>
}

function createDraftValue(type?: string, fallback?: unknown) {
  if (fallback !== undefined) return fallback
  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'array') return []
  if (type === 'object') return {}
  return ''
}

function createSchemaDraft(schema: JmeterToolSchema) {
  const properties = schema.properties ?? {}
  const required = schema.required ?? []
  if (required.length === 0) return '{}'

  const draft = Object.fromEntries(
    required.map((name) => {
      const prop = properties[name]
      return [name, createDraftValue(prop?.type, prop?.default)]
    }),
  )

  return JSON.stringify(draft, null, 2)
}

function parseArgs(value: string) {
  if (!value.trim()) return {}

  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    throw new Error('参数必须是一个 JSON 对象')
  } catch (error) {
    throw new Error(`参数 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export function ToolWorkbenchTab({ tools, loading, backendError, onRefresh }: Props) {
  const [selectedToolName, setSelectedToolName] = useState('')
  const [argsText, setArgsText] = useState('{}')
  const [running, setRunning] = useState(false)
  const [resultText, setResultText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === selectedToolName) ?? null,
    [selectedToolName, tools],
  )

  useEffect(() => {
    if (tools.length === 0) return
    if (!tools.some((tool) => tool.name === selectedToolName)) {
      setSelectedToolName(tools[0].name)
    }
  }, [selectedToolName, tools])

  useEffect(() => {
    if (!selectedTool) return
    setArgsText(createSchemaDraft(selectedTool.inputSchema))
    setResultText('')
    setError(null)
  }, [selectedToolName])

  const schemaEntries = useMemo(
    () => Object.entries(selectedTool?.inputSchema.properties ?? {}),
    [selectedTool],
  )

  const requiredSet = useMemo(
    () => new Set(selectedTool?.inputSchema.required ?? []),
    [selectedTool],
  )

  const handleExecute = async () => {
    if (!selectedTool) return

    setRunning(true)
    setError(null)
    try {
      const args = parseArgs(argsText)
      const text = await callJmeterTool(selectedTool.name, args)
      setResultText(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : '工具调用失败')
      setResultText('')
    } finally {
      setRunning(false)
    }
  }

  const handleLoadTree = async () => {
    setRunning(true)
    setError(null)
    try {
      const text = await callJmeterTool('list_test_plan_tree')
      setResultText(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取测试计划树失败')
      setResultText('')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-2 font-display text-xl font-semibold tracking-[-0.035em] text-fg">后端工具工作台</h2>
        <p className="text-sm leading-6 text-muted">
          这里直接调用真实的 `/tools/:name` 接口，适合调试工具参数、补充低频能力，或查看当前内存态测试计划树。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading}
          className="secondary-action px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新工具列表
        </button>

        <button
          type="button"
          onClick={handleLoadTree}
          disabled={running}
          className="secondary-action px-4 py-2 text-sm disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
          读取当前测试计划树
        </button>
      </div>

      {backendError && (
        <div className="status-panel danger-panel px-4 py-3 text-sm text-[#b91c1c]">
          <div className="relative z-[1] flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{backendError}</span>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="surface-panel rounded-2xl p-4">
          <div className="relative z-[1]">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-muted">工具</label>
          <select
            value={selectedToolName}
            onChange={(e) => setSelectedToolName(e.target.value)}
            disabled={tools.length === 0}
            className="field-control"
          >
            {tools.map((tool) => (
              <option key={tool.name} value={tool.name}>
                {tool.name}
              </option>
            ))}
          </select>

          {selectedTool && (
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-sm font-semibold text-fg">{selectedTool.name}</div>
                <p className="mt-1 text-sm leading-6 text-muted">{selectedTool.description}</p>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted">参数说明</div>
                <div className="space-y-2">
                  {schemaEntries.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs text-muted">
                      当前工具不需要参数，直接执行即可。
                    </div>
                  )}

                  {schemaEntries.map(([name, schema]) => (
                    <div key={name} className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-fg">{name}</span>
                        <span className="rounded-full bg-[rgba(37,99,235,0.08)] px-2 py-0.5 text-[11px] text-accent">
                          {schema.type ?? 'unknown'}
                        </span>
                        {requiredSet.has(name) && (
                          <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-[11px] text-[#b91c1c]">
                            必填
                          </span>
                        )}
                      </div>
                      {schema.description && (
                        <p className="mt-1 text-xs leading-5 text-muted">{schema.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          </div>
        </div>

        <div className="surface-panel space-y-4 rounded-2xl p-4">
          <div className="relative z-[1] space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              JSON 参数
            </label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={14}
              spellCheck={false}
              className="field-control bg-slate-950 px-4 py-3 font-mono text-sm text-slate-100 focus:bg-slate-950"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExecute}
              disabled={running || !selectedTool}
              className="primary-action px-5 py-2.5 text-sm disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
              {running ? '执行中...' : '执行工具'}
            </button>

            <span className="text-xs text-muted">
              当前已加载 {tools.length} 个工具
            </span>
          </div>

          {error && (
            <div className="status-panel danger-panel px-4 py-3 text-sm text-[#b91c1c]">
              <div className="relative z-[1] flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {resultText && (
            <div className="status-panel p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#1d4ed8]">
                <CheckCircle2 className="h-4 w-4" />
                工具执行结果
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-[#0f172a]">
                {resultText}
              </pre>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
