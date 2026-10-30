/** 用例详情抽屉（P3）：基础 / 运行设置 / 预览 / 代码 四页签。 */

import { useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { automationRunReportUrl, listAutomationRuns, type AutomationCase, type RunRecord, type StepResult } from '../../lib/automation-api'

type TabKey = 'basics' | 'settings' | 'preview' | 'code'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basics', label: '基础' },
  { key: 'settings', label: '运行设置' },
  { key: 'preview', label: '预览' },
  { key: 'code', label: '代码' },
]

const SOURCE_LABEL: Record<AutomationCase['source'], string> = {
  manual: '手工创建',
  playground: '执行台固化',
  'functional-import': '功能用例导入',
  'plan-proposal': '规划提案（首跑编译步骤）',
}

const STEP_TYPE_LABEL: Record<StepResult['type'], string> = {
  act: '操作',
  assert: '断言',
  extract: '提取',
  wait: '等待',
  external: '外部',
}

function StepStatusMark({ status }: { status: StepResult['status'] }) {
  if (status === 'passed') return <span style={{ color: 'var(--color-success)' }}>✓</span>
  if (status === 'failed') return <span style={{ color: 'var(--color-danger)' }}>✗</span>
  return <span className="at-muted">–</span>
}

function PreviewTab({ item }: { item: AutomationCase }) {
  const [runs, setRuns] = useState<RunRecord[] | null>(null)

  useEffect(() => {
    let cancelled = false
    listAutomationRuns(item.id, 5)
      .then((list) => { if (!cancelled) setRuns(list) })
      .catch(() => { if (!cancelled) setRuns([]) })
    return () => {
      cancelled = true
    }
  }, [item.id])

  if (runs === null) return <p className="at-note">加载运行记录…</p>
  const latest = runs[0]
  if (!latest) {
    return <p className="at-note">还没有运行记录。执行后这里会显示步骤结果与回放报告。</p>
  }
  return (
    <div>
      <div className="at-section-title" style={{ marginBottom: 6 }}>
        最近运行 · {latest.verdict === 'passed' ? '通过' : latest.verdict === 'partial' ? '部分通过' : latest.verdict === 'failed' ? '失败' : '已中止'}
        <span className="at-muted at-small"> {latest.finishedAt ? new Date(latest.finishedAt).toLocaleString() : ''}</span>
        {latest.reportFile && (
          <a className="at-btn at-btn-sm" style={{ marginLeft: 8 }} href={automationRunReportUrl(latest.id)} target="_blank" rel="noreferrer">
            <ExternalLink size={12} />回放报告
          </a>
        )}
      </div>
      <table className="at-table">
        <tbody>
          {latest.stepResults.map((step, i) => (
            <tr key={`${step.stepId}-${i}`}>
              <td style={{ width: 24 }}><StepStatusMark status={step.status} /></td>
              <td className="at-num" style={{ width: 52 }}>{STEP_TYPE_LABEL[step.type]}</td>
              <td>
                {step.text}
                {step.error && <div className="at-small" style={{ color: 'var(--color-danger)' }}>{step.error}</div>}
                {step.extractedValue !== undefined && <div className="at-small at-muted">提取值：{step.extractedValue}</div>}
              </td>
              <td className="at-num at-small at-muted" style={{ width: 70 }}>{step.durationMs}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length > 1 && <p className="at-note">另有 {runs.length - 1} 条更早的运行记录，到「运行」页查看全部。</p>}
    </div>
  )
}

export function CaseDetailDrawer({ item, onClose }: { item: AutomationCase | null; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>('basics')

  useEffect(() => {
    if (item) setTab('basics')
  }, [item])

  useEffect(() => {
    if (!item) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  if (!item) return null
  const varEntries = Object.entries(item.varDefs)

  return (
    <div className="at-drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="at-drawer" role="dialog" aria-label={`用例详情 ${item.caseNo}`} onClick={(e) => e.stopPropagation()}>
        <div className="at-drawer-head">
          <div>
            <b className="at-num">{item.caseNo}</b> · {item.title}
            <div className="at-small at-muted">{SOURCE_LABEL[item.source]}</div>
          </div>
          <button className="at-btn at-btn-sm" aria-label="关闭详情" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="at-tabs" role="tablist" aria-label="用例详情页签">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`at-tab ${tab === t.key ? 'is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="at-drawer-body">
          {tab === 'basics' && (
            <div>
              <div className="at-section-title">目标与前置</div>
              <p className="at-note">{item.preconditionText || '（无前置条件）'}</p>
              <div className="at-section-title">人工项（{item.manualItems.length}）</div>
              {item.manualItems.length === 0 ? (
                <p className="at-note">无</p>
              ) : (
                <ul className="at-note" style={{ paddingLeft: 18 }}>
                  {item.manualItems.map((m, i) => (
                    <li key={i}>{m.text}{m.reason ? <span className="at-muted"> —— {m.reason}</span> : null}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {tab === 'settings' && (
            <div>
              <div className="at-section-title">执行入口</div>
              <p className="at-note">{item.entryUrl || '（继承项目入口地址）'}</p>
              <div className="at-section-title">变量定义（{varEntries.length}）</div>
              {varEntries.length === 0 ? (
                <p className="at-note">无自定义变量</p>
              ) : (
                <table className="at-table">
                  <tbody>
                    {varEntries.map(([name, value]) => (
                      <tr key={name}><td className="at-num">{name}</td><td>{value}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="at-section-title">可自动化程度</div>
              <p className="at-note">
                {item.executable === 'full' ? '全自动执行' : item.executable === 'partial' ? `部分自动（${item.manualItems.length} 项需人工）` : '需人工执行'}
                {item.source === 'plan-proposal' && '。步骤来自规划提案：首次执行时由 LLM 编译补全后再运行'}
              </p>
            </div>
          )}
          {tab === 'preview' && <PreviewTab item={item} />}
          {tab === 'code' && (
            <pre className="at-drawer-code">{JSON.stringify({ steps: item.steps, manualItems: item.manualItems }, null, 2)}</pre>
          )}
        </div>
      </aside>
    </div>
  )
}
