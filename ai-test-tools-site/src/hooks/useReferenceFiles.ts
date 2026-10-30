import { useCallback, useRef, useState } from 'react'
import {
  MAX_REFERENCE_FILE_BYTES,
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_TEXT_CHARS,
  isSupportedReferenceFile,
  referenceExtensionOf,
  type ReferenceFileEntry,
} from '../lib/reference-file'
import { parseReferenceFileApi } from '../lib/testcase-api'

const EXT_LABEL: Record<string, string> = {
  '.pdf': 'PDF',
  '.docx': 'Word',
  '.pptx': 'PPT',
  '.xlsx': 'Excel',
  '.xls': 'Excel',
  '.csv': 'CSV',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.md': 'MD',
  '.txt': 'TXT',
  '.png': 'IMG',
  '.jpg': 'IMG',
  '.jpeg': 'IMG',
}

/** 文件卡片上显示的类型徽标（agent 工具风格：只标识是什么文件）。 */
export function referenceExtLabel(filename: string): string {
  return EXT_LABEL[referenceExtensionOf(filename)] ?? 'FILE'
}

let entrySeq = 0

/**
 * 参考文件管理 hook：粘贴捕获（唯一入口）→ 粘贴即解析 → 卡片状态机。
 * 约束：最多 5 个文件、单文件 20MB、仅支持文档/图片格式；解析失败/解析中/待提交校验由调用方消费。
 */
export function useReferenceFiles() {
  const [files, setFiles] = useState<ReferenceFileEntry[]>([])
  const filesRef = useRef<ReferenceFileEntry[]>([])

  const syncFiles = useCallback((next: ReferenceFileEntry[]) => {
    filesRef.current = next
    setFiles(next)
  }, [])

  const removeFile = useCallback((id: string) => {
    syncFiles(filesRef.current.filter((item) => item.id !== id))
  }, [syncFiles])

  const clearFiles = useCallback(() => syncFiles([]), [syncFiles])

  const addFiles = useCallback((incoming: File[]) => {
    const accepted: ReferenceFileEntry[] = []
    const room = MAX_REFERENCE_FILES - filesRef.current.length
    for (const file of incoming.slice(0, Math.max(0, room))) {
      entrySeq += 1
      const id = `ref-${entrySeq}`
      if (!isSupportedReferenceFile(file.name)) {
        accepted.push({ id, name: file.name, text: null, status: 'failed', notice: '不支持的文件格式' })
        continue
      }
      if (file.size > MAX_REFERENCE_FILE_BYTES) {
        accepted.push({ id, name: file.name, text: null, status: 'failed', notice: '超过 20MB 大小限制' })
        continue
      }
      accepted.push({ id, name: file.name, text: null, status: 'parsing' })
    }
    if (accepted.length === 0) return
    syncFiles([...filesRef.current, ...accepted])

    // 粘贴即解析：并行请求，各自更新自己卡片的状态
    for (const entry of accepted) {
      if (entry.status !== 'parsing') continue
      const source = incoming.find((f) => f.name === entry.name && f.size > 0)
      if (!source) {
        syncFiles(filesRef.current.map((item) => item.id === entry.id
          ? { ...item, status: 'failed', notice: '未取到文件内容' }
          : item))
        continue
      }
      void parseReferenceFileApi(entry.name, source)
        .then((result) => {
          syncFiles(filesRef.current.map((item) => item.id === entry.id
            ? {
                ...item,
                status: 'done',
                text: result.text,
                truncated: result.truncated,
                notice: result.truncated
                  ? `超过 ${MAX_REFERENCE_TEXT_CHARS.toLocaleString()} 字符，已截断为前 ${MAX_REFERENCE_TEXT_CHARS.toLocaleString()} 字符`
                  : undefined,
              }
            : item))
        })
        .catch((error: unknown) => {
          syncFiles(filesRef.current.map((item) => item.id === entry.id
            ? { ...item, status: 'failed', notice: error instanceof Error ? error.message : '解析失败' }
            : item))
        })
    }
  }, [syncFiles])

  /** 粘贴事件处理：从 clipboardData 提取文件（纯文本粘贴不拦截，交回输入框）。 */
  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const pasted = Array.from(event.clipboardData?.files ?? [])
    if (pasted.length === 0) return
    event.preventDefault()
    addFiles(pasted)
  }, [addFiles])

  /** 提交前校验：解析中/失败的卡片阻止提交（返回可展示的错误文案，null 表示可提交）。 */
  const submitBlocker = useCallback((filesSnapshot?: ReferenceFileEntry[]): string | null => {
    const list = filesSnapshot ?? filesRef.current
    if (list.some((item) => item.status === 'parsing')) return '参考文件解析中，请稍候再提交'
    const failed = list.find((item) => item.status === 'failed')
    if (failed) return `参考文件「${failed.name}」${failed.notice ? `（${failed.notice}）` : ''}解析失败，请修正或移除后再提交`
    return null
  }, [])

  /** 取已解析文本（供拼 AI 上下文用）。 */
  const parsedReferences = useCallback((filesSnapshot?: ReferenceFileEntry[]) => {
    const list = filesSnapshot ?? filesRef.current
    return list
      .filter((item): item is ReferenceFileEntry & { text: string } => item.status === 'done' && Boolean(item.text))
      .map((item) => ({ name: item.name, text: item.text }))
  }, [])

  return { files, handlePaste, removeFile, clearFiles, submitBlocker, parsedReferences }
}
