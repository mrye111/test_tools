import { motion } from 'motion/react'
import { Hero } from '../components/Hero'
import { ShowcaseSection } from '../components/ShowcaseSection'
import { ToolsSection } from '../components/ToolsSection'
import { Footer } from '../components/Footer'

// 能力跑马灯关键词
const capabilities = [
  'AI 脚本生成',
  '用例设计',
  '数据工厂',
  '需求分析',
  '报告可视化',
  'JMeter 模板',
  '编码解码',
  'JSON 工具',
]

export function HomePage() {
  return (
    <>
      <Hero />

      {/* 能力跑马灯：上探入 Hero 渐隐区（-mt-16 + z-10），把深色舞台与浅色内容缝成一体；
          绘制玻璃带（无 backdrop-blur），内容渲染两遍实现无缝循环，hover 暂停；
          随滚动淡入，作为 Hero 与工具矩阵之间的过渡节拍 */}
      <motion.section
        aria-label="平台能力"
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '0px 0px -8% 0px' }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 -mt-16 mb-14 w-full overflow-hidden border-y border-white/55 bg-gradient-to-b from-white/62 to-white/42 py-4 shadow-[0_20px_48px_-32px_oklch(0.3_0.08_262/0.4)]"
      >
        <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
          {[0, 1].map((copy) => (
            <div key={copy} aria-hidden={copy === 1} className="flex items-center">
              {capabilities.map((cap) => (
                <span key={cap} className="mx-3 flex items-center gap-6 whitespace-nowrap">
                  <span className="font-display text-sm font-medium tracking-wide text-muted">
                    {cap}
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
              ))}
            </div>
          ))}
        </div>
        {/* 两侧渐隐遮罩 */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-bg to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-bg to-transparent" />
      </motion.section>

      {/* 工作流演示：Tab 切换四个工具的实操场景（QoderWork 式） */}
      <ShowcaseSection />

      <ToolsSection />
      <Footer />
    </>
  )
}
