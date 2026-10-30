/** 执行进度弹窗：SSE 订阅运行事件流，渲染状态/步骤/思考/结论；支持中止与查看报告。 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  MessageCircle,
  Play,
  Square,
  XCircle,
} from 'lucide-react'
import { ModalShell } from '../../components/ui/ModalShell'
import {
  abortAutomationRun,
  automationRunReportUrl,
  subscribeRunEvents,
  type RunEvent,
  type RunVerdict,
} from '../../lib/automation-api'

export type RunProgressHandle = {
  runId: string
  title: string
  onDone?: (verdict: RunVerdict) => void
}

const VERDICT_LABEL: Record<RunVerdict, { text: string; className: string }> = {
  passed: { text: '✓ 通过', className: 'at-tl-ok' },
  partial: { text: '◐ 部分通过（含人工项未执行）', className: '' },
  failed: { text: '✗ 失败', className: 'at-tl-fail' },
  aborted: { text: '■ 已中止', className: 'at-tl-fail' },
}

export function RunProgressModal({ handle, onClose }: { handle: RunProgressHandle | null; onClose: () => void }) {
  const [events, setEvents] = useState<RunEvent[]>([])
  const [done, setDone] = useState<RunEvent & { kind: 'verdict' } | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [aborting, setAborting] = useState(false)
  const doneRef = useRef(handle?.onDone)
  doneRef.current = handle?.onDone

  useEffect(() => {
    setEvents([])
    setDone(null)
    setStreamError(null)
    if (!handle) return
    const close = subscribeRunEvents(
      handle.runId,
      (event) => {
        if (event.kind === 'screenshot') return
        setEvents((prev) => [...prev.slice(-199), event])
        if (event.kind === 'verdict') {
          setDone(event)
          doneRef.current?.(event.verdict)
        }
      },
      (message) => setStreamError(message),
    )
    return close
  }, [handle])

  const steps = useMemo(() => {
    const starts = events.filter((e) => e.kind === 'step-start').length
    const dones = events.filter((e) => e.kind === 'step-done').length
    return { starts, dones, progress: starts > 0 ? dones / Math.max(starts, dones) : 0 }
  }, [events])

  const running = handle !== null && done === null

  return (
    <ModalShell open={handle !== null} onClose={onClose}>
      <div
        style={{ width: 620, maxWidth: '92vw' }}
        role="dialog"
        aria-modal="true"
        aria-label={handle?.title ?? '执行进度'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="at-section-title" style={{ marginBottom: 6 }}>
          <Bot size={15} />
          {handle?.title ?? '执行进度'}
        </div>

        <div
          className="at-progress-track"
          role="progressbar"
          aria-valuenow={Math.round(steps.progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="at-progress-fill" style={{ width: `${Math.round(steps.progress * 100)}%` }} />
        </div>

        {streamError && !done && (
          <p className="at-note" style={{ marginBottom: 8, color: 'oklch(0.6 0.14 75)' }}>⚠ {streamError}</p>
        )}

        <div className="at-timeline">
          {events.length === 0 && (
            <div className="at-tl-item thought">
              <span className="at-tl-icon"><Loader2 size={14} className="at-spin" /></span>
              <div>正在连接执行服务…</div>
            </div>
          )}
          {events.map((event, index) => {
            if (event.kind === 'thought') {
              return (
                <div key={index} className="at-tl-item thought">
                  <span className="at-tl-icon"><MessageCircle size={13} /></span>
                  <div>{event.text}</div>
                </div>
              )
            }
            if (event.kind === 'step-start') {
              return (
                <div key={index} className="at-tl-item action">
                  <span className="at-tl-icon"><Play size={13} /></span>
                  <div>
                    <b>{event.stepType.toUpperCase()}</b> {event.text}
                  </div>
                </div>
              )
            }
            if (event.kind === 'step-done') {
              const failed = event.status === 'failed'
              return (
                <div key={index} className="at-tl-item action">
                  <span className={`at-tl-icon ${failed ? 'at-tl-fail' : 'at-tl-ok'}`}>
                    {failed ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                  </span>
                  <div>
                    步骤 {event.stepId} {failed ? '失败' : '完成'}
                    {event.engine && (
                      <span className={`at-badge ${event.engine === 'fast' ? 'at-badge-violet' : 'at-badge-blue'}`} style={{ marginLeft: 6 }}>
                        {event.engine === 'fast' ? '极速' : '视觉'}
                      </span>
                    )}
                    <span className="at-tl-meta"> {(event.durationMs / 1000).toFixed(1)}s{event.error ? ` · ${event.error}` : ''}</span>
                  </div>
                </div>
              )
            }
            if (event.kind === 'variable') {
              return (
                <div key={index} className="at-tl-item thought">
                  <span className="at-tl-icon"><CheckCircle2 size={13} /></span>
                  <div>提取变量 {event.name} = {event.value}</div>
                </div>
              )
            }
            if (event.kind === 'status' && event.status === 'running') {
              return (
                <div key={index} className="at-tl-item thought">
                  <span className="at-tl-icon"><Clock3 size={13} /></span>
                  <div>浏览器已启动，开始执行…</div>
                </div>
              )
            }
            return null
          })}
        </div>

        {done && handle && (
          <div className="at-note" style={{ marginTop: 10 }}>
            <span className={VERDICT_LABEL[done.verdict].className} style={{ fontWeight: 700 }}>
              {VERDICT_LABEL[done.verdict].text}
            </span>
            <span className="at-muted"> · 总耗时 {Math.round(done.durationMs / 1000)}s</span>
            {done.reportFile && (
              <a
                href={automationRunReportUrl(handle.runId)}
                target="_blank"
                rel="noreferrer"
                style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                查看完整报告 <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 9, marginTop: 12, justifyContent: 'flex-end' }}>
          {running && (
            <button
              className="at-btn at-btn-danger"
              disabled={aborting}
              onClick={async () => {
                if (!handle) return
                setAborting(true)
                try {
                  await abortAutomationRun(handle.runId)
                } finally {
                  setAborting(false)
                }
              }}
            >
              <Square size={13} /> {aborting ? '中止中…' : '中止执行'}
            </button>
          )}
          <button className="at-btn" onClick={onClose}>{done ? '关闭' : '后台运行'}</button>
        </div>
      </div>
    </ModalShell>
  )
}
