/**
 * 参考文件（Reference File）：解析文本并入 AI 上下文的标记段拼装。
 * 解析本身在服务端（docling-serve sidecar）；这里是纯函数，前端与服务端共用。
 */

/** 单个参考文件解析后的最大字符数（与服务端 MAX_REFERENCE_TEXT_CHARS 保持一致）。 */
export const MAX_REFERENCE_TEXT_CHARS = 50_000
/** 单文件大小上限（含扫描件 PDF 放宽至 20MB）。 */
export const MAX_REFERENCE_FILE_BYTES = 20 * 1024 * 1024
/** 每个弹窗可携带的参考文件上限。 */
export const MAX_REFERENCE_FILES = 5

/** 支持的参考文件扩展名（docling 擅长的文档/图片类，图片走 OCR）。 */
export const SUPPORTED_REFERENCE_EXTENSIONS = [
  '.pdf', '.docx', '.pptx', '.xlsx', '.xls', '.csv', '.html', '.htm', '.md', '.txt', '.png', '.jpg', '.jpeg',
] as const

export function referenceExtensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot).toLowerCase()
}

export function isSupportedReferenceFile(filename: string): boolean {
  return (SUPPORTED_REFERENCE_EXTENSIONS as readonly string[]).includes(referenceExtensionOf(filename))
}

export interface ReferenceFileEntry {
  id: string
  name: string
  /** 解析成功后的文本（解析中/失败时为 null） */
  text: string | null
  status: 'parsing' | 'done' | 'failed'
  /** 失败原因或截断提示 */
  notice?: string
  truncated?: boolean
}

/** 已解析参考文件拼为 AI 上下文标记段（与 Swagger 标记段同构，多文件依次排列）。 */
export function referencesToContext(references: Array<{ name: string; text: string }>): string {
  return references
    .map((ref) => `【参考文件：${ref.name}】\n${ref.text}`)
    .join('\n\n')
}
