import { Loader2, X } from 'lucide-react'
import type { ReferenceFileEntry } from '../lib/reference-file'
import { referenceExtLabel } from '../hooks/useReferenceFiles'

interface ReferenceFileStripProps {
  files: ReferenceFileEntry[]
  onRemove: (id: string) => void
}

/**
 * 参考文件卡片条：agent 工具风格的紧凑卡片，横向排列、超宽左右滑动。
 * 卡片只标识文件类型（扩展名徽标）与文件名，不放大图标；解析状态以小状态点 + 悬浮原因呈现。
 */
export function ReferenceFileStrip({ files, onRemove }: ReferenceFileStripProps) {
  if (files.length === 0) return null
  return (
    <div className="reference-strip" role="list" aria-label="参考文件">
      {files.map((file) => (
        <div
          key={file.id}
          role="listitem"
          className={`reference-chip${file.status === 'failed' ? ' is-failed' : ''}${file.truncated ? ' is-truncated' : ''}`}
          title={file.notice ?? (file.status === 'parsing' ? '解析中' : file.truncated ? '内容已截断' : '解析完成')}
        >
          <span className="reference-chip-ext">{referenceExtLabel(file.name)}</span>
          <span className="reference-chip-name">{file.name}</span>
          {file.status === 'parsing' && <Loader2 className="reference-chip-spin" aria-label="解析中" />}
          {file.status === 'failed' && (
            <span className="reference-chip-notice" aria-label="解析失败">{file.notice || '解析失败'}</span>
          )}
          {file.status === 'done' && (
            <span className={`reference-chip-dot${file.truncated ? ' is-truncated' : ' is-done'}`} aria-label={file.truncated ? '已截断' : '解析完成'} />
          )}
          <button type="button" className="reference-chip-remove" aria-label={`移除 ${file.name}`} onClick={() => onRemove(file.id)}>
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
