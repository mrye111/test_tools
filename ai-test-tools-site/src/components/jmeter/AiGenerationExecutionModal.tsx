import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, Check, CheckCircle2, Clock3, FileCheck, FileText, Globe, Loader2, PieChart, Settings, Sparkles, Users, X } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { ModalPortal } from '../ui/ModalPortal'
import { GeneratedPlanResult as GeneratedPlanResultPanel } from './GeneratedPlanResult'
import type { AiGenerationEvent, AiGenerationPlayback } from '../../hooks/useAiGenerationPlayback'

interface Props {
  open: boolean
  playback: AiGenerationPlayback
  downloading: boolean
  onClose: () => void
  onDownload: () => void | Promise<void>
}

function statusBadgeClass(status: 'running' | 'done' | 'error') {
  if (status === 'error') return 'border-[oklch(0.55_0.2_25/0.26)] bg-[oklch(0.97_0.01_25/0.9)] text-danger'
  if (status === 'done') return 'border-[oklch(0.55_0.15_160/0.26)] bg-[oklch(0.97_0.01_155/0.88)] text-success'
  return 'border-[oklch(0.56_0.24_208/0.26)] bg-[linear-gradient(120deg,oklch(0.56_0.24_208/0.12),oklch(0.7_0.14_218/0.09))] text-accent'
}

function tabButtonClass(active: boolean) {
  return active
    ? 'border-[oklch(0.56_0.24_208/0.3)] bg-[linear-gradient(120deg,oklch(0.56_0.24_208/0.12),oklch(0.7_0.14_218/0.09))] text-accent shadow-[0_10px_30px_-24px_oklch(0.56_0.24_208/0.7)]'
    : 'border-white/70 bg-white/60 text-muted hover:border-[oklch(0.56_0.24_208/0.28)] hover:text-fg'
}

function normalizeStepLabel(event: AiGenerationEvent) {
  if (event.type === 'tool') return event.title
  if (event.type === 'done') return '生成完成'
  if (event.type === 'error') return '生成失败'
  if (event.title === '提交生成请求') return '提交生成请求'
  return event.title
}

function iconForStep(label: string) {
  if (label.includes('测试计划')) return FileText
  if (label.includes('线程组')) return Users
  if (label.includes('HTTP 默认配置') || label.includes('请求头') || label.includes('配置')) return Settings
  if (label.includes('HTTP 请求') || label.includes('LDAP') || label.includes('JDBC') || label.includes('TCP') || label.includes('SMTP') || label.includes('FTP')) return Globe
  if (label.includes('断言') || label.includes('校验')) return FileCheck
  if (label.includes('监听器')) return PieChart
  if (label.includes('完成')) return CheckCircle2
  return Sparkles
}

function deriveStepStatus(event: AiGenerationEvent): 'running' | 'done' | 'error' {
  if (event.type === 'error') return 'error'
  if (event.type === 'done') return 'done'
  return event.phase === 'done' ? 'done' : 'running'
}

export function AiGenerationExecutionModal({
  open,
  playback,
  downloading,
  onClose,
  onDownload,
}: Props) {
  const { activeTab, running, events, result, error, setActiveTab } = playback
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open || activeTab !== 'process') return

    const viewport = scrollViewportRef.current
    if (!viewport) return

    const rafId = window.requestAnimationFrame(() => {
      scrollAnchorRef.current?.scrollIntoView({
        behavior: events.length > 1 ? 'smooth' : 'auto',
        block: 'end',
      })
    })

    return () => window.cancelAnimationFrame(rafId)
  }, [activeTab, events, open, running])

  if (!open) return null

  const hasResult = Boolean(result)
  const progressEvents = events
  const totalSteps = Math.max(progressEvents.length, running ? progressEvents.length + 1 : progressEvents.length || 1)
  const completedSteps = progressEvents.filter((event) => deriveStepStatus(event) === 'done').length
  const progressPercent = Math.max(8, Math.min(100, Math.round((completedSteps / totalSteps) * 100)))

  return (
    <ModalPortal
      onClose={() => {
        if (!running) onClose()
      }}
      closeOnBackdrop={!running}
      closeOnEscape={!running}
    >
      <div
        className="modal-panel w-full max-w-[1080px] rounded-[32px] p-6 max-sm:max-w-full max-sm:p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2">
              <span className={`badge ${running ? 'badge-accent' : hasResult ? 'badge-success' : error ? 'badge-danger' : 'badge-muted'}`}>
                {running ? <Loader2 className="h-3 w-3 animate-spin" /> : hasResult ? <CheckCircle2 className="h-3 w-3" /> : error ? <AlertCircle className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
                {running ? '执行中' : hasResult ? '已完成' : error ? '失败' : '等待中'}
              </span>
            </div>
            <h3 className="font-display text-xl font-semibold tracking-[-0.035em] text-fg">
              JMeter AI 生成
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip content={running ? '生成进行中，暂不可关闭' : '关闭'}>
              <button
                type="button"
                onClick={onClose}
                disabled={running}
                className="icon-action h-8 w-8 rounded-xl disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('process')}
            className={`secondary-action rounded-full px-4 py-2 text-sm ${tabButtonClass(activeTab === 'process')}`}
          >
            <Sparkles className="h-4 w-4" />
            执行过程
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('result')}
            className={`secondary-action rounded-full px-4 py-2 text-sm ${tabButtonClass(activeTab === 'result')}`}
          >
            <CheckCircle2 className="h-4 w-4" />
            执行结果
          </button>
        </div>

        {activeTab === 'process' ? (
          <div className="space-y-4">
            <div
              className="status-panel rounded-[28px] p-5"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="relative z-[1] text-xs font-semibold uppercase tracking-[0.16em] text-muted">执行进度</div>
                <div className="relative z-[1] text-xs font-medium text-muted">
                  {Math.min(completedSteps, totalSteps)}/{totalSteps}
                </div>
              </div>
              <div className="relative z-[1] h-2 overflow-hidden rounded-full bg-[oklch(0.56_0.24_208/0.1)]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,oklch(0.56_0.24_208)_0%,oklch(0.62_0.176_168)_48%,oklch(0.7_0.14_218)_100%)] transition-all duration-500 shadow-[0_0_24px_oklch(0.56_0.24_208/0.45)]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div
              className="surface-panel rounded-[28px] px-6 py-5"
            >
              <div className="relative z-[1] mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted">执行步骤</div>
              <div ref={scrollViewportRef} className="relative max-h-[58vh] overflow-y-auto pr-2">
                <div className="absolute left-[23px] top-2 bottom-2 w-px rounded-full bg-[oklch(0.56_0.24_208/0.12)]" />
                <motion.div
                  className="absolute left-[23px] top-2 w-px rounded-full bg-[linear-gradient(180deg,oklch(0.56_0.24_208/0.95),oklch(0.62_0.176_168/0.9),oklch(0.7_0.14_218/0.85))] transition-all duration-700"
                  initial={false}
                  animate={{
                    height: `${Math.max(0, Math.min(100, progressPercent))}%`,
                  }}
                  transition={{
                    duration: 0.72,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  style={{
                    boxShadow: '0 0 18px oklch(0.56 0.24 208 / 0.45)',
                  }}
                />
                <div className="space-y-7">
                {progressEvents.length > 0 ? (
                  <AnimatePresence initial={false}>
                    {progressEvents.map((event, index) => {
                      const status = deriveStepStatus(event)
                      const isDone = status === 'done'
                      const isError = status === 'error'
                      const isRunning = status === 'running'
                      const label = normalizeStepLabel(event)
                      const Icon = iconForStep(label)
                      return (
                        <motion.div
                          key={event.id}
                          layout
                          initial={{ opacity: 0, y: 26, scale: 0.985 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -14, scale: 0.985 }}
                          transition={{ duration: 0.46, ease: [0.16, 1, 0.3, 1] }}
                          className="relative flex items-center gap-5"
                        >
                          <motion.div
                            layout
                            animate={{
                              scale: isRunning ? 1.03 : 1,
                            }}
                            transition={{
                              duration: 0.38,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            className="relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full border"
                            style={{
                              background: isError
                                ? 'linear-gradient(180deg, rgba(254,242,242,0.98), rgba(254,226,226,0.84))'
                                : isDone
                                  ? 'linear-gradient(180deg, rgba(240,253,244,0.98), rgba(220,252,231,0.86))'
                                  : 'linear-gradient(135deg, oklch(0.56 0.24 208 / 0.14), oklch(0.7 0.14 218 / 0.12))',
                              borderColor: isError
                                ? 'rgba(248,113,113,0.24)'
                                : isDone
                                  ? 'rgba(74,222,128,0.22)'
                                  : 'oklch(0.56 0.24 208 / 0.28)',
                              boxShadow: isDone
                                ? '0 14px 28px -22px rgba(34,197,94,0.32)'
                                : '0 14px 28px -22px oklch(0.56 0.24 208 / 0.35)',
                            }}
                          >
                            <motion.div
                              key={`${event.id}-${status}-icon`}
                              initial={{ opacity: 0.4, scale: 0.84 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                            >
                              <Icon className={`h-5 w-5 ${isError ? 'text-danger' : isDone ? 'text-success' : 'text-accent'}`} />
                            </motion.div>
                            {isRunning && (
                              <motion.div
                                className="absolute inset-0 rounded-full border border-[oklch(0.56_0.24_208/0.35)]"
                                initial={{ opacity: 0.12, scale: 0.92 }}
                                animate={{ opacity: [0.18, 0.36, 0.14], scale: [0.92, 1.08, 1.16] }}
                                transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeOut' }}
                              />
                            )}
                          </motion.div>

                          <motion.div
                            layout
                            animate={{
                              opacity: 1,
                              x: 0,
                            }}
                            transition={{
                              duration: 0.42,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            className="min-w-0 flex-1 overflow-hidden rounded-[24px] border border-white/70 bg-white/70 px-4 py-3 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.18)] backdrop-blur-md"
                          >
                            <div className="text-sm font-semibold text-fg">
                              {index + 1}. {label}
                            </div>
                          </motion.div>

                          <div className="relative w-[132px] shrink-0">
                            <motion.div
                              className="absolute left-[-18px] top-1/2 h-px w-4 -translate-y-1/2 bg-[oklch(0.56_0.24_208/0.18)]"
                              initial={{ scaleX: 0.1, opacity: 0 }}
                              animate={{ scaleX: 1, opacity: 1 }}
                              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                              style={{ transformOrigin: 'left center' }}
                            />
                            <motion.div
                              key={`${event.id}-${status}-badge`}
                              initial={{ opacity: 0, x: -12, scale: 0.96 }}
                              animate={{ opacity: 1, x: 0, scale: 1 }}
                              transition={{
                                duration: 0.34,
                                ease: [0.16, 1, 0.3, 1],
                              }}
                              className={`rounded-full border px-3 py-2 text-xs font-semibold ${statusBadgeClass(status)}`}
                              style={{ boxShadow: '0 10px 24px -22px rgba(15,23,42,0.18)' }}
                            >
                              <div className="flex items-center justify-center gap-2">
                                {isError ? (
                                  <AlertCircle className="h-3.5 w-3.5" />
                                ) : isDone ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                )}
                                <span>{isError ? '失败' : isDone ? '已完成' : '执行中'}</span>
                              </div>
                            </motion.div>
                          </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                ) : (
                  <div className="empty-state !items-start !justify-start border-white/10 bg-white/4 px-4 py-5 text-left">
                    <div className="empty-state-icon !mb-4">
                      {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                    </div>
                    <div className="empty-state-title">{running ? '正在准备执行' : '等待开始生成'}</div>
                  </div>
                )}

                {running && (
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 0.95, y: 0 }}
                    transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                    className="relative flex items-center gap-5"
                  >
                    <div className="relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[oklch(0.56_0.24_208/0.3)] bg-[linear-gradient(135deg,oklch(0.56_0.24_208/0.16),oklch(0.7_0.14_218/0.14))]">
                      <Sparkles className="h-5 w-5 text-accent" />
                    </div>
                    <div
                      className="min-w-0 flex-1 rounded-[24px] border border-dashed border-[oklch(0.56_0.24_208/0.3)] bg-white/55 px-4 py-3 backdrop-blur-md"
                    >
                      <div className="text-sm font-semibold text-fg">
                        {progressEvents.length + 1}. 等待下一步
                      </div>
                    </div>
                    <div className="relative w-[132px] shrink-0">
                      <div className="absolute left-[-18px] top-1/2 h-px w-4 -translate-y-1/2 bg-[oklch(0.56_0.24_208/0.18)]" />
                      <div className="rounded-full border border-[oklch(0.56_0.24_208/0.26)] bg-[linear-gradient(120deg,oklch(0.56_0.24_208/0.12),oklch(0.7_0.14_218/0.09))] px-3 py-2 text-xs font-semibold text-accent">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>执行中</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
                <div ref={scrollAnchorRef} className="h-px w-full" />
                </div>
              </div>
            </div>
            {error && (
              <div className="status-panel danger-panel px-4 py-3 text-sm text-danger">
                <div className="relative z-[1] flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="max-h-[66vh] overflow-y-auto pr-1">
            {result || error ? (
              <GeneratedPlanResultPanel
                result={result}
                error={error}
                downloading={downloading}
                onDownload={onDownload}
              />
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">
                  {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                </div>
                <div className="empty-state-title">{running ? '结果尚未生成' : '暂无执行结果'}</div>
                <div className="empty-state-description">
                  {running ? 'AI 还在执行中，当前结果步骤会在完成后自动展示最终保存路径、校验结果和测试计划树。' : '开始一次新的 AI 生成后，这里会展示最终执行结果。'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ModalPortal>
  )
}
