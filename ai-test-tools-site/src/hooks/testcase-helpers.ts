import { KNOWN_HEADERS } from './testcase-constants'

// ── Pure helpers ───────────────────────────────────────────────────────────────

export function normalizeDisplayHeader(header: string[]) {
  if (!header.length) return []
  const normalized = header.map((item) => item.trim().toLowerCase())
  for (const candidate of KNOWN_HEADERS) {
    const expected = candidate.map((item) => item.trim().toLowerCase())
    for (let start = 0; start < normalized.length; start += 1) {
      const matches = expected.filter((item, index) => normalized[start + index] === item).length
      if (matches >= 4) return candidate
    }
  }
  return header.map((item) => item.trim())
}

export function displayCellText(value: unknown) {
  return String(value ?? '').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n')
}
