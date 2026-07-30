/**
 * 文件卡片：展示会话产物，支持打开画布与保存到文件库。
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveToLibrary } from './chat-api'
import { AGENT_TEMPLATES } from './agent-templates'
import type { SessionFileSummary } from './chat-api'

interface FileCardProps {
  file: SessionFileSummary & { savedToLibrary: boolean }
}

export function FileCard({ file }: FileCardProps) {
  const navigate = useNavigate()
  const [saved, setSaved] = useState(file.savedToLibrary)
  const [saving, setSaving] = useState(false)

  const meta = AGENT_TEMPLATES.find((t) => t.kind === file.kind)
  const Icon = meta?.icon

  const handleOpenBoard = () => {
    navigate(`/requirement-analysis/board/${file.sessionFileId}`)
  }

  const handleSave = async () => {
    if (saved || saving) return
    setSaving(true)
    try {
      const result = await saveToLibrary(file.sessionFileId)
      setSaved(true)
      window.dispatchEvent(
        new CustomEvent('ra-library-count', { detail: { count: result.libraryCount } }),
      )
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ra-chat-file-card" data-kind={file.kind} data-saved={saved}>
      <div className={`ra-chat-file-card-icon bg-gradient-to-br ${meta?.gradient ?? 'from-gray-400 to-gray-600'}`}>
        {Icon ? <Icon className="ra-chat-file-card-icon-svg" /> : null}
      </div>

      <div className="ra-chat-file-card-info">
        <p className="ra-chat-file-card-title">{file.title}</p>
        <p className="ra-chat-file-card-kind">{meta?.label ?? file.kind}</p>
      </div>

      <div className="ra-chat-file-card-actions">
        <button
          type="button"
          className="ra-chat-file-card-button ra-chat-file-card-button-open"
          onClick={handleOpenBoard}
        >
          打开画布
        </button>
        <button
          type="button"
          className="ra-chat-file-card-button ra-chat-file-card-button-save"
          onClick={handleSave}
          disabled={saved || saving}
          aria-label={saved ? '已保存' : '保存到文件库'}
        >
          {saved ? '已保存' : saving ? '保存中…' : '保存到文件库'}
        </button>
      </div>
    </div>
  )
}
