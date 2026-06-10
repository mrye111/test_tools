import { AlertCircle, CheckCircle2, Download, Loader2 } from 'lucide-react'
import type { GeneratedPlanResult } from '../../lib/jmeter-builders'

interface Props {
  result: GeneratedPlanResult | null
  error: string | null
  downloading?: boolean
  onDownload?: () => void | Promise<void>
}

export function GeneratedPlanResult({ result, error, downloading = false, onDownload }: Props) {
  return (
    <div className="space-y-4">
      {error && (
        <div className="status-panel danger-panel px-4 py-3 text-sm text-[#b91c1c]">
          <div className="relative z-[1] flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {result && (
        <div className="status-panel space-y-4 p-4">
          <div className="relative z-[1] flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#1d4ed8]">
                <CheckCircle2 className="h-4 w-4" />
                已生成并保存测试计划
              </div>
              <p className="mt-1 text-xs text-[#64748b]">{result.planName}</p>
            </div>
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                disabled={downloading}
                className="primary-action px-4 py-2 text-sm disabled:opacity-50"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {downloading ? '下载中...' : '下载 .jmx'}
              </button>
            )}
          </div>

          <div className="relative z-[1] rounded-xl border border-slate-200 bg-white/86 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#64748b]">服务端路径</div>
            <div className="break-all font-mono text-xs text-[#0f172a]">{result.savedPath}</div>
          </div>

          <div className="relative z-[1] grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white/86 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#64748b]">校验结果</div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[#0f172a]">
                {result.validation}
              </pre>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white/86 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#64748b]">测试计划树</div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[#0f172a]">
                {result.tree}
              </pre>
            </div>
          </div>

          <div className="relative z-[1] rounded-xl border border-slate-200 bg-white/86 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#64748b]">执行轨迹</div>
            <div className="space-y-2">
              {result.steps.map((step, index) => (
                <div key={`${step.tool}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 transition-colors hover:bg-white">
                  <div className="font-mono text-xs font-semibold text-[#1d4ed8]">{step.tool}</div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-xs text-[#334155]">{step.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
