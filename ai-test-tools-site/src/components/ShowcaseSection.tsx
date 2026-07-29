import { useEffect, useRef, useState } from 'react'
import { cubicBezier, motion, useInView } from 'motion/react'
import type { ComponentType } from 'react'
import type { Variants } from 'motion/react'
import { BarChart3, FileSearch, FileText, Gauge } from 'lucide-react'
import { SceneJmeter, SceneRequirement, SceneReport, SceneTestcase } from './showcase-scenes'

const EASE_OUT_EXPO = cubicBezier(0.16, 1, 0.3, 1)
// 与场景循环时长（8.5–9.5s）对齐：让每个故事基本讲完再翻页
const AUTOPLAY_MS = 9000
const TRACK_GAP = 24
const PANEL_MAX_W = 880

interface ShowcaseTab {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  badge: string
  title: string
  desc: string
  pain: string
  solution: string
  Scene: ComponentType
}

const tabs: ShowcaseTab[] = [
  {
    id: 'jmeter',
    label: '脚本生成',
    icon: Gauge,
    badge: '半天 → 3 分钟',
    title: '一句话生成 JMeter 压测脚本',
    desc: '描述压测场景，AI 自动匹配协议模板、填充参数并组装测试计划，直接导出可运行的 .jmx 文件。',
    pain: '手写 XML 元素树、翻文档拼采样器参数，一个脚本半天起步。',
    solution: '自然语言描述场景，AI 选模板、填参数、出脚本，三分钟交付。',
    Scene: SceneJmeter,
  },
  {
    id: 'testcase',
    label: '用例设计',
    icon: FileText,
    badge: '2 天 → 5 分钟',
    title: 'AI 批量产出高覆盖测试用例',
    desc: '贴入需求或接口文档，AI 按等价类、边界值、异常流批量生成用例，按项目归档，支持 Excel / XMind 一键导出。',
    pain: '逐条脑暴边界场景，覆盖率全凭经验，评审返工是常态。',
    solution: '需求进、用例出，按项目归档管理，随时回看与导出。',
    Scene: SceneTestcase,
  },
  {
    id: 'requirement',
    label: '需求分析',
    icon: FileSearch,
    badge: '1 天 → 2 分钟',
    title: '需求文档秒变测试视角脑图',
    desc: '上传 PRD，AI 自动拆解功能树、识别歧义点并标注风险项，分析过程实时可见。',
    pain: '通读几十页 PRD 手动梳理功能点，遗漏风险全靠运气。',
    solution: '文档进、脑图出，功能树与风险结论结构化呈现。',
    Scene: SceneRequirement,
  },
  {
    id: 'report',
    label: '报告可视化',
    icon: BarChart3,
    badge: '1 天 → 1 分钟',
    title: '两份文件生成质量分析报告',
    desc: '导入测试用例与 BUG 数据，自动汇总执行进度、缺陷分布与质量结论，图表即导即用。',
    pain: 'Excel 里手工透视用例与缺陷，图表样式来回调。',
    solution: '用例 + BUG 文件导入，可视化报告自动产出。',
    Scene: SceneReport,
  },
]

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT_EXPO } },
}

const tabBar: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
}

// 水平走马灯：当前面板居中，上一张/下一张在左右各露出一截；
// 切换是整条轨道的横向滑行，不是上下弹入
export function ShowcaseSection() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportW, setViewportW] = useState(0)
  const inView = useInView(sectionRef, { once: true, margin: '0px 0px -15% 0px' })

  // 轨道位移用像素计算：面板定宽，(视口宽 - 面板宽) / 2 让当前面板居中
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setViewportW(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const panelW = viewportW ? Math.min(PANEL_MAX_W, viewportW * 0.86) : PANEL_MAX_W
  // 轨道首位各有一张克隆（末张克隆在最前、首张克隆在最后），首尾也能看到循环衔接的半张
  const trackX = viewportW ? (viewportW - panelW) / 2 - (active + 1) * (panelW + TRACK_GAP) : 0

  // 轨道：末张克隆 + 四张正片 + 首张克隆；克隆张点击跳转到对应正片
  const slides = [
    { t: tabs[tabs.length - 1], realIndex: tabs.length - 1, isClone: true, key: 'clone-head' },
    ...tabs.map((t, i) => ({ t, realIndex: i, isClone: false, key: t.id })),
    { t: tabs[0], realIndex: 0, isClone: true, key: 'clone-tail' },
  ]

  useEffect(() => {
    if (paused || !inView) return
    const timer = window.setTimeout(() => {
      setActive((a) => (a + 1) % tabs.length)
    }, AUTOPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [active, paused, inView])

  const tab = tabs[active]

  return (
    <section
      ref={sectionRef}
      aria-label="工作流演示"
      data-paused={paused || undefined}
      className="py-20 max-sm:py-14"
    >
      {/* Tab 胶囊：激活底色用 layoutId 滑动迁移，底部细条显示自动轮播进度 */}
      <motion.div
        variants={tabBar}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '0px 0px -15% 0px' }}
        className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-center gap-2 px-6"
      >
        {tabs.map((t, i) => (
          <motion.button
            key={t.id}
            type="button"
            variants={rise}
            onClick={() => setActive(i)}
            aria-pressed={i === active}
            className={`sc-tab ${i === active ? 'sc-tab--active' : ''}`}
          >
            {i === active && (
              <motion.span
                layoutId="sc-tab-bg"
                className="sc-tab-bg"
                transition={{ type: 'spring', stiffness: 340, damping: 32 }}
              />
            )}
            <span className="sc-tab-label">
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </span>
            {i === active && (
              <span key={`progress-${active}`} className="sc-tab-progress" style={{ animationDuration: `${AUTOPLAY_MS}ms` }} />
            )}
          </motion.button>
        ))}
      </motion.div>

      {/* 走马灯视口：全宽出血，悬停暂停自动轮播 */}
      <motion.div
        ref={viewportRef}
        role="group"
        aria-label={`${tab.label}（${active + 1} / ${tabs.length}）`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '0px 0px -15% 0px' }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="mt-10 w-full overflow-hidden"
      >
        <motion.div
          className="flex items-stretch"
          style={{ gap: TRACK_GAP }}
          initial={false}
          animate={{ x: trackX }}
          transition={{ duration: 0.8, ease: EASE_OUT_EXPO }}
        >
          {slides.map((s) => {
            const isActive = !s.isClone && s.realIndex === active
            return (
              <motion.div
                key={s.key}
                animate={{ opacity: isActive ? 1 : 0.45, scale: isActive ? 1 : 0.96 }}
                transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
                onClick={isActive ? undefined : () => setActive(s.realIndex)}
                className={`shrink-0 ${isActive ? '' : 'cursor-pointer'}`}
                style={{ width: panelW }}
                aria-hidden={!isActive}
              >
                <div className="sc-panel" style={{ pointerEvents: isActive ? 'auto' : 'none' }}>
                  {/* 左：文案 */}
                  <div className="sc-panel-text">
                    <span className="sc-badge">效率提升：{s.t.badge}</span>
                    <h3 className="sc-title">{s.t.title}</h3>
                    <p className="sc-desc">{s.t.desc}</p>
                    <div className="sc-compare">
                      <div className="sc-compare-row">
                        <span className="sc-compare-label">传统痛点</span>
                        <p>{s.t.pain}</p>
                      </div>
                      <div className="sc-compare-row">
                        <span className="sc-compare-label sc-compare-label--accent">AI 测试工具</span>
                        <p>{s.t.solution}</p>
                      </div>
                    </div>
                  </div>

                  {/* 右：操作场景（成为当前张时从头重播，演示永远从第一帧开始） */}
                  <div className="sc-window-col">
                    <div className="sc-window" aria-hidden="true">
                      <div className="sc-window-bar">
                        <i /><i /><i />
                        <span className="sc-window-title">aitest.tools · {s.t.label}</span>
                      </div>
                      <div className="sc-window-body">
                        <s.t.Scene key={s.isClone ? s.key : isActive ? `active-${active}` : `idle-${s.t.id}`} />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      </motion.div>
    </section>
  )
}
