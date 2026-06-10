import { describe, expect, it, vi } from 'vitest'
import { createDefaultHttpRequest } from '../components/jmeter/HttpRequestConfig'
import { jmeterTemplates } from '../data/jmeter-templates'
import { buildHttpRequestArgs, createGeneratedPlanTarget, generateCustomScriptPlan, generateTemplatePlan } from './jmeter-builders'
import { extractSavedPath } from './jmeter-api'

function findTemplate(id: string) {
  const template = jmeterTemplates.find((item) => item.id === id)
  if (!template) throw new Error(`Missing template: ${id}`)
  return template
}

describe('jmeter-builders', () => {
  it('maps HTTP request form data and query params to backend tool args', () => {
    const httpData = createDefaultHttpRequest()
    httpData.method = 'POST'
    httpData.protocol = 'https'
    httpData.domain = 'api.example.com'
    httpData.path = '/users'
    httpData.bodyType = 'form'
    httpData.queryParams = [{ key: 'page', value: '1', enabled: true, encode: true }]
    httpData.formData = [{ key: 'name', value: 'alice', enabled: true, encode: true }]
    httpData.headers = [{ name: 'Authorization', value: 'Bearer demo' }]

    expect(buildHttpRequestArgs(httpData)).toEqual({
      name: 'HTTP 请求',
      method: 'POST',
      protocol: 'https',
      domain: 'api.example.com',
      port: 443,
      path: '/users?page=1',
      content_type: 'application/x-www-form-urlencoded',
      body_data: undefined,
      headers: [{ name: 'Authorization', value: 'Bearer demo' }],
      params: [{ name: 'name', value: 'alice' }],
    })
  })

  it('rejects unsupported multipart HTTP uploads', () => {
    const httpData = createDefaultHttpRequest()
    httpData.method = 'POST'
    httpData.domain = 'api.example.com'
    httpData.path = '/upload'
    httpData.bodyType = 'multipart'

    expect(() => buildHttpRequestArgs(httpData)).toThrow('当前后端的 HTTP 模板暂不支持 multipart 文件上传')
  })

  it('creates generated JMX targets under server/generated', () => {
    const target = createGeneratedPlanTarget('http-stress')

    expect(target.path).toMatch(/^server\/generated\/http-stress-\d{8}-\d{6}\.jmx$/)
    expect(target.filename).toMatch(/^http-stress-\d{8}-\d{6}\.jmx$/)
  })

  it('extracts saved path from backend save result', () => {
    expect(extractSavedPath('Test plan saved: server/generated/demo.jmx')).toBe('server/generated/demo.jmx')
    expect(extractSavedPath('Validation summary: errors=0')).toBeNull()
  })

  it('builds the expected HTTP template tool chain', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> | undefined }> = []
    const callTool = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name === 'save_test_plan') return `Test plan saved: ${String(args?.path)}`
      if (name === 'list_test_plan_tree') return '/0 | TestPlan | demo | enabled=true'
      if (name === 'validate_test_plan') return 'Validation summary: errors=0, warnings=0'
      return `${name} ok`
    })

    const httpData = createDefaultHttpRequest()
    httpData.domain = 'api.example.com'
    httpData.path = '/health'

    const result = await generateTemplatePlan({
      template: findTemplate('http-stress'),
      values: {
        threads: 20,
        ramp_up: 10,
        loops: 3,
        aggregate_report: 'true',
        assertion_code: '200',
      },
      httpData,
      callTool,
    })

    expect(calls.map((item) => item.name)).toEqual([
      'create_test_plan',
      'add_thread_group',
      'add_http_request',
      'add_assertion',
      'add_listener',
      'validate_test_plan',
      'save_test_plan',
      'list_test_plan_tree',
    ])

    expect(calls[2]?.args).toMatchObject({
      domain: 'api.example.com',
      method: 'GET',
      path: '/health',
    })
    expect(calls[3]?.args).toMatchObject({
      type: 'response',
      test_field: 'response_code',
      patterns: ['200'],
    })
    expect(calls[4]?.args).toEqual({ type: 'aggregate_report' })
    expect(result.savedPath).toMatch(/^server\/generated\/http-stress-\d{8}-\d{6}\.jmx$/)
  })

  it('builds the custom script tool chain', async () => {
    const callTool = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'save_test_plan') return `Test plan saved: ${String(args?.path)}`
      if (name === 'list_test_plan_tree') return '/0 | TestPlan | demo | enabled=true'
      if (name === 'validate_test_plan') return 'Validation summary: errors=0, warnings=0'
      return `${name} ok`
    })

    const result = await generateCustomScriptPlan({
      language: 'groovy',
      script: 'log.info("ok")',
      callTool,
    })

    expect(callTool.mock.calls.map((item) => item[0])).toEqual([
      'create_test_plan',
      'add_thread_group',
      'add_script',
      'add_listener',
      'validate_test_plan',
      'save_test_plan',
      'list_test_plan_tree',
    ])
    expect(result.savedPath).toMatch(/^server\/generated\/custom-script-\d{8}-\d{6}\.jmx$/)
  })
})
