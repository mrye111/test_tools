/**
 * 需求导入弹窗（票据 16）：勾选的测试条件 → 生成功能用例集 → 批量编译落库为自动化用例。
 * 只做编排与追溯，不新建生成能力；进度由 SSE 直播，断线后可查任务现状拿最终汇总。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Wand2, XCircle } from 'lucide-react'
import { ModalShell } from '../../components/ui/ModalShell'
import { PROMPT_PRESET_OPTIONS, type PromptPreset } from '../../hooks/testcase-constants'
import {
  getImportJob,
  listAutomationSets,
  startRequirementImport,
  subscribeImportEvents,
  type AutomationSet,
  type ImportStage,
  type ImportSummary,
} from '../../lib/automation-api'
import { loadActiveAiConfigSelection } from '../../lib/active-ai-config'
import { getPreference, putPreference } from '../../lib/auth-api'
import { listTestCaseProjects, type TestCaseProject } from '../../lib/testcase-api'

const STAGE_LABEL: Record<ImportStage, string> = {
  generate: '生成功能用例',
  link: '回写追溯矩阵',
  compile: '编译为自动化用例',
  done: '完成',
}

const EXECUTABLE_LABEL: Record<keyof ImportSummary['byExecutable'], string> = {
  full: '全自动',
  partial: '部分自动',
  manual: '需人工',
}

/** 入口地址按分析记录记忆（对齐 TestCasePage 按用例集记忆的既有模式）。 */
function entryUrlKey(recordId: string): string {
  return `requirement-import-entry-${recordId}`
}

interface RequirementImportDialogProps {
  recordId: string
  recordTitle: string
  /** 已勾选、relay === 'none' 的测试条件 id。 */
  conditionIds: string[]
  onClose: () => void
  /** 全流程跑完后回调（刷新条件状态与 RTM）。 */
  onFinished: () => void
}

export function RequirementImportDialog({ recordId, recordTitle, conditionIds, onClose, onFinished }: RequirementImportDialogProps) {
  const [projects, setProjects] = useState<TestCaseProject[]>([])
  const [sets, setSets] = useState<AutomationSet[]>([])
  const [projectId, setProjectId] = useState('')
  const [setId, setSetId] = useState('')
  const [entryUrl, setEntryUrl] = useState('')
  const [promptPreset, setPromptPreset] = useState<PromptPreset>('standard')

  const [importId, setImportId] = useState<string | null>(null)
  const [stage, setStage] = useState<ImportStage | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [failedItems, setFailedItems] = useState<ImportSummary['failed']>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const finishedRef = useRef(false)

  useEffect(() => {
    listTestCaseProjects().then(setProjects).catch(() => setProjects([]))
    listAutomationSets().then(setSets).catch(() => setSets([]))
    // 入口地址记忆读个人偏好（挂用户）；读失败降级为空串
    getPreference(entryUrlKey(recordId))
      .then((value) => {
        // 异步回填不覆盖用户已输入的内容
        if (value) setEntryUrl((current) => (current.trim() ? current : value))
      })
      .catch(() => {})
  }, [recordId])

  /** 换项目时用该项目的被测系统地址预填（仍可手改）。 */
  const handleProjectChange = (next: string) => {
    setProjectId(next)
    setSetId('')
    const found = projects.find((p) => p.id === next)
    if (found?.systemUrl && !entryUrl.trim()) setEntryUrl(found.systemUrl)
  }

  /** 跑完拉一次任务现状：SSE 的汇总与服务端权威结果对齐（断线也不丢）。 */
  const finish = useCallback(
    async (id: string) => {
      if (finishedRef.current) return
      finishedRef.current = true
      try {
        const job = await getImportJob(id)
        if (job.summary) setSummary(job.summary)
        if (job.error) setError(job.error)
      } catch {
        // 拉不到就用 SSE 已累计的展示（不阻塞收尾）
      }
      onFinished()
    },
    [onFinished],
  )

  const start = async () => {
    if (starting || importId) return
    const aiSelection = await loadActiveAiConfigSelection()
    if (!aiSelection) {
      setError('请先在「设置」中配置 AI 模型')
      return
    }
    const url = entryUrl.trim()
    if (!url) {
      setError('必须填写目标系统入口地址（用例文本不含 URL）')
      return
    }
    setStarting(true)
    setError(null)
    // 入口地址记忆写个人偏好；写失败静默，不阻塞主流程
    void putPreference(entryUrlKey(recordId), url).catch(() => {})
    try {
      const id = await startRequirementImport({
        recordId,
        conditionIds,
        projectId,
        setId: setId || undefined,
        entryUrl: url,
        testType: 'functional',
        language: 'zh',
        promptPreset,
        aiConfig: aiSelection.payload,
      })
      setImportId(id)
      subscribeImportEvents(
        id,
        (event) => {
          if (event.kind === 'stage') setStage(event.stage)
          if (event.kind === 'progress') setProgress({ done: event.done, total: event.total })
          if (event.kind === 'item-failed') setFailedItems((prev) => [...prev, { caseId: event.caseId, title: event.title, error: event.error }])
          if (event.kind === 'error') setError(event.message)
          if (event.kind === 'done') void finish(id)
        },
        (message) => setError(message),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  const running = Boolean(importId) && !summary && !error
  const visibleSets = sets.filter((s) => !projectId || s.projectId === projectId)

  return (
    <ModalShell open onClose={() => !running && onClose()}>
      <div
        style={{ width: 520, maxWidth: '92vw' }}
        role="dialog"
        aria-modal="true"
        aria-label="生成自动化用例"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2 text-sm font-bold text-fg">
          <Wand2 className="h-4 w-4" style={{ color: 'oklch(0.52 0.17 155)' }} />
          生成自动化用例
        </div>
        <p className="mb-3 text-xs text-muted">
          {recordTitle} · 已选 {conditionIds.length} 条测试条件。将生成功能用例集并批量编译为自动化用例，同时回写追溯矩阵。
        </p>

        {!importId && (
          <>
            <label className="mb-1 block text-xs font-semibold text-fg" htmlFor="ri-project">目标项目 *</label>
            <select
              id="ri-project"
              value={projectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">选择项目</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            <label className="mb-1 block text-xs font-semibold text-fg" htmlFor="ri-set">自动化用例集</label>
            <select
              id="ri-set"
              value={setId}
              onChange={(e) => setSetId(e.target.value)}
              disabled={!projectId}
              className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">未分组</option>
              {visibleSets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            <label className="mb-1 block text-xs font-semibold text-fg" htmlFor="ri-entry">目标系统入口地址 *</label>
            <input
              id="ri-entry"
              value={entryUrl}
              onChange={(e) => setEntryUrl(e.target.value)}
              className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="https://…（用例文本不含 URL，执行前必须指定）"
              onKeyDown={(e) => e.key === 'Enter' && void start()}
            />

            <label className="mb-1 block text-xs font-semibold text-fg" htmlFor="ri-preset">用例设计规范</label>
            <select
              id="ri-preset"
              value={promptPreset}
              onChange={(e) => setPromptPreset(e.target.value as PromptPreset)}
              className="mb-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {PROMPT_PRESET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </>
        )}

        {(running || summary || error) && (
          <div className="mb-4 rounded-xl border border-slate-200 p-3 text-xs">
            {stage && (
              <p className="mb-2 flex items-center gap-2 font-semibold text-fg">
                {summary ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
                {STAGE_LABEL[stage]}
                {stage === 'compile' && progress.total > 0 && <span className="text-muted">（{progress.done}/{progress.total}）</span>}
              </p>
            )}
            {error && (
              <p className="mb-2 flex items-start gap-2 text-danger" role="alert">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
            {summary && (
              <>
                <p className="mb-1 text-muted">
                  生成功能用例 {summary.generatedCases} 条 → 落库自动化用例 {summary.created} 条
                  （缓存命中 {summary.cacheHit}，降级直映 {summary.fallback}）
                </p>
                <p className="mb-1 text-fg">
                  {(Object.keys(EXECUTABLE_LABEL) as Array<keyof ImportSummary['byExecutable']>).map((k) => (
                    <span key={k} className="mr-3">{EXECUTABLE_LABEL[k]} {summary.byExecutable[k]}</span>
                  ))}
                </p>
                {failedItems.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-danger">
                    {failedItems.map((f) => <li key={f.caseId}>{f.caseId} {f.title}：{f.error}</li>)}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        <p className="mb-4 text-[11px] leading-relaxed text-muted">
          中间产物会作为功能用例集保存在「测试用例」页（可导出/人工审改）；追溯矩阵按「已生成功能用例」计覆盖。
        </p>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="secondary-action px-4 py-2 text-xs" disabled={running}>
            {summary ? '关闭' : '取消'}
          </button>
          {!summary && (
            <button
              type="button"
              onClick={() => void start()}
              className="primary-action px-5 py-2 text-xs"
              disabled={running || starting || !projectId || !entryUrl.trim()}
            >
              {running ? '生成中…' : '开始生成'}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  )
}
