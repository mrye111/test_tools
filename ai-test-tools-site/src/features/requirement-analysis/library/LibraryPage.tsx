/**
 * 文件库页：展示已保存的库文件卡片网格，支持搜索、打开、删除。
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileStack, Search, Trash2 } from 'lucide-react'
import { listLibraryFiles, deleteLibraryFile, type LibraryFile } from '../chat/chat-api'
import { AGENT_TEMPLATES } from '../chat/agent-templates'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'

function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = date.getUTCFullYear()
  const m = pad(date.getUTCMonth() + 1)
  const d = pad(date.getUTCDate())
  const h = pad(date.getUTCHours())
  const min = pad(date.getUTCMinutes())
  return `${y}-${m}-${d} ${h}:${min}`
}

export function LibraryPage() {
  const navigate = useNavigate()
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listLibraryFiles()
      .then((data) => {
        if (cancelled) return
        setFiles(data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载文件库失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filteredFiles = useMemo(() => {
    if (!query.trim()) return files
    const q = query.trim().toLowerCase()
    return files.filter((file) => file.title.toLowerCase().includes(q))
  }, [files, query])

  const handleOpen = (file: LibraryFile) => {
    navigate(`/requirement-analysis/board/${file.id}?from=library`)
  }

  const handleConfirmDelete = async () => {
    if (!deletingId) return
    const id = deletingId
    setDeletingId(null)
    try {
      await deleteLibraryFile(id)
      setFiles((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const total = files.length

  if (loading) {
    return (
      <div className="ra-chat-library-page">
        <div className="ra-chat-library-loading">
          <span className="ra-chat-library-spinner" />
          <p>正在加载文件库…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ra-chat-library-page">
        <div className="ra-chat-library-empty">
          <p className="ra-chat-library-empty-title" role="alert">
            {error}
          </p>
        </div>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="ra-chat-library-page">
        <div className="ra-chat-library-empty">
          <div className="ra-chat-library-empty-icon">
            <FileStack className="h-16 w-16" />
          </div>
          <p className="ra-chat-library-empty-title">还没有保存的文件</p>
          <p className="ra-chat-library-empty-desc">去新聊天生成并保存，即可在这里查看。</p>
          <button
            type="button"
            className="ra-chat-library-empty-button"
            onClick={() => navigate('/requirement-analysis')}
          >
            去新聊天
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ra-chat-library-page">
      <div className="ra-chat-library-header">
        <h1 className="ra-chat-library-title">文件库</h1>
        <span className="ra-chat-library-count">共 {total} 个文件</span>
        <div className="ra-chat-library-search">
          <Search className="ra-chat-library-search-icon" />
          <input
            type="text"
            className="ra-chat-library-search-input"
            placeholder="按标题搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="按标题搜索"
          />
        </div>
      </div>

      <div className="ra-chat-library-grid">
        {filteredFiles.map((file) => {
          const meta = AGENT_TEMPLATES.find((t) => t.kind === file.kind)
          const Icon = meta?.icon
          return (
            <div
              key={file.id}
              className="ra-chat-library-card"
              role="button"
              tabIndex={0}
              aria-label={`打开 ${file.title}`}
              onClick={() => handleOpen(file)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleOpen(file)
                }
              }}
            >
              <div className={`ra-chat-library-card-icon bg-gradient-to-br ${meta?.gradient ?? 'from-gray-400 to-gray-600'}`}>
                {Icon ? <Icon className="ra-chat-library-card-icon-svg" /> : null}
              </div>
              <button
                type="button"
                className="ra-chat-library-card-delete"
                aria-label={`删除 ${file.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setDeletingId(file.id)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <div className="ra-chat-library-card-info">
                <p className="ra-chat-library-card-title" title={file.title}>
                  {file.title}
                </p>
                <p className="ra-chat-library-card-kind">
                  {meta?.label ?? file.kind}
                </p>
                <p className="ra-chat-library-card-time">
                  {formatDateTime(file.updatedAt)}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {filteredFiles.length === 0 && query.trim() && (
        <div className="ra-chat-library-empty">
          <p className="ra-chat-library-empty-title">未找到匹配的文件</p>
        </div>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        title="确认删除"
        description={
          <>
            删除后无法恢复，是否确认删除「
            <strong>{files.find((f) => f.id === deletingId)?.title ?? ''}</strong>
            」？
          </>
        }
        danger
        confirmText="删除"
        onCancel={() => setDeletingId(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
