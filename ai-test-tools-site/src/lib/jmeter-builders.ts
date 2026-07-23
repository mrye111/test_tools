import type { HttpRequestData } from './jmeter-types'
import type { ParamItem } from '../data/http-request-types'
import type { JmeterTemplate } from '../data/jmeter-templates'
import {
  buildJmeterPlan,
  type AiGenerateResponse,
  type JmeterBuildResponse,
  type JmeterBuildSpec,
  type JmeterBuildStep,
} from './jmeter-api'

type TemplateValues = Record<string, string | number>

export type ToolExecutionStep = {
  tool: string
  text: string
}

export type GeneratedPlanResult = {
  planName: string
  savedPath: string
  downloadName: string
  saveMessage: string
  validation: string
  tree: string
  steps: ToolExecutionStep[]
}

type GenerateTemplatePlanOptions = {
  template: JmeterTemplate
  values: TemplateValues
  httpData: HttpRequestData
}

type GenerateCustomScriptOptions = {
  language: string
  script: string
}

const BODY_CONTENT_TYPES: Record<HttpRequestData['bodyType'], string | null> = {
  none: null,
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data',
  xml: 'application/xml',
  raw: 'text/plain',
}

function toText(value: string | number | undefined) {
  return value == null ? '' : String(value).trim()
}

function toNumber(value: string | number | undefined, fallback: number) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function toBooleanFlag(value: string | number | undefined, fallback = false) {
  if (value == null || value === '') return fallback
  if (typeof value === 'number') return value !== 0
  return value === 'true' || value === '1'
}

function nowStamp() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function buildPlanName(seed: string) {
  return `${seed} ${nowStamp()}`
}

function appendQuery(path: string, params: ParamItem[]) {
  const enabled = params.filter((item) => item.enabled && item.key)
  if (enabled.length === 0) return path || '/'

  const query = enabled
    .map((item) => {
      const key = item.encode ? encodeURIComponent(item.key) : item.key
      const value = item.encode ? encodeURIComponent(item.value) : item.value
      return `${key}=${value}`
    })
    .join('&')

  if (!query) return path || '/'
  const basePath = path || '/'
  return `${basePath}${basePath.includes('?') ? '&' : '?'}${query}`
}

function getHeaderContentType(headers: Array<{ name: string; value: string }>) {
  const match = headers.find((header) => header.name.trim().toLowerCase() === 'content-type')
  return match?.value?.trim() || null
}

function mapHeaders(headers: Array<{ name: string; value: string }>) {
  return headers
    .filter((item) => item.name.trim() && item.value.trim())
    .map((item) => ({ name: item.name.trim(), value: item.value.trim() }))
}

function mapParams(params: ParamItem[]) {
  return params
    .filter((item) => item.enabled && item.key)
    .map((item) => ({ name: item.key.trim(), value: item.value }))
}

export function buildHttpRequestArgs(httpData: HttpRequestData) {
  const domain = httpData.domain.trim()
  const basePath = httpData.path.trim() || '/'
  if (!domain) throw new Error('请填写目标域名')
  if (!basePath) throw new Error('请填写请求路径')
  if (httpData.bodyType === 'multipart') {
    throw new Error('当前后端的 HTTP 模板暂不支持 multipart 文件上传')
  }

  const headers = mapHeaders(httpData.headers)
  const formParams = mapParams(httpData.formData)
  const contentType = getHeaderContentType(headers) ?? BODY_CONTENT_TYPES[httpData.bodyType]
  const isBodyless = ['GET', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE'].includes(httpData.method)

  let bodyData: string | undefined
  let params: Array<{ name: string; value: string }> | undefined

  if (isBodyless) {
    // GET/HEAD/DELETE 等无 body 方法 — queryParams 进入 JMX 的 "参数" 列
    const enabledQuery = httpData.queryParams.filter((p) => p.enabled && p.key)
    if (enabledQuery.length > 0) {
      params = enabledQuery.map((p) => ({ name: p.key.trim(), value: p.value }))
    }
    bodyData = undefined
  } else {
    // 有 body 的方法 — queryParams 仍嵌入 path（JMeter HTTP 请求路径栏）
    if (httpData.bodyType === 'json' && httpData.jsonBody.trim()) bodyData = httpData.jsonBody
    if (httpData.bodyType === 'xml' && httpData.xmlBody.trim()) bodyData = httpData.xmlBody
    if (httpData.bodyType === 'raw' && httpData.rawBody.trim()) bodyData = httpData.rawBody
    if (httpData.bodyType === 'form' && formParams.length > 0) params = formParams
  }

  return {
    name: 'HTTP 请求',
    method: httpData.method,
    protocol: httpData.protocol,
    domain,
    port: Number(httpData.port) || (httpData.protocol === 'https' ? 443 : 80),
    path: isBodyless ? basePath : appendQuery(basePath, httpData.queryParams),
    content_type: contentType ?? undefined,
    body_data: bodyData,
    params,
  }
}

// 单独返回 headers，仅用于 add_more_configs 创建 Header Manager
// 不传给 add_http_request 避免重复
export function buildHttpRequestHeaders(httpData: HttpRequestData): Array<{ name: string; value: string }> {
  return mapHeaders(httpData.headers)
}

function ensureTemplateValues(template: JmeterTemplate, values: TemplateValues) {
  const missing = template.params
    .filter((param) => param.required)
    .find((param) => toText(values[param.key]) === '')

  if (missing) {
    throw new Error(`请填写「${missing.label}」`)
  }
}

function getThreadGroupArgs(values: TemplateValues, name = '主线程组') {
  return {
    name,
    num_threads: toNumber(values.threads, 10),
    ramp_up: toNumber(values.ramp_up, 5),
    loops: toNumber(values.loops, 1),
  }
}

function getListenerType(values: TemplateValues) {
  return toBooleanFlag(values.aggregate_report, true) ? 'aggregate_report' : 'view_results_tree'
}

/** 统一的结果映射：模板构建响应与 AI 生成响应都归一成 GeneratedPlanResult。 */
export function toGeneratedPlanResult(response: JmeterBuildResponse | AiGenerateResponse): GeneratedPlanResult {
  if ('outputPath' in response) {
    return {
      planName: response.planName,
      savedPath: response.outputPath,
      downloadName: response.outputPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'ai-generated.jmx',
      saveMessage: response.saveResult,
      validation: response.validation,
      tree: response.tree,
      steps: response.toolCalls.map((call) => ({
        tool: call.name,
        text: call.result,
      })),
    }
  }

  return {
    planName: response.planName,
    savedPath: response.path,
    downloadName: response.filename,
    saveMessage: response.saveMessage,
    validation: response.validation,
    tree: response.tree,
    steps: response.steps,
  }
}

// ── 模板 → 步骤清单（构建执行在服务端一次完成，见 /api/jmeter/build） ──

function buildHttpStressSpec(
  template: JmeterTemplate,
  values: TemplateValues,
  httpData: HttpRequestData,
): JmeterBuildSpec {
  const planName = buildPlanName(template.name)
  const steps: JmeterBuildStep[] = [
    { tool: 'create_test_plan', args: { name: planName, comments: '由前端 HTTP 模板生成' } },
    { tool: 'add_thread_group', args: getThreadGroupArgs(values) },
  ]

  const httpArgs = buildHttpRequestArgs(httpData)

  // 先添加 Header Manager（config element），再添加 HTTP Request（sampler）
  // JMeter 树中 config element 必须在 sampler 之前
  const requestHeaders = buildHttpRequestHeaders(httpData)
  if (requestHeaders.length > 0) {
    const headerPairs = requestHeaders
      .map((h) => `${h.name}=${h.value}`)
      .join(';')
    steps.push({
      tool: 'add_more_configs',
      args: {
        type: 'http_header_manager',
        name: 'HTTP 请求头管理器',
        headers: headerPairs,
      },
    })
  }

  steps.push({ tool: 'add_http_request', args: httpArgs })

  const assertionCode = toText(values.assertion_code)
  if (assertionCode) {
    steps.push({
      tool: 'add_assertion',
      args: {
        name: '状态码断言',
        type: 'response',
        test_field: 'response_code',
        match_type: 'equals',
        patterns: [assertionCode],
      },
    })
  }

  steps.push({ tool: 'add_listener', args: { type: getListenerType(values) } })
  return { planName, seed: template.id, steps }
}

function buildJdbcStressSpec(template: JmeterTemplate, values: TemplateValues): JmeterBuildSpec {
  const planName = buildPlanName(template.name)
  const dataSource = 'jdbc_pool'

  return {
    planName,
    seed: template.id,
    steps: [
      { tool: 'create_test_plan', args: { name: planName, comments: '由前端 JDBC 模板生成' } },
      { tool: 'add_thread_group', args: getThreadGroupArgs(values) },
      {
        tool: 'add_more_configs',
        args: {
          type: 'jdbc_config',
          name: dataSource,
          pool_max: String(toNumber(values.pool_max, 10)),
          username: toText(values.db_user),
          password: toText(values.db_pass),
          connection_url: toText(values.db_url),
          driver_class: toText(values.db_driver),
        },
      },
      {
        tool: 'add_jdbc_request',
        args: {
          name: 'JDBC 请求',
          dataSource,
          query_type: 'Select Statement',
          sql: toText(values.sql),
        },
      },
      { tool: 'add_listener', args: { type: getListenerType(values) } },
    ],
  }
}

function buildTcpStressSpec(template: JmeterTemplate, values: TemplateValues): JmeterBuildSpec {
  const planName = buildPlanName(template.name)

  return {
    planName,
    seed: template.id,
    steps: [
      { tool: 'create_test_plan', args: { name: planName, comments: '由前端 TCP 模板生成' } },
      { tool: 'add_thread_group', args: getThreadGroupArgs(values) },
      {
        tool: 'add_tcp_sampler',
        args: {
          name: 'TCP 请求',
          server: toText(values.server),
          port: toNumber(values.port, 0),
          request_data: toText(values.request_data),
          reUseConnection: toBooleanFlag(values.re_use, true) ? 'true' : 'false',
        },
      },
      { tool: 'add_listener', args: { type: getListenerType(values) } },
    ],
  }
}

function buildSmtpStressSpec(template: JmeterTemplate, values: TemplateValues): JmeterBuildSpec {
  const planName = buildPlanName(template.name)
  const username = toText(values.sender)

  return {
    planName,
    seed: template.id,
    steps: [
      { tool: 'create_test_plan', args: { name: planName, comments: '由前端 SMTP 模板生成' } },
      { tool: 'add_thread_group', args: getThreadGroupArgs(values) },
      {
        tool: 'add_smtp_sampler',
        args: {
          name: 'SMTP 请求',
          server: toText(values.server),
          port: toNumber(values.port, 25),
          use_auth: username ? 'true' : 'false',
          username,
          sender: username,
          receiver: toText(values.receiver),
          subject: toText(values.subject) || '性能测试邮件',
          body: toText(values.body) || '这是一封性能测试邮件',
          use_ssl: toBooleanFlag(values.use_ssl) ? 'true' : 'false',
        },
      },
      { tool: 'add_listener', args: { type: getListenerType(values) } },
    ],
  }
}

function buildFtpStressSpec(template: JmeterTemplate, values: TemplateValues): JmeterBuildSpec {
  const planName = buildPlanName(template.name)

  return {
    planName,
    seed: template.id,
    steps: [
      { tool: 'create_test_plan', args: { name: planName, comments: '由前端 FTP 模板生成' } },
      { tool: 'add_thread_group', args: getThreadGroupArgs(values) },
      {
        tool: 'add_ftp_sampler',
        args: {
          name: 'FTP 请求',
          server: toText(values.server),
          port: toNumber(values.port, 21),
          username: toText(values.username),
          password: toText(values.password),
          remote_filename: toText(values.remote_file),
          local_filename: toText(values.local_file),
          ftp_action: toText(values.ftp_action) || 'get',
        },
      },
      { tool: 'add_listener', args: { type: getListenerType(values) } },
    ],
  }
}

function buildLdapStressSpec(template: JmeterTemplate, values: TemplateValues): JmeterBuildSpec {
  const planName = buildPlanName(template.name)

  return {
    planName,
    seed: template.id,
    steps: [
      { tool: 'create_test_plan', args: { name: planName, comments: '由前端 LDAP 模板生成' } },
      { tool: 'add_thread_group', args: getThreadGroupArgs(values) },
      {
        tool: 'add_ldap_sampler',
        args: {
          name: 'LDAP 查询',
          server: toText(values.server),
          port: toNumber(values.port, 389),
          search_base: toText(values.search_base),
          search_filter: toText(values.search_filter),
          attributes: toText(values.attributes),
          use_ssl: toBooleanFlag(values.use_ssl),
        },
      },
      { tool: 'add_listener', args: { type: getListenerType(values) } },
    ],
  }
}

function buildScriptSpec(template: JmeterTemplate, values: TemplateValues): JmeterBuildSpec {
  const planName = buildPlanName(template.name)

  return {
    planName,
    seed: template.id,
    steps: [
      { tool: 'create_test_plan', args: { name: planName, comments: '由前端脚本模板生成' } },
      { tool: 'add_thread_group', args: getThreadGroupArgs(values) },
      {
        tool: 'add_script',
        args: {
          name: '脚本采样器',
          type: 'sampler',
          language: toText(values.language) || 'groovy',
          script: toText(values.script),
        },
      },
      { tool: 'add_listener', args: { type: getListenerType(values) } },
    ],
  }
}

function buildSystemCommandSpec(template: JmeterTemplate, values: TemplateValues): JmeterBuildSpec {
  const planName = buildPlanName(template.name)

  return {
    planName,
    seed: template.id,
    steps: [
      { tool: 'create_test_plan', args: { name: planName, comments: '由前端系统命令模板生成' } },
      { tool: 'add_thread_group', args: getThreadGroupArgs(values) },
      {
        tool: 'add_system_sampler',
        args: {
          name: '系统命令',
          command: toText(values.command),
          command_parameters: toText(values.command_params),
          working_directory: toText(values.working_dir),
          interpreter: toText(values.interpreter) || 'cmd.exe',
          check_return_code: 'true',
        },
      },
      { tool: 'add_listener', args: { type: getListenerType(values) } },
    ],
  }
}

function buildBlankSpec(template: JmeterTemplate, values: TemplateValues): JmeterBuildSpec {
  const planName = buildPlanName(template.name)

  return {
    planName,
    seed: template.id,
    steps: [
      { tool: 'create_test_plan', args: { name: planName, comments: '由前端空白模板生成' } },
      { tool: 'add_thread_group', args: getThreadGroupArgs(values) },
      { tool: 'add_listener', args: { type: getListenerType(values) } },
    ],
  }
}

function collectTemplateSpec(
  template: JmeterTemplate,
  values: TemplateValues,
  httpData: HttpRequestData,
): JmeterBuildSpec {
  if (template.id === 'http-stress') {
    return buildHttpStressSpec(template, values, httpData)
  }

  ensureTemplateValues(template, values)

  switch (template.id) {
    case 'jdbc-stress':
      return buildJdbcStressSpec(template, values)
    case 'tcp-stress':
      return buildTcpStressSpec(template, values)
    case 'smtp-stress':
      return buildSmtpStressSpec(template, values)
    case 'ftp-stress':
      return buildFtpStressSpec(template, values)
    case 'ldap-stress':
      return buildLdapStressSpec(template, values)
    case 'jsr223-script':
      return buildScriptSpec(template, values)
    case 'system-command':
      return buildSystemCommandSpec(template, values)
    case 'blank':
      return buildBlankSpec(template, values)
    default:
      throw new Error(`暂未实现模板：${template.name}`)
  }
}

export async function generateTemplatePlan({
  template,
  values,
  httpData,
}: GenerateTemplatePlanOptions): Promise<GeneratedPlanResult> {
  const spec = collectTemplateSpec(template, values, httpData)
  const built = await buildJmeterPlan(spec)
  return toGeneratedPlanResult(built)
}

export async function generateCustomScriptPlan({
  language,
  script,
}: GenerateCustomScriptOptions): Promise<GeneratedPlanResult> {
  const planName = buildPlanName('自定义脚本测试计划')
  const languageText = language.trim() || 'groovy'
  const scriptText = script.trim()

  if (!scriptText) {
    throw new Error('请填写脚本内容')
  }

  const built = await buildJmeterPlan({
    planName,
    seed: 'custom-script',
    steps: [
      { tool: 'create_test_plan', args: { name: planName, comments: '由前端自定义脚本页面生成' } },
      {
        tool: 'add_thread_group',
        args: {
          name: '主线程组',
          num_threads: 1,
          ramp_up: 1,
          loops: 1,
        },
      },
      {
        tool: 'add_script',
        args: {
          name: '自定义脚本',
          type: 'sampler',
          language: languageText,
          script: scriptText,
        },
      },
      { tool: 'add_listener', args: { type: 'view_results_tree' } },
    ],
  })
  return toGeneratedPlanResult(built)
}
