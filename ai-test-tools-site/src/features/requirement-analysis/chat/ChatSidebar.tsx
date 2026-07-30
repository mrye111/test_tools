import { useEffect, useState, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { MessageSquare, Library } from 'lucide-react'
import { listSessions, getLibraryCount, type ChatSession } from './chat-api'

/** 将时间差格式化为相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）。 */
function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return '很久以前'
}

export function ChatSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [libraryCount, setLibraryCount] = useState(0)
  const [isBumping, setIsBumping] = useState(false)
  const [plusOneVisible, setPlusOneVisible] = useState(false)

  const loadSessions = useCallback(async () => {
    try {
      const data = await listSessions()
      setSessions(data.slice(0, 50))
    } catch (error) {
      // 会话列表加载失败时静默兜底，避免阻塞左侧栏核心导航
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  const loadLibraryCount = useCallback(async () => {
    try {
      const count = await getLibraryCount()
      setLibraryCount(count)
    } catch (error) {
      setLibraryCount(0)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setSessionsLoading(true)
    Promise.all([loadSessions(), loadLibraryCount()]).finally(() => {
      if (!cancelled) setSessionsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [loadSessions, loadLibraryCount])

  useEffect(() => {
    const handleLibraryCount = (event: Event) => {
      const customEvent = event as CustomEvent<{ count?: number }>
      const nextCount = Number(customEvent.detail?.count ?? 0)
      setLibraryCount(nextCount)
      setIsBumping(true)
      setPlusOneVisible(true)
      window.setTimeout(() => setPlusOneVisible(false), 600)
      window.setTimeout(() => setIsBumping(false), 300)
    }
    window.addEventListener('ra-library-count', handleLibraryCount)
    return () => window.removeEventListener('ra-library-count', handleLibraryCount)
  }, [])

  const isNewChatActive = location.pathname === '/requirement-analysis'
  const isLibraryActive = location.pathname === '/requirement-analysis/library'

  return (
    <aside className="flex h-full w-[260px] flex-col border-r border-[oklch(0.9_0.012_264/0.7)] bg-[oklch(0.99_0.004_264/0.82)] p-4">
      {/* Logo：点击返回主站首页 */}
      <Link to="/" className="group flex items-center gap-2.5 no-underline">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-sm font-bold tracking-tight text-white shadow-[0_12px_28px_-14px_oklch(0.58_0.17_262/0.7),inset_0_1px_0_oklch(1_0_0/0.32)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:-rotate-3">
          AI
        </div>
        <span className="font-display text-lg font-semibold tracking-[-0.035em] text-fg">
          AI测试工具
        </span>
      </Link>

      <nav className="mt-6 flex flex-col gap-1">
        {/* 新聊天 */}
        <button
          type="button"
          onClick={() => navigate('/requirement-analysis')}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
            isNewChatActive
              ? 'bg-[oklch(0.58_0.17_262/0.1)] text-accent'
              : 'text-fg hover:bg-[oklch(0.58_0.17_262/0.06)]'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          新聊天
        </button>

        {/* 文件库：右侧徽章显示数量 */}
        <button
          type="button"
          onClick={() => navigate('/requirement-analysis/library')}
          className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
            isLibraryActive
              ? 'bg-[oklch(0.58_0.17_262/0.1)] text-accent'
              : 'text-fg hover:bg-[oklch(0.58_0.17_262/0.06)]'
          }`}
        >
          <span className="flex items-center gap-3">
            <Library className="h-4 w-4" />
            文件库
          </span>
          <span className={`chat-sidebar-count relative inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold transition-transform ${
            isLibraryActive
              ? 'bg-accent text-white'
              : 'bg-[oklch(0.58_0.17_262/0.1)] text-accent'
          } ${isBumping ? 'is-bumping' : ''}`}>
            {libraryCount}
            {plusOneVisible && (
              <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white"
              >
                +1
              </span>
            )}
          </span>
        </button>
      </nav>

      <div className="mt-6 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">最近</span>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto">
        {sessionsLoading ? (
          <div className="px-1 py-3 text-xs text-muted">加载中…</div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[oklch(0.9_0.012_264/0.7)] bg-[oklch(1_0_0/0.5)] px-4 py-8 text-center">
            <p className="text-sm text-muted">还没有会话</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {sessions.map((session) => {
              const isActive = location.pathname === `/requirement-analysis/chat/${session.id}`
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/requirement-analysis/chat/${session.id}`)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? 'bg-[oklch(0.58_0.17_262/0.1)] text-accent'
                        : 'text-fg hover:bg-[oklch(0.58_0.17_262/0.06)]'
                    }`}
                  >
                    <div className="truncate text-sm font-medium">{session.title}</div>
                    <div className="mt-0.5 text-xs text-muted">{formatRelativeTime(session.updatedAt)}</div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
