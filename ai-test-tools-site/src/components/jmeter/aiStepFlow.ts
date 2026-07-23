type ToolArgs = Record<string, unknown>

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function suffix(text: string) {
  return text ? ` · ${text}` : ''
}

function prettifyToolName(name: string) {
  return name
    .split('_')
    .filter(Boolean)
    .map((part) => part.toUpperCase() === 'HTTP' ? 'HTTP' : part)
    .join(' ')
}

export function formatAiToolStep(name: string, args: ToolArgs = {}) {
  const displayName = readString(args.name)
  const type = readString(args.type)

  switch (name) {
    case 'create_test_plan':
      return `创建测试计划${suffix(displayName)}`
    case 'add_thread_group':
      return `创建线程组${suffix(displayName)}`
    case 'add_http_request':
      return `创建 HTTP 请求${suffix(displayName)}`
    case 'add_more_configs':
      if (type === 'http_defaults') return `创建 HTTP 默认配置${suffix(displayName)}`
      if (type === 'http_header_manager') return `创建 HTTP 请求头${suffix(displayName)}`
      if (type === 'jdbc_config') return `创建 JDBC 配置${suffix(displayName)}`
      return `创建配置元素${suffix(displayName || type)}`
    case 'add_assertion':
      return `创建断言${suffix(displayName || type)}`
    case 'add_listener':
    case 'add_more_listeners':
    case 'add_backend_listener':
    case 'add_aggregate_graph':
      return `创建监听器${suffix(displayName || type)}`
    case 'add_jdbc_request':
      return `创建 JDBC 请求${suffix(displayName)}`
    case 'add_tcp_sampler':
      return `创建 TCP 请求${suffix(displayName)}`
    case 'add_smtp_sampler':
      return `创建 SMTP 请求${suffix(displayName)}`
    case 'add_ftp_sampler':
      return `创建 FTP 请求${suffix(displayName)}`
    case 'add_ldap_sampler':
      return `创建 LDAP 请求${suffix(displayName)}`
    case 'add_script':
      return `创建脚本步骤${suffix(displayName)}`
    case 'add_system_sampler':
      return `创建系统命令步骤${suffix(displayName)}`
    case 'validate_test_plan':
      return '校验测试计划'
    case 'save_test_plan':
      return '保存测试计划'
    case 'list_test_plan_tree':
      return '读取测试计划树'
    default:
      return `执行 ${prettifyToolName(name)}${suffix(displayName || type)}`
  }
}
