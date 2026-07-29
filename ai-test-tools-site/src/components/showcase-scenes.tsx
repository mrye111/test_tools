import { memo } from 'react'
import { ArrowRight, FileText } from 'lucide-react'

/**
 * 工作流演示区的四个操作场景。全部 CSS keyframes 驱动（transform/opacity/clip-path），
 * 每个场景 8.5–9.5s 一个循环：操作发生 → 结果呈现 → 整体淡出 → 重来。
 * 时间轴由各自的 animation-delay 编排，reduced-motion 由 CSS 定格帧兜底。
 */

/* ── 场景一：脚本生成（对话 → 工具调用 → 代码落盘） ─────────── */

const JMETER_CALLS = ['template.select', 'params.fill', 'jmx.build']
const JMETER_CODE = ['w-[78%]', 'w-[56%]', 'w-[68%]', 'w-[44%]']

export const SceneJmeter = memo(function SceneJmeter() {
  return (
    <div className="scn">
      <div className="scn-prompt">
        <span className="scn-prompt-text" style={{ animationDuration: '9.5s' }}>
          为秒杀接口生成 200 并发压测脚本
        </span>
      </div>
      <div className="scn-calls">
        {JMETER_CALLS.map((c, i) => (
          <span key={c} className="scn-call" style={{ animationDelay: `${1.7 + i * 0.9}s`, animationDuration: '9.5s' }}>
            <i className="scn-call-run" style={{ animationDelay: `${1.75 + i * 0.9}s`, animationDuration: '9.5s' }} />
            <i className="scn-call-done" style={{ animationDelay: `${2.3 + i * 0.9}s`, animationDuration: '9.5s' }} />
            {c}
          </span>
        ))}
      </div>
      <div className="scn-code">
        {JMETER_CODE.map((w, i) => (
          <span
            key={i}
            className={`scn-code-line ${w} ${i === 1 ? 'scn-code-line--accent' : ''}`}
            style={{ animationDelay: `${4.6 + i * 0.38}s`, animationDuration: '9.5s' }}
          />
        ))}
      </div>
      <span className="scn-done-chip" style={{ animationDelay: '6.6s', animationDuration: '9.5s' }}>
        test-plan.jmx 已生成
      </span>
    </div>
  )
})

/* ── 场景二：用例设计（需求进 → 用例行逐条流出） ────────────── */

const CASE_ROWS = [
  { w: 'w-[62%]', p: 'P0' },
  { w: 'w-[54%]', p: 'P0' },
  { w: 'w-[70%]', p: 'P1' },
  { w: 'w-[48%]', p: 'P1' },
  { w: 'w-[58%]', p: 'P2' },
]

export const SceneTestcase = memo(function SceneTestcase() {
  return (
    <div className="scn">
      <div className="scn-prompt">
        <span className="scn-prompt-text" style={{ animationDuration: '8.5s' }}>
          为登录接口补充边界值与异常流用例
        </span>
      </div>
      <div className="scn-table">
        <div className="scn-tr scn-tr--head" style={{ animationDelay: '1.5s', animationDuration: '8.5s' }}>
          <span className="scn-bar w-[30%]" />
          <span className="scn-bar ml-auto w-[14%]" />
          <span className="scn-bar w-[18%]" />
        </div>
        {CASE_ROWS.map((r, i) => (
          <div key={i} className="scn-tr" style={{ animationDelay: `${2 + i * 0.5}s`, animationDuration: '8.5s' }}>
            <span className={`scn-bar ${r.w}`} />
            <span className={`scn-prio ${r.p === 'P0' ? 'scn-prio--p0' : ''}`}>{r.p}</span>
            <span className="scn-bar ml-auto w-[16%]" />
          </div>
        ))}
      </div>
    </div>
  )
})

/* ── 场景三：需求分析（文档进 → 脑图生长 → 风险标注） ────────── */

const REQ_BRANCHES = [
  { left: '78%', top: '26%', angle: '-49deg' },
  { left: '86%', top: '60%', angle: '3deg' },
  { left: '60%', top: '92%', angle: '74deg' },
]
const REQ_RISKS = [
  { text: '风险：并发超卖', left: '58%', top: '12%' },
  { text: '歧义：超时未定义', left: '62%', top: '78%' },
]

export const SceneRequirement = memo(function SceneRequirement() {
  return (
    <div className="scn">
      <span className="scn-doc" style={{ animationDelay: '0.2s', animationDuration: '8.5s' }}>
        <FileText className="h-3 w-3" />
        需求文档 v2.3.pdf
      </span>
      {REQ_BRANCHES.map((b, i) => (
        <span
          key={`l-${i}`}
          className="scn-link"
          style={{ ['--r' as string]: b.angle, animationDelay: `${0.9 + i * 0.3}s`, animationDuration: '8.5s' }}
        />
      ))}
      {REQ_BRANCHES.map((b, i) => (
        <span
          key={`n-${i}`}
          className="scn-node"
          style={{ left: b.left, top: b.top, animationDelay: `${1.15 + i * 0.3}s`, animationDuration: '8.5s' }}
        />
      ))}
      <span className="scn-node scn-node--center" style={{ animationDelay: '0.55s', animationDuration: '8.5s' }} />
      {REQ_RISKS.map((r, i) => (
        <span
          key={`r-${i}`}
          className="scn-risk"
          style={{ left: r.left, top: r.top, animationDelay: `${2.2 + i * 0.45}s`, animationDuration: '8.5s' }}
        >
          {r.text}
        </span>
      ))}
    </div>
  )
})

/* ── 场景四：报告可视化（双文件汇入 → 仪表盘呈现） ───────────── */

const REPORT_BARS = [50, 82, 64]

export const SceneReport = memo(function SceneReport() {
  return (
    <div className="scn">
      <div className="scn-files">
        <span className="scn-file" style={{ animationDelay: '0.25s', animationDuration: '8.5s' }}>用例.xlsx</span>
        <span className="scn-file" style={{ animationDelay: '0.7s', animationDuration: '8.5s' }}>BUG.csv</span>
        <ArrowRight className="scn-file-arrow" style={{ animationDelay: '1.3s', animationDuration: '8.5s' }} />
      </div>
      <div className="scn-dash" style={{ animationDelay: '2s', animationDuration: '8.5s' }}>
        <div className="scn-dash-bars">
          {REPORT_BARS.map((h, i) => (
            <span
              key={i}
              className={`scn-dash-bar ${i === 1 ? 'scn-dash-bar--accent' : ''}`}
              style={{ height: `${h}%`, animationDelay: `${2.6 + i * 0.3}s`, animationDuration: '8.5s' }}
            />
          ))}
        </div>
        <svg viewBox="0 0 64 64" className="scn-donut" aria-hidden="true">
          <circle cx="32" cy="32" r="26" className="scn-donut-bg" />
          <circle
            cx="32"
            cy="32"
            r="26"
            className="scn-donut-fg"
            style={{ animationDelay: '3s', animationDuration: '8.5s' }}
          />
        </svg>
        <div className="scn-dash-legend" style={{ animationDelay: '3.7s', animationDuration: '8.5s' }}>
          <span className="scn-bar w-full" />
          <span className="scn-bar w-[72%]" />
        </div>
      </div>
    </div>
  )
})
