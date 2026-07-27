import { useEffect, useRef } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import type { AnalysisStage } from '../../lib/requirement-analysis-api'
import type { AnalysisProcessBlock } from './useAnalysisProcessStream'
import { AnalysisProcessBlocks } from './AnalysisProcessBlocks'

const STAGE_LABELS: Array<{ stage: AnalysisStage; label: string }> = [
  { stage: 'parsing', label: '解析需求文档' },
  { stage: 'analyzing', label: 'AI 测试视角分析' },
  { stage: 'finalizing', label: '整理分析结果' },
]

/** 距底部小于该值时视为"在底部"，新内容继续吸底；用户上翻则暂停吸底。 */
const STICK_BOTTOM_THRESHOLD_PX = 24

type AnalysisProgressProps = {
  stage: AnalysisStage
  warnings: string[]
  error: string | null
  processBlocks: AnalysisProcessBlock[]
}

/** 分析过程：解析 → 分析 → 收尾 的阶段指示、warning 提示与实时过程面板。 */
export function AnalysisProgress(props: AnalysisProgressProps) {
  const currentIndex = STAGE_LABELS.findIndex((item) => item.stage === props.stage)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickBottomRef = useRef(true)

  // 新块到达时自动吸底；用户上翻后暂停，回到底部附近时恢复。
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickBottomRef.current) el.scrollTop = el.scrollHeight
  }, [props.processBlocks])

  const handleProcessScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_BOTTOM_THRESHOLD_PX
  }

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

      {props.processBlocks.length > 0 && (
        <div className="requirement-process-panel">
          <p className="requirement-process-title">分析过程</p>
          <div className="requirement-process-scroll" ref={scrollRef} onScroll={handleProcessScroll}>
            <AnalysisProcessBlocks blocks={props.processBlocks} />
          </div>
        </div>
      )}

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
