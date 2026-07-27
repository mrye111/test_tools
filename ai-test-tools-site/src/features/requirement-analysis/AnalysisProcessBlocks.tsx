import { Info } from 'lucide-react'
import type { AnalysisProcessBlock } from './useAnalysisProcessStream'

type AnalysisProcessBlocksProps = {
  blocks: AnalysisProcessBlock[]
}

/**
 * 分析过程块渲染（纯展示，无滚动行为）：reasoning 普通字体弱化色、
 * content 等宽字体默认折叠、attempt 分隔提示条、notice 信息行。
 * 分析中的实时面板与结果页的过程回顾区共用。
 */
export function AnalysisProcessBlocks(props: AnalysisProcessBlocksProps) {
  return (
    <>
      {props.blocks.map((block, index) => {
        if (block.kind === 'attempt') {
          return (
            <div key={index} className="requirement-process-attempt" role="separator">
              <span>{block.reason}</span>
            </div>
          )
        }
        if (block.kind === 'notice') {
          return (
            <p key={index} className="requirement-process-notice">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>{block.text}</span>
            </p>
          )
        }
        if (block.kind === 'content') {
          return (
            <details key={index} className="requirement-process-content">
              <summary>正文输出</summary>
              <pre>{block.text}</pre>
            </details>
          )
        }
        return (
          <p key={index} className="requirement-process-reasoning">
            {block.text}
          </p>
        )
      })}
    </>
  )
}
