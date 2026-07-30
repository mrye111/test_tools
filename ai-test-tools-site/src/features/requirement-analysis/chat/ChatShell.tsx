import { Outlet } from 'react-router-dom'
import { ChatSidebar } from './ChatSidebar'

/**
 * 聊天工作台壳：左侧边栏 + 主内容区。
 * 需求分析前缀下隐藏主站导航，由独立侧边栏提供 Logo 回首页与一级导航。
 */
export function ChatShell() {
  return (
    <div className="fixed inset-0 z-10 flex bg-[oklch(0.98_0.006_262)]">
      <ChatSidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
