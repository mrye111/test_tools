export type HttpMethod = 'GET' | 'POST' | 'HEAD' | 'PUT' | 'OPTIONS' | 'TRACE' | 'DELETE' | 'PATCH' | 'PROPFIND' | 'PROPPATCH' | 'MKCOL' | 'COPY' | 'MOVE' | 'LOCK' | 'UNLOCK' | 'REPORT' | 'MKCALENDAR' | 'SEARCH'

export type BodyType = 'none' | 'json' | 'form' | 'multipart' | 'xml' | 'raw'

export interface HttpMethodConfig {
  method: HttpMethod
  label: string
  defaultBodyType: BodyType
  description: string
}

export const HTTP_METHODS: HttpMethodConfig[] = [
  { method: 'GET', label: 'GET', defaultBodyType: 'none', description: '获取资源' },
  { method: 'POST', label: 'POST', defaultBodyType: 'json', description: '提交数据' },
  { method: 'PUT', label: 'PUT', defaultBodyType: 'json', description: '更新资源' },
  { method: 'PATCH', label: 'PATCH', defaultBodyType: 'json', description: '部分更新' },
  { method: 'DELETE', label: 'DELETE', defaultBodyType: 'none', description: '删除资源' },
  { method: 'HEAD', label: 'HEAD', defaultBodyType: 'none', description: '获取头信息' },
  { method: 'OPTIONS', label: 'OPTIONS', defaultBodyType: 'none', description: '查询支持方法' },
  { method: 'TRACE', label: 'TRACE', defaultBodyType: 'none', description: '回显请求' },
  { method: 'PROPFIND', label: 'PROPFIND', defaultBodyType: 'xml', description: 'WebDAV 查询属性' },
  { method: 'PROPPATCH', label: 'PROPPATCH', defaultBodyType: 'xml', description: 'WebDAV 修改属性' },
  { method: 'MKCOL', label: 'MKCOL', defaultBodyType: 'none', description: 'WebDAV 创建集合' },
  { method: 'COPY', label: 'COPY', defaultBodyType: 'none', description: 'WebDAV 复制资源' },
  { method: 'MOVE', label: 'MOVE', defaultBodyType: 'none', description: 'WebDAV 移动资源' },
  { method: 'LOCK', label: 'LOCK', defaultBodyType: 'xml', description: 'WebDAV 锁定资源' },
  { method: 'UNLOCK', label: 'UNLOCK', defaultBodyType: 'none', description: 'WebDAV 解锁资源' },
  { method: 'REPORT', label: 'REPORT', defaultBodyType: 'xml', description: 'WebDAV 报告' },
  { method: 'MKCALENDAR', label: 'MKCALENDAR', defaultBodyType: 'xml', description: 'CalDAV 创建日历' },
  { method: 'SEARCH', label: 'SEARCH', defaultBodyType: 'xml', description: 'WebDAV 搜索' },
]

export interface BodyTypeConfig {
  type: BodyType
  label: string
  contentType: string | null
  description: string
}

export const BODY_TYPES: BodyTypeConfig[] = [
  { type: 'none', label: '无请求体', contentType: null, description: 'GET/HEAD/DELETE 等' },
  { type: 'json', label: 'JSON', contentType: 'application/json', description: 'JSON 格式数据' },
  { type: 'form', label: 'Form 表单', contentType: 'application/x-www-form-urlencoded', description: 'URL 编码表单' },
  { type: 'multipart', label: 'Multipart', contentType: 'multipart/form-data', description: '多部分表单（支持文件）' },
  { type: 'xml', label: 'XML', contentType: 'application/xml', description: 'XML 格式数据' },
  { type: 'raw', label: 'Raw 原始', contentType: 'text/plain', description: '纯文本数据' },
]

export interface ParamItem {
  key: string
  value: string
  enabled: boolean
  encode: boolean
}

export function getMethodConfig(method: HttpMethod): HttpMethodConfig {
  return HTTP_METHODS.find((m) => m.method === method) || HTTP_METHODS[0]
}

export function getBodyTypeConfig(type: BodyType): BodyTypeConfig {
  return BODY_TYPES.find((b) => b.type === type) || BODY_TYPES[0]
}

export function createEmptyParam(): ParamItem {
  return { key: '', value: '', enabled: true, encode: true }
}
