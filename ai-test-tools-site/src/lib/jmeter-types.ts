import type { BodyType, HttpMethod, ParamItem } from '../data/http-request-types'

export interface HttpRequestData {
  method: HttpMethod
  domain: string
  port: string
  protocol: string
  path: string
  bodyType: BodyType
  jsonBody: string
  formData: ParamItem[]
  queryParams: ParamItem[]
  xmlBody: string
  rawBody: string
  headers: Array<{ name: string; value: string }>
}

export function createDefaultHttpRequest(): HttpRequestData {
  return {
    method: 'GET',
    domain: '',
    port: '',
    protocol: 'https',
    path: '/',
    bodyType: 'none',
    jsonBody: '',
    formData: [],
    queryParams: [],
    xmlBody: '',
    rawBody: '',
    headers: [],
  }
}
