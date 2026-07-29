import { memo } from 'react'

/**
 * 工具卡底部的实时动画舞台。全部动画由 CSS keyframes 驱动（transform/opacity），
 * 不进 React 渲染循环；prefers-reduced-motion 由全局媒体查询统一关停。
 * 每个舞台是一个循环小故事：生长 → 停留 → 淡出 → 重来。
 */

const CODE_LINES = ['w-[74%]', 'w-[52%]', 'w-[66%]', 'w-[40%]']

/** JMeter 脚本：迷你编辑器，代码行逐行「敲」出来，光标常闪 */
const JmeterStage = memo(function JmeterStage() {
  return (
    <div className="ts-window">
      <div className="ts-window-bar">
        <i /><i /><i />
        <span className="ts-window-title">test-plan.jmx</span>
      </div>
      <div className="ts-editor">
        {CODE_LINES.map((w, i) => (
          <span
            key={i}
            className={`ts-code-line ${w} ${i === 1 ? 'ts-code-line--accent' : ''}`}
            style={{ animationDelay: `${i * 0.38}s` }}
          />
        ))}
        <span className="ts-caret" />
      </div>
    </div>
  )
})

/** 用例生成：清单逐行滑入、勾选弹章、底部进度条蓄满 */
const TestcaseStage = memo(function TestcaseStage() {
  return (
    <div className="ts-checklist">
      {[0, 1, 2].map((i) => (
        <div key={i} className="ts-check-row" style={{ animationDelay: `${i * 0.42}s` }}>
          <span className="ts-checkbox" style={{ animationDelay: `${i * 0.42 + 0.18}s` }} />
          <span className={`ts-row-bar ${i === 0 ? 'w-[68%]' : i === 1 ? 'w-[52%]' : 'w-[60%]'}`} />
        </div>
      ))}
      <div className="ts-progress"><i /></div>
    </div>
  )
})

const BARS = [46, 72, 58, 88, 64]

/** 测试报告：柱状图拔地而起，领头柱用主色 */
const ReportStage = memo(function ReportStage() {
  return (
    <div className="ts-chart">
      {BARS.map((h, i) => (
        <span
          key={i}
          className={`ts-bar ${i === 3 ? 'ts-bar--accent' : ''}`}
          style={{ height: `${h}%`, animationDelay: `${i * 0.22}s` }}
        />
      ))}
      <span className="ts-baseline" />
    </div>
  )
})

const STREAM_A = ['UUID', '138****2671', '张三', 'Base64', '0x3FA9', 'MD5']
const STREAM_B = ['JSON', 'nonce', '2026-07-27', 'HMAC', 'UTF-8', 'hex']

/** 数据工厂：两条数据流反向穿梭 */
const DataFactoryStage = memo(function DataFactoryStage() {
  return (
    <div className="ts-streams">
      {[STREAM_A, STREAM_B].map((stream, row) => (
        <div key={row} className={`ts-stream ${row === 1 ? 'ts-stream--reverse' : ''}`}>
          <div className="ts-stream-track">
            {[0, 1].map((copy) => (
              <div key={copy} className="ts-stream-group">
                {stream.map((chip) => (
                  <span key={`${copy}-${chip}`} className="ts-chip">{chip}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})

/** 需求分析：中心节点搏动，连线生长、分支节点弹出 */
const RequirementStage = memo(function RequirementStage() {
  const satellites = [
    { left: '18%', top: '24%', angle: '-136deg' },
    { left: '82%', top: '24%', angle: '-44deg' },
    { left: '20%', top: '80%', angle: '134deg' },
    { left: '80%', top: '80%', angle: '46deg' },
  ]
  return (
    <div className="ts-map">
      {satellites.map((s, i) => (
        <span
          key={`link-${i}`}
          className="ts-link"
          style={{ ['--r' as string]: s.angle, animationDelay: `${0.15 + i * 0.18}s` }}
        />
      ))}
      {satellites.map((s, i) => (
        <span
          key={`node-${i}`}
          className="ts-node"
          style={{ left: s.left, top: s.top, animationDelay: `${0.35 + i * 0.18}s` }}
        />
      ))}
      <span className="ts-pulse" />
      <span className="ts-node ts-node--center" />
    </div>
  )
})

const TOKENS = ['{', '"url"', ':', '"https://…"', '}']

/** 开发工具：JSON 令牌级联落入终端，光标常闪 */
const DevToolsStage = memo(function DevToolsStage() {
  return (
    <div className="ts-window">
      <div className="ts-window-bar">
        <i /><i /><i />
        <span className="ts-window-title">payload.json</span>
      </div>
      <div className="ts-terminal">
        {TOKENS.map((t, i) => (
          <span
            key={i}
            className={`ts-token ${i === 1 || i === 3 ? 'ts-token--accent' : ''}`}
            style={{ animationDelay: `${i * 0.24}s` }}
          >
            {t}
          </span>
        ))}
        <span className="ts-caret" />
      </div>
    </div>
  )
})

export function ToolStage({ id }: { id: string }) {
  switch (id) {
    case 'jmeter-script':
      return <JmeterStage />
    case 'testcase-generator':
      return <TestcaseStage />
    case 'test-report':
      return <ReportStage />
    case 'data-factory':
      return <DataFactoryStage />
    case 'requirement-analysis':
      return <RequirementStage />
    default:
      return <DevToolsStage />
  }
}
