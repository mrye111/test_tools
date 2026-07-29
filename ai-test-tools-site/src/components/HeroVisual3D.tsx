import { useRef } from 'react'
import { motion, useMotionValue, useSpring } from 'motion/react'

/**
 * Hero 右侧 3D 视觉：参考图的面板组合在透视空间中重建——
 * 主卡「AI 生成中」在前，折线图卡与环图卡退居后层，全部向左侧倾斜，
 * 底部有透视压扁的展台。整体慢速摇摆呼吸 + 鼠标视差（弹簧阻尼）。
 * 纯 CSS 3D transform，合成器驱动；内部动画（进度条/清单/球体脉冲）照旧循环。
 */

const steps = ['生成测试脚本', '设计测试用例', '执行测试', '分析测试数据', '生成测试报告']

export function HeroVisual3D() {
  const hostRef = useRef<HTMLDivElement>(null)
  // 鼠标视差：弹簧阻尼，±10° 以内，离开归零
  const rotateX = useSpring(useMotionValue(0), { stiffness: 50, damping: 18 })
  const rotateY = useSpring(useMotionValue(0), { stiffness: 50, damping: 18 })

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return
    rotateY.set(((e.clientX - rect.left) / rect.width - 0.5) * 10)
    rotateX.set(-((e.clientY - rect.top) / rect.height - 0.5) * 8)
  }

  function handlePointerLeave() {
    rotateX.set(0)
    rotateY.set(0)
  }

  return (
    <div
      ref={hostRef}
      className="h3v"
      aria-hidden="true"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <motion.div className="h3v-scene" style={{ rotateX, rotateY }}>
        {/* 慢速摇摆层：与视差层分离，两个 transform 互不干扰 */}
        <div className="h3v-sway">
          {/* 后层：趋势折线图（右上，退后 90px） */}
          <div className="h3v-panel h3v-panel-chart">
            <svg viewBox="0 0 200 84" className="h3v-chart-svg">
              <polyline
                points="4,64 32,48 58,56 86,34 114,42 142,20 170,30 196,12"
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="142" cy="20" r="4.5" className="h3v-chart-dot" />
            </svg>
          </div>

          {/* 后层：环图 + 代码行（右下，退后 50px） */}
          <div className="h3v-panel h3v-panel-donut">
            <svg viewBox="0 0 64 64" className="h3v-donut-svg">
              <circle cx="32" cy="32" r="24" className="h3v-donut-bg" />
              <circle cx="32" cy="32" r="24" className="h3v-donut-fg" />
            </svg>
            <div className="h3v-donut-lines">
              <span className="w-full" />
              <span className="w-[72%]" />
              <span className="w-[52%]" />
            </div>
          </div>

          {/* 主卡：AI 生成面板（前排，前移 70px） */}
          <div className="h3v-panel h3v-panel-main">
            <div className="h3v-main-head">
              <span className="h3v-status">AI 生成中</span>
              <span className="h3v-dots"><i /><i /><i /></span>
            </div>
            <div className="h3v-progress"><i /></div>
            <div className="h3v-body">
              <ul className="h3v-steps">
                {steps.map((s, i) => (
                  <li key={s} style={{ animationDelay: `${0.6 + i * 0.55}s` }}>
                    <span className="h3v-check" />
                    {s}
                  </li>
                ))}
              </ul>
              {/* 球体再向前探出 40px，层次从面板里「长」出来 */}
              <div className="h3v-orb-wrap">
                <span className="h3v-orb-ring" />
                <div className="h3v-orb">AI</div>
              </div>
            </div>
          </div>

          {/* 透视压扁的展台 */}
          <div className="h3v-platform" />
        </div>
      </motion.div>
    </div>
  )
}
