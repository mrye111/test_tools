/**
 * 常见 HTTP 请求头预设值。
 * key：请求头名称，value：该请求头对应的常用取值建议列表。
 */
export const HEADER_PRESETS: Record<string, string[]> = {
  'Accept': [
    'application/json',
    'text/html',
    'application/xml',
    'text/plain',
    'image/webp',
    '*/*',
  ],
  'Accept-Charset': [
    'utf-8',
    'iso-8859-1',
    'utf-8, iso-8859-1;q=0.5',
  ],
  'Accept-Encoding': [
    'gzip, deflate, br',
    'gzip',
    'deflate',
    'br',
    'identity',
  ],
  'Accept-Language': [
    'zh-CN,zh;q=0.9,en;q=0.8',
    'zh-CN',
    'en-US,en;q=0.9',
    'en',
  ],
  'Authorization': [
    'Bearer ',
    'Basic ',
    'Digest ',
    'AWS4-HMAC-SHA256 ',
  ],
  'Cache-Control': [
    'no-cache',
    'no-store',
    'max-age=0',
    'public, max-age=3600',
    'private, max-age=60',
  ],
  'Connection': [
    'keep-alive',
    'close',
    'upgrade',
  ],
  'Content-Encoding': [
    'gzip',
    'deflate',
    'br',
    'zstd',
  ],
  'Content-Length': [
    '0',
  ],
  'Content-Type': [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'application/xml',
    'text/plain',
    'text/html',
    'application/octet-stream',
    'application/graphql',
  ],
  'Cookie': [
    'session_id=',
    'token=',
  ],
  'Host': [
    'api.example.com',
    'localhost:8080',
    'example.com',
  ],
  'If-Match': [
    '"abc123"',
    '*',
  ],
  'If-None-Match': [
    '"abc123"',
    '*',
  ],
  'If-Modified-Since': [
    'Wed, 21 Oct 2025 07:28:00 GMT',
  ],
  'Origin': [
    'https://example.com',
    'http://localhost:3000',
  ],
  'Pragma': [
    'no-cache',
  ],
  'Referer': [
    'https://example.com/',
    'http://localhost:3000/',
  ],
  'Transfer-Encoding': [
    'chunked',
    'compress',
    'deflate',
    'gzip',
    'identity',
  ],
  'User-Agent': [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0',
    'PostmanRuntime/7.x',
    'JMeter/5.6',
    'curl/8.0',
    'Python/3.x aiohttp',
  ],
  'X-API-Key': [
    'your-api-key-here',
  ],
  'X-CSRF-Token': [
    'your-csrf-token-here',
  ],
  'X-Forwarded-For': [
    '192.168.1.1',
    '10.0.0.1',
    'client-ip',
  ],
  'X-Forwarded-Proto': ['https', 'http'],
  'X-Forwarded-Host': [
    'original-host.example.com',
  ],
  'X-Real-IP': [
    '192.168.1.1',
    '10.0.0.1',
  ],
  'X-Request-ID': [
    '550e8400-e29b-41d4-a716-446655440000',
  ],
  'X-Requested-With': [
    'XMLHttpRequest',
    'Fetch',
  ],
  'X-Trace-ID': [
    '550e8400-e29b-41d4-a716-446655440000',
  ],
}

/** 所有可选的请求头名称列表（按字母排序） */
export const HEADER_NAMES = Object.keys(HEADER_PRESETS).sort()

/**
 * 根据请求头名称获取常用取值建议。
 * 未匹配到时返回空数组。
 */
export function getHeaderValuePresets(headerName: string): string[] {
  const key = headerName.trim()
  return HEADER_PRESETS[key] ?? []
}
