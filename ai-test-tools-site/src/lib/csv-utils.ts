// ── 通用 CSV 工具函数 ──

/** 解析 CSV 文本为对象数组（支持引号内换行） */
export function parseCsvText(text: string): Record<string, string>[] {
  const lines = splitCsvLines(text)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0])
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    // 跳过空行
    if (values.length === 1 && values[0].trim() === '') continue
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header.trim()] = (values[index] ?? '').trim()
    })
    rows.push(row)
  }

  return rows
}

/** 按行分割 CSV，正确处理引号内的换行符 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (char === '"') {
      // 处理转义双引号 ""
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        current += '""'
        i++
      } else {
        inQuotes = !inQuotes
        current += char
      }
    } else if (char === '\n' && !inQuotes) {
      lines.push(current)
      current = ''
    } else if (char === '\r') {
      // 忽略 \r
    } else {
      current += char
    }
  }

  if (current.trim()) {
    lines.push(current)
  }

  return lines
}

/** 解析单行 CSV（处理引号转义） */
export function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }
  result.push(current)

  return result
}

/** 从上传的文件解析为文本 */
export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file, 'UTF-8')
  })
}

/** 格式化日期为 YYYY-MM-DD */
export function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : dateStr.slice(0, 10)
}
