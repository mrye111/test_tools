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
    } catch (_error) {
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
    } catch (_error) {
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
    <aside className="ra-chat-sidebar">
      <Link to="/" className="ra-chat-sidebar-logo">
        <div className="ra-chat-sidebar-logo-icon">
          AI
        </div>
        <span className="ra-chat-sidebar-logo-text">
          AI测试工具
        </span>
      </Link>

      <nav className="ra-chat-sidebar-nav">
        <button
          type="button"
          onClick={() => navigate('/requirement-analysis')}
          className={`ra-chat-sidebar-item${isNewChatActive ? ' is-active' : ''}`}
        >
          <MessageSquare className="h-4 w-4" />
          新聊天
        </button>

        <button
          type="button"
          onClick={() => navigate('/requirement-analysis/library')}
          className={`ra-chat-sidebar-item${isLibraryActive ? ' is-active' : ''}`}
        >
          <span className="ra-chat-sidebar-item-main">
            <Library className="h-4 w-4" />
            文件库
          </span>
          <span className={`ra-chat-sidebar-count${isLibraryActive ? ' is-active' : ''}${isBumping ? ' is-bumping' : ''}`}>
            {libraryCount}
            {plusOneVisible && (
              <span className="ra-chat-sidebar-count-plus">
                +1
              </span>
            )}
          </span>
        </button>
      </nav>

      <div className="ra-chat-sidebar-section-title">最近</div>

      <div className="ra-chat-sidebar-list">
        {sessionsLoading ? (
          <div className="ra-chat-sidebar-loading">加载中…</div>
        ) : sessions.length === 0 ? (
          <div className="ra-chat-sidebar-empty">
            <p>还没有会话</p>
          </div>
        ) : (
          sessions.map((session) => {
            const isActive = location.pathname === `/requirement-analysis/chat/${session.id}`
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => navigate(`/requirement-analysis/chat/${session.id}`)}
                className={`ra-chat-sidebar-session${isActive ? ' is-active' : ''}`}
              >
                <div className="ra-chat-sidebar-session-title">{session.title}</div>
                <div className="ra-chat-sidebar-session-time">{formatRelativeTime(session.updatedAt)}</div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
