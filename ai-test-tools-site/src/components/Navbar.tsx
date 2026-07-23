import { NavLink, Link, useLocation } from 'react-router-dom'
import { Settings, Wrench, BookOpen } from 'lucide-react'
import { Tooltip } from './ui/Tooltip'

const navItems = [
  { to: '/#tools', label: '工具', icon: Wrench, external: false },
  { to: '#', label: '文档', icon: BookOpen, external: true },
]

export function Navbar() {
  const location = useLocation()

  return (
    <nav className="sticky top-3 z-50 px-4 max-sm:top-2 max-sm:px-3">
      {/* 悬浮玻璃胶囊：liquid-glass 质感 + 圆角胶囊 + 页面两侧留白 */}
      <div className="liquid-glass mx-auto flex max-w-[1100px] items-center justify-between gap-3 rounded-full py-2 pl-4 pr-2 max-sm:pl-3 max-sm:pr-1.5">
        {/* Logo */}
        <Link to="/" className="group flex items-center gap-2.5 no-underline">
          <div className="brand-mark flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold tracking-tight text-white">
            AI
          </div>
          <span className="font-display text-lg font-semibold tracking-[-0.035em] text-fg">
            AI测试工具
          </span>
        </Link>

        {/* Navigation */}
        <ul className="flex list-none items-center gap-1 rounded-full border border-white/60 bg-white/50 p-1 shadow-[0_16px_36px_-30px_oklch(0.18_0.02_235/0.5)]">
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
        </ul>
      </div>
    </nav>
  )
}
