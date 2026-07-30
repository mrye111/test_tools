import { useEffect } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { Settings, Wrench, BookOpen } from 'lucide-react'
import { Tooltip } from './ui/Tooltip'

const navItems = [
  { to: '/#tools', label: '工具', icon: Wrench, external: false },
  { to: '#', label: '文档', icon: BookOpen, external: true },
]

// 滚动收缩曲线：前 160px 滚动映射为 0→1 进度
const SCRUB_RANGE = 160

export function Navbar() {
  const location = useLocation()

  // 需求分析工作台（聊天、文件库、分析画板）为纯净画布形态（ADR 0006）：隐藏全局导航，避免与侧边栏/画布悬浮控件叠加
  const isWorkspaceRoute = location.pathname.startsWith('/requirement-analysis')

  // 滚动进度 0→1，spring 抹平滚轮/触控板的阶梯输入，宽度与玻璃质感随进度连续插值
  const scrollProgress = useMotionValue(0)
  const progress = useSpring(scrollProgress, { stiffness: 320, damping: 34, mass: 0.7 })

  useEffect(() => {
    const onScroll = () => {
      scrollProgress.set(Math.min(1, Math.max(0, window.scrollY / SCRUB_RANGE)))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [scrollProgress])

  // 宽度：1200px → 880px 连续收窄
  const maxWidth = useTransform(progress, [0, 1], [1200, 880])
  // 玻璃质感：透明度 0→1 淡入（背景 / 边框 / 投影同源驱动）
  const barBg = useTransform(progress, (v) => `oklch(1 0 0 / ${(v * 0.72).toFixed(3)})`)
  const barBorder = useTransform(progress, (v) => `oklch(1 0 0 / ${(v * 0.66).toFixed(3)})`)
  const barShadow = useTransform(
    progress,
    (v) =>
      `0 18px 44px -26px oklch(0.45 0.14 262 / ${(v * 0.35).toFixed(3)}), inset 0 1px 0 oklch(1 0 0 / ${(v * 0.85).toFixed(3)})`,
  )
  const barBlur = useTransform(progress, (v) => `blur(${(v * 16).toFixed(1)}px) saturate(${(1 + v * 0.5).toFixed(3)})`)
  // 链接组胶囊：同步淡入
  const groupBg = useTransform(progress, (v) => `oklch(1 0 0 / ${(v * 0.5).toFixed(3)})`)
  const groupBorder = useTransform(progress, (v) => `oklch(1 0 0 / ${(v * 0.6).toFixed(3)})`)
  const groupShadow = useTransform(progress, (v) => `0 16px 36px -30px oklch(0.18 0.02 264 / ${(v * 0.5).toFixed(3)})`)

  if (isWorkspaceRoute) return null

  return (
    <nav className="sticky top-3 z-50 px-4 max-sm:top-2 max-sm:px-3">
      <motion.div
        className="mx-auto flex items-center justify-between gap-3 rounded-full border py-2 pl-4 pr-2 max-sm:pl-3 max-sm:pr-1.5"
        style={{
          maxWidth,
          backgroundColor: barBg,
          borderColor: barBorder,
          boxShadow: barShadow,
          backdropFilter: barBlur,
          WebkitBackdropFilter: barBlur,
        }}
      >
        {/* Logo */}
        <Link to="/" className="group flex items-center gap-2.5 no-underline">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-sm font-bold tracking-tight text-white shadow-[0_12px_28px_-14px_oklch(0.58_0.17_262/0.7),inset_0_1px_0_oklch(1_0_0/0.32)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:-rotate-3">
            AI
          </div>
          <span className="font-display text-lg font-semibold tracking-[-0.035em] text-fg">
            AI测试工具
          </span>
        </Link>

        {/* Navigation */}
        <motion.ul
          className="flex list-none items-center gap-1 rounded-full border p-1"
          style={{
            backgroundColor: groupBg,
            borderColor: groupBorder,
            boxShadow: groupShadow,
          }}
        >
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = !item.external && location.hash === '#tools' && item.label === '工具'

            if (item.external) {
              return (
                <li key={item.label}>
                  <Tooltip content={item.label === '文档' ? '使用文档与 API 参考' : ''}>
                    <a
                      href={item.to}
                      className={`nav-pill flex items-center gap-1.5 ${
                        isActive ? 'nav-pill-active' : ''
                      } max-sm:px-2`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="max-sm:hidden">{item.label}</span>
                    </a>
                  </Tooltip>
                </li>
              )
            }

            return (
              <li key={item.label}>
                <Tooltip content="探索全部测试工具">
                  <NavLink
                    to={item.to}
                    className={({ isActive: active }) =>
                      `nav-pill flex items-center gap-1.5 ${active ? 'nav-pill-active' : ''} max-sm:px-2`
                    }
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="max-sm:hidden">{item.label}</span>
                  </NavLink>
                </Tooltip>
              </li>
            )
          })}

          <li>
            <Tooltip content="AI 模型与偏好设置">
              <Link
                to="/settings"
                className={`nav-pill flex items-center gap-1.5 ${
                  location.pathname === '/settings' ? 'nav-pill-active' : ''
                } max-sm:px-2`}
              >
                <Settings className="h-3.5 w-3.5" />
                <span className="max-sm:hidden">设置</span>
              </Link>
            </Tooltip>
          </li>
        </motion.ul>
      </motion.div>
    </nav>
  )
}
