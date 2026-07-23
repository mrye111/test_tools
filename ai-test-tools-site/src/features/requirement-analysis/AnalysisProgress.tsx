import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import type { AnalysisStage } from '../../lib/requirement-analysis-api'

const STAGE_LABELS: Array<{ stage: AnalysisStage; label: string }> = [
  { stage: 'parsing', label: '解析需求文档' },
  { stage: 'analyzing', label: 'AI 测试视角分析' },
  { stage: 'finalizing', label: '整理分析结果' },
]

type AnalysisProgressProps = {
  stage: AnalysisStage
  warnings: string[]
  error: string | null
}

/** 分析过程：解析 → 分析 → 收尾 的阶段指示与 warning 提示。 */
export function AnalysisProgress(props: AnalysisProgressProps) {
  const currentIndex = STAGE_LABELS.findIndex((item) => item.stage === props.stage)

  return (
    <section className="surface-panel requirement-progress-panel" aria-live="polite">
      <ol className="requirement-stage-list">
        {STAGE_LABELS.map((item, index) => {
          const state = props.error
            ? (index < currentIndex ? 'done' : index === currentIndex ? 'error' : 'pending')
            : (index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending')
          return (
            <li key={item.stage} className={`requirement-stage-item is-${state}`}>
              {state === 'done' && <CheckCircle2 className="h-4 w-4" />}
              {state === 'active' && <Loader2 className="h-4 w-4 animate-spin" />}
              {state === 'error' && <AlertTriangle className="h-4 w-4" />}
              {state === 'pending' && <span className="requirement-stage-dot" />}
              <span>{item.label}</span>
            </li>
          )
        })}
      </ol>

      {props.warnings.length > 0 && (
        <ul className="requirement-warning-list">
          {props.warnings.map((warning, index) => (
            <li key={index}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      {props.error && <p className="field-error requirement-progress-error">{props.error}</p>}
    </section>
  )
}
