import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultHttpRequest } from './jmeter-types'
import { jmeterTemplates } from '../data/jmeter-templates'
import { buildHttpRequestArgs, generateCustomScriptPlan, generateTemplatePlan } from './jmeter-builders'
import type { JmeterBuildSpec } from './jmeter-api'

function findTemplate(id: string) {
  const template = jmeterTemplates.find((item) => item.id === id)
  if (!template) throw new Error(`Missing template: ${id}`)
  return template
}

type CapturedBuild = { url: string; spec: JmeterBuildSpec }

/** fetch-mock POST /api/jmeter/build：记录请求体，回一个伪造的构建响应。 */
function mockBuildFetch(options?: { failure?: { code: string; message: string; step?: string }; status?: number }) {
  const captured: CapturedBuild[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const spec = JSON.parse(String(init?.body ?? '{}')) as JmeterBuildSpec
    captured.push({ url, spec })

    if (options?.failure) {
      return new Response(JSON.stringify({ ok: false, error: options.failure }), { status: options.status ?? 400 })
    }

    const path = `D:/mock/server/generated/${spec.seed}-20260717-120000.jmx`
    const body = {
      ok: true,
      planName: spec.planName,
      path,
      filename: `${spec.seed}-20260717-120000.jmx`,
      saveMessage: `Test plan saved: ${path}`,
      validation: 'Validation summary: errors=0, warnings=0\nNo structural issues found.',
      tree: '/0 | TestPlan | mock | enabled=true',
      steps: [
        ...spec.steps.map((step) => ({ tool: step.tool, text: `${step.tool} ok` })),
        { tool: 'validate_test_plan', text: 'Validation summary: errors=0, warnings=0' },
        { tool: 'save_test_plan', text: `Test plan saved: ${path}` },
        { tool: 'list_test_plan_tree', text: '/0 | TestPlan | mock | enabled=true' },
      ],
    }
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return captured
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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

    const args = buildHttpRequestArgs(httpData)

    // headers 不传给 add_http_request，避免与 Header Manager 重复（经 add_more_configs 单独下发）
    expect(args).not.toHaveProperty('headers')
    expect(args).toEqual({
      name: 'HTTP 请求',
      method: 'POST',
      protocol: 'https',
      domain: 'api.example.com',
      port: 443,
      path: '/users?page=1',
      content_type: 'application/x-www-form-urlencoded',
      body_data: undefined,
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

  it('routes HTTP headers through add_more_configs before add_http_request in the posted spec', async () => {
    const captured = mockBuildFetch()

    const httpData = createDefaultHttpRequest()
    httpData.domain = 'api.example.com'
    httpData.path = '/health'
    httpData.headers = [
      { name: 'Authorization', value: 'Bearer demo' },
      { name: 'X-Env', value: 'prod' },
    ]

    await generateTemplatePlan({
      template: findTemplate('http-stress'),
      values: {},
      httpData,
    })

    // 只有一次构建请求：整个模板一次发到 /api/jmeter/build
    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toBe('http://localhost:3000/api/jmeter/build')

    const toolNames = captured[0]!.spec.steps.map((step) => step.tool)
    const headerConfigIndex = toolNames.indexOf('add_more_configs')
    const httpRequestIndex = toolNames.indexOf('add_http_request')

    // Header Manager（config element）必须先于 HTTP Request（sampler）
    expect(headerConfigIndex).toBeGreaterThan(-1)
    expect(headerConfigIndex).toBeLessThan(httpRequestIndex)
    expect(captured[0]?.spec.steps[headerConfigIndex]?.args).toEqual({
      type: 'http_header_manager',
      name: 'HTTP 请求头管理器',
      headers: 'Authorization=Bearer demo;X-Env=prod',
    })
    expect(captured[0]?.spec.steps[httpRequestIndex]?.args).not.toHaveProperty('headers')
  })

  it('builds the expected HTTP template step list and maps the build response', async () => {
    const captured = mockBuildFetch()

    const httpData = createDefaultHttpRequest()
    httpData.domain = 'api.example.com'
    httpData.path = '/health'

    const template = findTemplate('http-stress')
    const result = await generateTemplatePlan({
      template,
      values: {
        threads: 20,
        ramp_up: 10,
        loops: 3,
        aggregate_report: 'true',
        assertion_code: '200',
      },
      httpData,
    })

    const spec = captured[0]!.spec
    expect(spec.seed).toBe('http-stress')
    expect(spec.planName.startsWith(template.name)).toBe(true)
    expect(spec.steps.map((step) => step.tool)).toEqual([
      'create_test_plan',
      'add_thread_group',
      'add_http_request',
      'add_assertion',
      'add_listener',
    ])

    expect(spec.steps[2]?.args).toMatchObject({
      domain: 'api.example.com',
      method: 'GET',
      path: '/health',
    })
    expect(spec.steps[3]?.args).toMatchObject({
      type: 'response',
      test_field: 'response_code',
      patterns: ['200'],
    })
    expect(spec.steps[4]?.args).toEqual({ type: 'aggregate_report' })

    // 结果字段全部来自服务端响应（路径/文件名由服务端生成）
    expect(result.planName).toBe(spec.planName)
    expect(result.savedPath).toBe('D:/mock/server/generated/http-stress-20260717-120000.jmx')
    expect(result.downloadName).toBe('http-stress-20260717-120000.jmx')
    expect(result.saveMessage).toContain('Test plan saved')
    expect(result.validation).toContain('Validation summary')
    expect(result.tree).toContain('TestPlan')
    expect(result.steps.map((step) => step.tool)).toEqual([
      'create_test_plan',
      'add_thread_group',
      'add_http_request',
      'add_assertion',
      'add_listener',
      'validate_test_plan',
      'save_test_plan',
      'list_test_plan_tree',
    ])
  })

  it('builds the custom script step list', async () => {
    const captured = mockBuildFetch()

    const result = await generateCustomScriptPlan({
      language: 'groovy',
      script: 'log.info("ok")',
    })

    const spec = captured[0]!.spec
    expect(spec.seed).toBe('custom-script')
    expect(spec.steps.map((step) => step.tool)).toEqual([
      'create_test_plan',
      'add_thread_group',
      'add_script',
      'add_listener',
    ])
    expect(spec.steps[2]?.args).toMatchObject({
      name: '自定义脚本',
      type: 'sampler',
      language: 'groovy',
      script: 'log.info("ok")',
    })
    expect(result.downloadName).toBe('custom-script-20260717-120000.jmx')
  })

  it('surfaces the server error message when the build fails', async () => {
    mockBuildFetch({ failure: { code: 'unknown-type', message: "Step 'add_listener' failed: Error: unknown listener type 'bogus'", step: 'add_listener' } })

    const httpData = createDefaultHttpRequest()
    httpData.domain = 'api.example.com'
    httpData.path = '/health'

    await expect(generateTemplatePlan({
      template: findTemplate('http-stress'),
      values: {},
      httpData,
    })).rejects.toThrow("Step 'add_listener' failed: Error: unknown listener type 'bogus'")
  })
})
