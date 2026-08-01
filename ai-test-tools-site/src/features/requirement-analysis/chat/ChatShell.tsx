import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { ChatSidebar } from './ChatSidebar'
import { getStorageStatus } from './chat-api'

/**
 * 聊天工作台壳：左侧边栏 + 主内容区。
 * 需求分析前缀下隐藏主站导航，由独立侧边栏提供 Logo 回首页与一级导航。
 */
export function ChatShell() {
  const [storageMode, setStorageMode] = useState<'mysql' | 'memory' | null>(null)

  useEffect(() => {
    let cancelled = false
    getStorageStatus()
      .then((mode) => {
        if (!cancelled) setStorageMode(mode)
      })
      .catch(() => {
        if (!cancelled) setStorageMode(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-[oklch(0.98_0.006_262)]">
      {storageMode === 'memory' && (
        <div className="ra-chat-storage-banner" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>数据库不可用，本次会话内容不会持久保存</span>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <ChatSidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
