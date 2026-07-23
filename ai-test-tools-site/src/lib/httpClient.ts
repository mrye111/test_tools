const DEFAULT_API_BASE = 'http://localhost:3000'

export function getApiBase() {
  const base = import.meta.env.VITE_JMETER_API_BASE ?? DEFAULT_API_BASE
  return base.replace(/\/$/, '')
}

export function buildUrl(path: string) {
  return `${getApiBase()}${path}`
}

export async function parseJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    throw new Error(`响应解析失败：${response.status}`)
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
