import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileDown, SendHorizonal, LoaderCircle } from 'lucide-react'
import { Tooltip } from '../components/ui/Tooltip'
import { ModalShell } from '../components/ui/ModalShell'
import { useErrorDialog } from '../components/ui/ErrorDialogProvider'
import { loadStoredModelConfig } from '../lib/model-config-store'
import { toAiConfig } from '../shared/api-types'
import {
  downloadReportHtml,
  getReport,
  getReportPdfUrl,
  reviseReportStream,
  type TestReport,
} from '../features/test-report/report-api'

/** 占位卡 postMessage 桥接的消息类型（与生成 prompt 契约一致） */
const SUPPLEMENT_MESSAGE_TYPE = 'nexus-report-supplement'

export function ReportViewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showError } = useErrorDialog()

  const [report, setReport] = useState<TestReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [instruction, setInstruction] = useState('')
  const [revising, setRevising] = useState(false)
  const [progressMessage, setProgressMessage] = useState('')
  const [supplementFor, setSupplementFor] = useState<string | null>(null)
  const [supplementValues, setSupplementValues] = useState({ executed: '', passed: '', bugs: '' })
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    getReport(id)
      .then((data) => {
        if (!cancelled) setReport(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('报告不存在或加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  /** 监听报告 iframe 内占位卡的补录请求。 */
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; missing?: string } | null
      if (data && data.type === SUPPLEMENT_MESSAGE_TYPE && typeof data.missing === 'string') {
        setSupplementValues({ executed: '', passed: '', bugs: '' })
        setSupplementFor(data.missing)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  /** 发起追改（自然语言指令或补数指令共用）。 */
  const runRevise = useCallback(
    async (finalInstruction: string) => {
      if (!report) return
      const stored = loadStoredModelConfig()
      if (!stored) {
        showError(new Error('请先在模型设置中配置统一供应商'), { title: '未配置模型' })
        return
      }
      setRevising(true)
      setProgressMessage('正在连接模型…')
      try {
        const updated = await reviseReportStream(report.id, finalInstruction, toAiConfig(stored), (event) => {
          if (event.type === 'progress') setProgressMessage(event.message)
        })
        if (updated) {
          setReport(updated)
          setInstruction('')
        }
      } catch (error) {
        showError(error, { title: '追改失败' })
      } finally {
        setRevising(false)
        setProgressMessage('')
      }
    },
    [report, showError],
  )

  const handleSupplementSubmit = () => {
    const executed = supplementValues.executed.trim()
    const passed = supplementValues.passed.trim()
    const bugs = supplementValues.bugs.trim()
    if (!executed && !passed && !bugs) return
    const parts = [
      executed && `本轮计划执行用例 ${executed} 条`,
      passed && `通过 ${passed} 条`,
      bugs && `发现 BUG ${bugs} 个`,
    ].filter(Boolean)
    setSupplementFor(null)
    void runRevise(`补录真实执行数据（来源：用户手工补录）：${parts.join('；')}。请据此解锁「${supplementFor}」缺数图型并更新报告相关图表。`)
  }

  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center py-24 text-sm text-muted">加载中…</div>
    )
  }

  if (loadError || !report) {
    return (
      <div className="page-shell flex flex-col items-center gap-4 py-24">
        <p className="text-sm text-muted">{loadError || '报告不存在'}</p>
        <button type="button" onClick={() => navigate('/testreport')} className="secondary-action px-4 py-2 text-sm">
          返回报告列表
        </button>
      </div>
    )
  }

  return (
    <div className="page-shell flex h-full flex-col">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Tooltip content="返回列表">
            <button
              type="button"
              onClick={() => navigate('/testreport')}
              className="icon-action h-10 w-10 rounded-xl"
              aria-label="返回列表"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Tooltip>
          <div className="min-w-0">
            <h1 className="page-title truncate">{report.title}</h1>
            <p className="page-subtitle">AI 报告 · 可下载 HTML / 导出 PDF / 对话追改</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="下载单文件 HTML">
            <button
              type="button"
              onClick={() => downloadReportHtml(report)}
              className="secondary-action px-4 py-2 text-sm"
            >
              <Download className="h-4 w-4" />
              下载 HTML
            </button>
          </Tooltip>
          <Tooltip content="后端无头浏览器渲染 PDF">
            <a href={getReportPdfUrl(report.id)} className="primary-action inline-flex items-center gap-1.5 px-4 py-2 text-sm">
              <FileDown className="h-4 w-4" />
              导出 PDF
            </a>
          </Tooltip>
        </div>
      </div>

      <div className="surface-panel min-h-0 flex-1 overflow-hidden rounded-[26px]">
        <iframe
          ref={iframeRef}
          title={report.title}
          sandbox="allow-scripts"
          srcDoc={report.html}
          className="h-full min-h-[560px] w-full border-0 bg-[#F0EFEB]"
        />
      </div>

      {/* 对话式追改 */}
      <div className="surface-panel mt-4 rounded-[22px] p-4">
        <div className="flex items-end gap-3">
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={2}
            disabled={revising}
            placeholder="对话追改：如「把缺陷分布改成趋势图」「结论写激进一点」；报告内占位卡点「补录数据」可补数解锁"
            className="field-control min-w-0 flex-1 resize-none rounded-2xl px-4 py-3 text-sm leading-6"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && instruction.trim() && !revising) {
                event.preventDefault()
                void runRevise(instruction.trim())
              }
            }}
          />
          <button
            type="button"
            disabled={!instruction.trim() || revising}
            onClick={() => void runRevise(instruction.trim())}
            className="primary-action shrink-0 px-5 py-2.5 text-sm disabled:opacity-50"
          >
            {revising ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
            {revising ? '追改中…' : '追改'}
          </button>
        </div>
        {revising && progressMessage && <p className="mt-2 text-xs text-muted" role="status">{progressMessage}</p>}
      </div>

      {/* 补数弹窗：占位卡 postMessage 触发 */}
      <ModalShell open={supplementFor !== null} onClose={() => setSupplementFor(null)} closeOnBackdrop={false}>
        <div className="flex min-h-full items-center justify-center px-4" onClick={(event) => event.stopPropagation()}>
          <section className="modal-panel w-full max-w-[420px] rounded-[24px] p-6" role="dialog" aria-modal="true" aria-label="补录数据">
            <h3 className="text-base font-semibold text-fg">补录执行数据</h3>
            <p className="mt-1 text-xs text-muted">补录后将整体重新生成报告（约 10–30 秒），解锁「{supplementFor}」图表</p>
            <div className="mt-5 space-y-3">
              {(
                [
                  ['executed', '计划执行用例数'],
                  ['passed', '通过用例数'],
                  ['bugs', '发现 BUG 数'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-fg">{label}</span>
                  <input
                    type="number"
                    min={0}
                    value={supplementValues[key]}
                    onChange={(event) => setSupplementValues((current) => ({ ...current, [key]: event.target.value }))}
                    className="field-control w-28 rounded-xl px-3 py-2 text-sm"
                  />
                </label>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setSupplementFor(null)} className="secondary-action px-4 py-2 text-sm">
                取消
              </button>
              <button type="button" onClick={handleSupplementSubmit} className="primary-action px-4 py-2 text-sm">
                重新生成报告
              </button>
            </div>
          </section>
        </div>
      </ModalShell>
    </div>
  )
}
