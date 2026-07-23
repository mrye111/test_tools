import type { HttpMethod, BodyType, ParamItem } from '../data/http-request-types'

export interface CurlParseResult {
  method: HttpMethod
  protocol: string
  domain: string
  port: string
  path: string
  headers: Array<{ name: string; value: string }>
  bodyData: string
  bodyType: BodyType
  queryParams: ParamItem[]
}

/** 移除首尾引号（单引号 / 双引号） */
function stripQuotes(value: string): string {
  let s = value.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

/** 判断字符串是否为有效 JSON */
function isJsonLike(value: string): boolean {
  const s = value.trim()
  return (s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))
}

/** 判断字符串是否为有效 XML */
function isXmlLike(value: string): boolean {
  const s = value.trim()
  return s.startsWith('<') && s.endsWith('>') && !s.startsWith('<!')
}

/** 推断 bodyType */
function inferBodyType(
  bodyData: string,
  contentType: string | undefined,
): BodyType {
  if (!bodyData.trim()) return 'none'
  if (contentType?.includes('application/json') || isJsonLike(bodyData)) return 'json'
  if (contentType?.includes('application/x-www-form-urlencoded')) return 'form'
  if (contentType?.includes('application/xml') || isXmlLike(bodyData)) return 'xml'
  if (contentType?.includes('text/plain')) return 'raw'
  if (contentType) return 'raw'
  // 无 Content-Type 时按内容猜测
  if (isJsonLike(bodyData)) return 'json'
  if (isXmlLike(bodyData)) return 'xml'
  return 'raw'
}

/** 解析 URL → protocol / domain / port / path / queryParams */
function parseUrl(rawUrl: string): {
  protocol: string
  domain: string
  port: string
  path: string
  queryParams: ParamItem[]
} {
  let url = stripQuotes(rawUrl).trim()
  // 补齐协议
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }

  try {
    const parsed = new URL(url)
    const protocol = parsed.protocol.replace(':', '')
    const domain = parsed.hostname
    const port = parsed.port || ''
    const path = parsed.pathname + parsed.search
    const queryParams: ParamItem[] = []
    parsed.searchParams.forEach((value, key) => {
      queryParams.push({ key, value, enabled: true, encode: true })
    })
    return { protocol, domain, port, path, queryParams }
  } catch {
    // 降级：去除协议后正则拆分
    const withoutProto = url.replace(/^https?:\/\//i, '')
    const protocol = url.startsWith('http://') ? 'http' : 'https'
    const firstSlash = withoutProto.indexOf('/')
    if (firstSlash === -1) {
      return { protocol, domain: withoutProto, port: '', path: '/', queryParams: [] }
    }
    const hostPart = withoutProto.slice(0, firstSlash)
    const pathPart = withoutProto.slice(firstSlash)

    // host:port
    const colonIdx = hostPart.lastIndexOf(':')
    const domain = colonIdx > -1 ? hostPart.slice(0, colonIdx) : hostPart
    const port = colonIdx > -1 ? hostPart.slice(colonIdx + 1) : ''

    // path + query
    const qIdx = pathPart.indexOf('?')
    const path = qIdx > -1 ? pathPart.slice(0, qIdx) || '/' : pathPart || '/'
    const queryParams: ParamItem[] = []
    if (qIdx > -1) {
      const qs = pathPart.slice(qIdx + 1)
      qs.split('&').forEach((pair) => {
        const eq = pair.indexOf('=')
        const key = eq > -1 ? decodeURIComponent(pair.slice(0, eq)) : pair
        const value = eq > -1 ? decodeURIComponent(pair.slice(eq + 1)) : ''
        if (key) queryParams.push({ key, value, enabled: true, encode: true })
      })
    }

    return { protocol, domain, port, path, queryParams }
  }
}

/** 将 HTTP 方法字符串规范化到已知类型 */
function normalizeMethod(raw: string): HttpMethod {
  const upper = raw.trim().toUpperCase()
  const known: HttpMethod[] = [
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
    'TRACE', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE',
    'LOCK', 'UNLOCK', 'REPORT', 'MKCALENDAR', 'SEARCH',
  ]
  return known.includes(upper as HttpMethod) ? (upper as HttpMethod) : 'GET'
}

/**
 * 解析 curl 命令字符串。
 * 支持 -X/-H/-d/--data/--data-raw/--data-binary/--header/--request 等常用选项。
 */
export function parseCurl(input: string): CurlParseResult {
  // 清理：去除换行续行符（\ + 换行 或 ^ + 换行）
  let text = input.replace(/\\\s*\n\s*/g, ' ').replace(/\^\s*\n\s*/g, ' ')
  // 折叠多余空白
  text = text.replace(/\s+/g, ' ').trim()

  // 剥离前导 "curl "
  const curlMatch = text.match(/^(?:curl\s+)(.*)$/is)
  if (!curlMatch) {
    throw new Error('请输入有效的 curl 命令（以 curl 开头）')
  }

  const rest = curlMatch[1]

  // 逐 token 解析
  const tokens = tokenize(rest)
  let method: HttpMethod = 'GET'
  let methodExplicit = false
  const headers: Array<{ name: string; value: string }> = []
  let bodyData = ''
  let url = ''

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]

    // -X / --request METHOD
    if (token === '-X' || token === '--request') {
      if (i + 1 < tokens.length) {
        method = normalizeMethod(tokens[++i])
        methodExplicit = true
      }
    }
    // -H / --header "Header: Value"
    else if (token === '-H' || token === '--header') {
      if (i + 1 < tokens.length) {
        const raw = stripQuotes(tokens[++i])
        const colonIdx = raw.indexOf(':')
        if (colonIdx > -1) {
          const name = raw.slice(0, colonIdx).trim()
          const value = raw.slice(colonIdx + 1).trim()
          if (name) headers.push({ name, value })
        }
      }
    }
    // -d / --data / --data-raw / --data-binary "body"
    else if (
      token === '-d' || token === '--data' ||
      token === '--data-raw' || token === '--data-binary'
    ) {
      if (i + 1 < tokens.length) {
        bodyData = stripQuotes(tokens[++i])
      }
    }
    // --data-urlencode "key=value" → 合并到 bodyData
    else if (token === '--data-urlencode') {
      if (i + 1 < tokens.length) {
        const val = stripQuotes(tokens[++i])
        bodyData = bodyData ? `${bodyData}&${val}` : val
      }
    }
    // -u user:pass → Basic Auth header
    else if (token === '-u' || token === '--user') {
      if (i + 1 < tokens.length) {
        const creds = stripQuotes(tokens[++i])
        headers.push({ name: 'Authorization', value: `Basic ${btoa(creds)}` })
      }
    }
    // URL (不以 - 开头且未被消费)
    else if (!token.startsWith('-') && !url) {
      url = token
    }

    i++
  }

  if (!url) {
    throw new Error('未在 curl 命令中找到 URL')
  }

  // GET/HEAD/DELETE/OPTIONS/TRACE — 将 body data 转为 Query 参数
  const bodylessMethods: HttpMethod[] = ['GET', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE']
  if (bodylessMethods.includes(method) && bodyData.trim()) {
    // 将表单格式的 body 合并到 URL query 后重新解析
    const separator = url.includes('?') ? '&' : '?'
    url = `${url}${separator}${bodyData}`
    bodyData = ''
  }

  // 无显式方法时：有 body → POST，无 body → GET
  if (!methodExplicit && method === 'GET' && bodyData.trim()) {
    method = 'POST'
  }

  const urlParsed = parseUrl(url)

  // 推断 bodyType
  const contentTypeHeader = headers.find(
    (h) => h.name.toLowerCase() === 'content-type',
  )
  const bodyType = inferBodyType(bodyData, contentTypeHeader?.value)

  return {
    method,
    protocol: urlParsed.protocol,
    domain: urlParsed.domain,
    port: urlParsed.port,
    path: urlParsed.path,
    headers,
    bodyData,
    bodyType,
    queryParams: urlParsed.queryParams,
  }
}

/** 将 curl 参数字符串拆分为 tokens，正确处理引号包裹 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let i = 0

  while (i < text.length) {
    // 跳过空白
    if (text[i] === ' ' || text[i] === '\t') {
      i++
      continue
    }

    // 引号包裹的 token
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i]
      let j = i + 1
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') j++ // 跳过转义
        j++
      }
      tokens.push(text.slice(i, j + 1))
      i = j + 1
      continue
    }

    // 普通 token
    let j = i
    while (j < text.length && text[j] !== ' ' && text[j] !== '\t') {
      j++
    }
    tokens.push(text.slice(i, j))
    i = j
  }

  return tokens
}
