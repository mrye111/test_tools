/** 交互执行台：URL 打开持久会话 → 逐条发指令 → 画面/执行流实时更新 → 一键存为用例。 */

import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircle,
  MonitorPlay,
  Play,
  Save,
  Send,
  Square,
  XCircle,
} from 'lucide-react'
import {
  closeBenchSession,
  createBenchSession,
  saveBenchAsCase,
  sendBenchInstruction,
  type BenchInstructResult,
} from '../../lib/automation-api'
import { listTestCaseProjects } from '../../lib/testcase-api'

type Project = { id: string; name: string }

type TimelineEntry =
  | { kind: 'instruction'; type: string; text: string; ok?: boolean; error?: string; durationMs?: number }
  | { kind: 'thought'; text: string }
  | { kind: 'extracted'; value: string }

const INSTRUCT_TYPES = [
  { value: 'act', label: '执行动作' },
  { value: 'assert', label: '断言检查' },
  { value: 'query', label: '提取数据' },
] as const

export function BenchView() {
  const [url, setUrl] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [instructType, setInstructType] = useState<'act' | 'assert' | 'query'>('act')
  const [instruction, setInstruction] = useState('')
  const [executing, setExecuting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentInstruction, setCurrentInstruction] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [saveProjectId, setSaveProjectId] = useState('')
  const [saveTitle, setSaveTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedCaseNo, setSavedCaseNo] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const aliveRef = useRef(true)
  const sessionRef = useRef<string | null>(null)
  sessionRef.current = sessionId

  useEffect(() => {
    listTestCaseProjects()
      .then((list) => setProjects((list as { projects?: Project[] }).projects ?? (list as unknown as Project[])))
      .catch(() => setProjects([]))
    return () => {
      // 组件真正卸载（离开自动化模块）时：清计时器、忽略迟到响应、关闭执行台会话
      aliveRef.current = false
      if (timerRef.current) window.clearInterval(timerRef.current)
      if (sessionRef.current) void closeBenchSession(sessionRef.current)
    }
  }, [])

  const openSession = async () => {
    if (!url.trim() || opening) return
    setOpening(true)
    setError(null)
    try {
      const session = await createBenchSession(url.trim())
      setSessionId(session.id)
      setTimeline([{ kind: 'thought', text: `已打开 ${session.url}，可以开始发指令` }])
      setScreenshot(null)
      setSavedCaseNo(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpening(false)
    }
  }

  const closeSession = async () => {
    if (sessionId) await closeBenchSession(sessionId).catch(() => undefined)
    setSessionId(null)
    setTimeline([])
    setScreenshot(null)
  }

  const send = async () => {
    if (!sessionId || !instruction.trim() || executing) return
    const text = instruction.trim()
    setExecuting(true)
    setElapsed(0)
    setError(null)
    setCurrentInstruction(text)
    timerRef.current = window.setInterval(() => setElapsed((v) => v + 0.1), 100)
    setTimeline((prev) => [...prev, { kind: 'instruction', type: instructType, text }])
    setInstruction('')
    try {
      const result: BenchInstructResult = await sendBenchInstruction(sessionId, { type: instructType, text })
      if (!aliveRef.current) return
      if (result.screenshot) setScreenshot(`data:image/jpeg;base64,${result.screenshot}`)
      setTimeline((prev) => {
        const next = [...prev]
        next[next.length - 1] = { kind: 'instruction', type: instructType, text, ok: result.ok, error: result.error, durationMs: result.durationMs }
        for (const event of result.events) {
          if (event.kind === 'thought') next.push({ kind: 'thought', text: event.text })
        }
        if (result.extractedValue) next.push({ kind: 'extracted', value: result.extractedValue })
        return next
      })
    } catch (err) {
      if (!aliveRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      setTimeline((prev) => {
        const next = [...prev]
        next[next.length - 1] = { kind: 'instruction', type: instructType, text, ok: false, error: message }
        return next
      })
    } finally {
      if (timerRef.current) window.clearInterval(timerRef.current)
      if (aliveRef.current) setExecuting(false)
    }
  }

  const saveAsCase = async () => {
    if (!sessionId || !saveProjectId || !saveTitle.trim()) return
    setSaving(true)
    setError(null)
    try {
      const created = await saveBenchAsCase(sessionId, { projectId: saveProjectId, title: saveTitle.trim() })
      setSavedCaseNo(created.caseNo)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="at-toolbar">
        <input
          className="at-input"
          style={{ width: 320, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
          placeholder="https://…（目标系统地址）"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={sessionId !== null}
          onKeyDown={(e) => e.key === 'Enter' && void openSession()}
        />
        {sessionId === null ? (
          <button className="at-btn at-btn-primary" disabled={opening || !url.trim()} onClick={() => void openSession()}>
            <MonitorPlay size={14} />{opening ? '打开中…' : '打开页面'}
          </button>
        ) : (
          <button className="at-btn at-btn-danger" onClick={() => void closeSession()}>
            <Square size={13} />关闭会话
          </button>
        )}
        {sessionId && (
          <>
            <select className="at-select" value={instructType} onChange={(e) => setInstructType(e.target.value as typeof instructType)}>
              {INSTRUCT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input
              className="at-input"
              style={{ flex: 1 }}
              placeholder="输入自然语言指令，如：点击左侧「账单中心」，检查累计用量是否显示 500000 条"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={executing}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
            />
            <button className="at-btn at-btn-run" disabled={executing || !instruction.trim()} onClick={() => void send()}>
              <Send size={13} />{executing ? `${elapsed.toFixed(1)}s` : '发送'}
            </button>
          </>
        )}
      </div>

      {error && <p className="at-note" style={{ marginBottom: 12, color: 'var(--color-danger)' }}>{error}</p>}

      {sessionId && executing && (
        <div className="at-bench-status">
          <span className="at-live-dot" />
          <span style={{ fontWeight: 650 }}>执行中</span>
          <span style={{ color: 'oklch(0.6 0.03 262)', fontSize: 12 }}>{currentInstruction}</span>
          <span className="at-num" style={{ color: 'oklch(0.6 0.03 262)', fontSize: 12 }}>已用 {elapsed.toFixed(1)}s</span>
        </div>
      )}

      <div className="at-bench-grid">
        <div className="at-shot-pane">
          {screenshot ? (
            <img src={screenshot} alt="执行画面" />
          ) : (
            <div className="at-shot-empty">
              <MonitorPlay size={26} />
              <div>{sessionId ? '执行第一条指令后，这里会显示页面画面（plan_thinking 事件截图）' : '输入目标地址并「打开页面」开始调试'}</div>
            </div>
          )}
        </div>

        <div>
          <div className="at-card" style={{ padding: 13 }}>
            <h3 className="at-section-title"><Play size={14} />执行流</h3>
            <div className="at-timeline">
              {timeline.length === 0 && <div className="at-tl-item thought"><span className="at-tl-icon"><Clock3 size={13} /></span><div>指令与模型思考会显示在这里</div></div>}
              {timeline.map((entry, index) => {
                if (entry.kind === 'instruction') {
                  const icon = entry.ok === undefined ? <Loader2 size={13} className="at-spin" /> : entry.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />
                  const cls = entry.ok === undefined ? '' : entry.ok ? 'at-tl-ok' : 'at-tl-fail'
                  return (
                    <div key={index} className="at-tl-item action">
                      <span className={`at-tl-icon ${cls}`}>{icon}</span>
                      <div>
                        <b>{entry.type.toUpperCase()}</b> {entry.text}
                        <span className="at-tl-meta">
                          {entry.durationMs !== undefined && ` ${(entry.durationMs / 1000).toFixed(1)}s`}
                          {entry.error && ` · ${entry.error}`}
                        </span>
                      </div>
                    </div>
                  )
                }
                if (entry.kind === 'extracted') {
                  return (
                    <div key={index} className="at-tl-item action">
                      <span className="at-tl-icon at-tl-ok"><CheckCircle2 size={13} /></span>
                      <div>提取结果：<b className="at-num">{entry.value}</b></div>
                    </div>
                  )
                }
                return (
                  <div key={index} className="at-tl-item thought">
                    <span className="at-tl-icon"><MessageCircle size={13} /></span>
                    <div>{entry.text}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="at-card" style={{ padding: 13, marginTop: 11 }}>
            <h3 className="at-section-title"><Save size={14} />将本次流程存为用例</h3>
            {savedCaseNo ? (
              <p className="at-note" style={{ margin: 0 }}>
                ✓ 已保存为 <b>{savedCaseNo}</b>，可到「用例管理」编辑或加入回归。
              </p>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select className="at-select" value={saveProjectId} onChange={(e) => setSaveProjectId(e.target.value)}>
                  <option value="">归属项目</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input className="at-input" style={{ flex: 1, minWidth: 160 }} placeholder="用例标题" value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} />
                <button className="at-btn at-btn-primary" disabled={!sessionId || !saveProjectId || !saveTitle.trim() || saving} onClick={() => void saveAsCase()}>
                  {saving ? '保存中…' : '存为用例'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
