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
    <nav className="glass-nav sticky top-0 z-50">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3 max-sm:px-3">
        {/* Logo */}
        <Link to="/" className="group flex items-center gap-3 no-underline">
          <div className="brand-mark flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold tracking-tight text-white">
            AI
          </div>
          <span className="font-display text-lg font-semibold tracking-[-0.035em] text-fg">
            AI测试工具
          </span>
        </Link>

        {/* Navigation */}
        <ul className="flex list-none items-center gap-1 rounded-full border border-[oklch(0.92_0.008_260/0.64)] bg-white/54 p-1 shadow-[0_16px_36px_-30px_oklch(0.18_0.02_262/0.5)] backdrop-blur">
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
