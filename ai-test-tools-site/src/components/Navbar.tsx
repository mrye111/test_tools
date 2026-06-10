import { Link } from 'react-router-dom'
import { Settings } from 'lucide-react'

export function Navbar() {
  return (
    <nav className="glass-nav sticky top-0 z-50">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3.5 max-sm:px-3">
        <Link to="/" className="group flex items-center gap-3 no-underline">
          <div className="brand-mark flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold tracking-tight text-white transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]">
            AI
          </div>
          <span className="font-display text-lg font-semibold tracking-[-0.03em] text-fg">
            AI测试工具
          </span>
        </Link>
        <ul className="flex list-none items-center gap-2 rounded-full border border-white/70 bg-white/58 p-1 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.6)] max-sm:gap-0.5">
          <li>
            <Link to="/#tools" className="rounded-full px-3 py-1.5 text-sm text-muted transition-all duration-200 hover:bg-white hover:text-fg max-sm:px-2 max-sm:text-xs">
              工具
            </Link>
          </li>
          <li>
            <a href="#" className="rounded-full px-3 py-1.5 text-sm text-muted transition-all duration-200 hover:bg-white hover:text-fg max-sm:px-2 max-sm:text-xs">
              文档
            </a>
          </li>
          <li>
            <a href="#" className="rounded-full px-3 py-1.5 text-sm text-muted transition-all duration-200 hover:bg-white hover:text-fg max-sm:hidden">
              定价
            </a>
          </li>
          <li>
            <Link to="/settings" className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted transition-all duration-200 hover:bg-white hover:text-fg max-sm:px-2 max-sm:text-xs">
              <Settings className="h-4 w-4" />
              设置
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  )
}
