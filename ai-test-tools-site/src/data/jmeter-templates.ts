export interface TemplateParam {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'textarea'
  default?: string | number
  required?: boolean
  placeholder?: string
  options?: { label: string; value: string }[]
  description?: string
}

export interface JmeterTemplate {
  id: string
  name: string
  category: 'common' | 'advanced' | 'blank'
  description: string
  samplerType: string
  icon: string
  params: TemplateParam[]
}

const commonParams: TemplateParam[] = [
  { key: 'threads', label: '并发线程数', type: 'number', default: 10, required: true, placeholder: '10' },
  { key: 'ramp_up', label: '启动时间(秒)', type: 'number', default: 5, placeholder: '5' },
  { key: 'loops', label: '循环次数', type: 'number', default: 10, placeholder: '10' },
  { key: 'aggregate_report', label: '聚合报告', type: 'select', default: 'true', options: [
    { label: '开启', value: 'true' },
    { label: '关闭', value: 'false' },
  ]},
]

export const jmeterTemplates: JmeterTemplate[] = [
  {
    id: 'http-stress',
    name: 'API 压力测试',
    category: 'common',
    description: 'REST/Web 接口并发压测，支持自定义请求方法、请求头、请求体',
    samplerType: 'HTTP',
    icon: 'HTTP',
    params: [
      { key: 'domain', label: '目标域名', type: 'text', required: true, placeholder: 'api.example.com' },
      { key: 'port', label: '端口', type: 'number', default: 443, placeholder: '443' },
      { key: 'protocol', label: '协议', type: 'select', default: 'https', options: [
        { label: 'HTTPS', value: 'https' },
        { label: 'HTTP', value: 'http' },
      ]},
      { key: 'path', label: '请求路径', type: 'text', required: true, placeholder: '/api/users' },
      { key: 'method', label: '请求方法', type: 'select', default: 'GET', options: [
        { label: 'GET', value: 'GET' },
        { label: 'POST', value: 'POST' },
        { label: 'PUT', value: 'PUT' },
        { label: 'DELETE', value: 'DELETE' },
        { label: 'PATCH', value: 'PATCH' },
      ]},
      { key: 'content_type', label: 'Content-Type', type: 'text', default: 'application/json', placeholder: 'application/json' },
      { key: 'body_data', label: '请求体', type: 'textarea', placeholder: '{"key": "value"}' },
      { key: 'headers', label: '自定义请求头', type: 'textarea', placeholder: '{"Authorization": "Bearer xxx"}' },
      ...commonParams,
      { key: 'assertion_code', label: '断言状态码', type: 'text', default: '200', placeholder: '200' },
    ],
  },
  {
    id: 'jdbc-stress',
    name: '数据库性能测试',
    category: 'common',
    description: 'SQL 查询性能测试，支持连接池配置',
    samplerType: 'JDBC',
    icon: 'DB',
    params: [
      { key: 'db_url', label: '数据库连接URL', type: 'text', required: true, placeholder: 'jdbc:mysql://localhost:3306/testdb' },
      { key: 'db_driver', label: '驱动类', type: 'text', required: true, placeholder: 'com.mysql.cj.jdbc.Driver' },
      { key: 'db_user', label: '用户名', type: 'text', required: true, placeholder: 'root' },
      { key: 'db_pass', label: '密码', type: 'text', required: true, placeholder: 'password' },
      { key: 'sql', label: 'SQL 语句', type: 'textarea', required: true, placeholder: 'SELECT * FROM users WHERE id = 1' },
      { key: 'pool_max', label: '最大连接数', type: 'number', default: 10, placeholder: '10' },
      ...commonParams,
    ],
  },
  {
    id: 'tcp-stress',
    name: 'TCP 连接测试',
    category: 'common',
    description: 'Socket/TCP 长连接服务性能测试',
    samplerType: 'TCP',
    icon: 'TCP',
    params: [
      { key: 'server', label: '服务器地址', type: 'text', required: true, placeholder: '127.0.0.1' },
      { key: 'port', label: '端口', type: 'number', required: true, placeholder: '8080' },
      { key: 'request_data', label: '发送数据', type: 'textarea', required: true, placeholder: 'Hello Server' },
      { key: 're_use', label: '复用连接', type: 'select', default: 'true', options: [
        { label: '是', value: 'true' },
        { label: '否', value: 'false' },
      ]},
      ...commonParams,
    ],
  },
  {
    id: 'smtp-stress',
    name: '邮件发送测试',
    category: 'common',
    description: 'SMTP 邮件服务器吞吐量测试',
    samplerType: 'SMTP',
    icon: 'SMTP',
    params: [
      { key: 'server', label: 'SMTP 服务器', type: 'text', required: true, placeholder: 'smtp.example.com' },
      { key: 'port', label: '端口', type: 'number', default: 25, placeholder: '25' },
      { key: 'sender', label: '发件人', type: 'text', required: true, placeholder: 'sender@example.com' },
      { key: 'receiver', label: '收件人', type: 'text', required: true, placeholder: 'receiver@example.com' },
      { key: 'subject', label: '邮件主题', type: 'text', default: '性能测试邮件', placeholder: '性能测试邮件' },
      { key: 'body', label: '邮件正文', type: 'textarea', default: '这是一封性能测试邮件', placeholder: '邮件内容' },
      { key: 'use_ssl', label: '使用SSL', type: 'select', default: 'false', options: [
        { label: '否', value: 'false' },
        { label: '是', value: 'true' },
      ]},
      ...commonParams,
    ],
  },
  {
    id: 'ftp-stress',
    name: '文件传输测试',
    category: 'common',
    description: 'FTP 上传/下载性能测试',
    samplerType: 'FTP',
    icon: 'FTP',
    params: [
      { key: 'server', label: 'FTP 服务器', type: 'text', required: true, placeholder: 'ftp.example.com' },
      { key: 'port', label: '端口', type: 'number', default: 21, placeholder: '21' },
      { key: 'username', label: '用户名', type: 'text', required: true, placeholder: 'ftpuser' },
      { key: 'password', label: '密码', type: 'text', required: true, placeholder: 'ftppass' },
      { key: 'remote_file', label: '远程文件路径', type: 'text', required: true, placeholder: '/files/test.txt' },
      { key: 'local_file', label: '本地文件路径', type: 'text', placeholder: './test.txt' },
      { key: 'ftp_action', label: '操作', type: 'select', default: 'get', options: [
        { label: '下载', value: 'get' },
        { label: '上传', value: 'put' },
        { label: '删除', value: 'delete' },
        { label: '列表', value: 'list' },
      ]},
      ...commonParams,
    ],
  },
  {
    id: 'ldap-stress',
    name: 'LDAP 目录测试',
    category: 'common',
    description: 'LDAP 目录服务查询性能测试',
    samplerType: 'LDAP',
    icon: 'LDAP',
    params: [
      { key: 'server', label: 'LDAP 服务器', type: 'text', required: true, placeholder: 'ldap.example.com' },
      { key: 'port', label: '端口', type: 'number', default: 389, placeholder: '389' },
      { key: 'search_base', label: '搜索基 DN', type: 'text', required: true, placeholder: 'dc=example,dc=com' },
      { key: 'search_filter', label: '搜索过滤器', type: 'text', required: true, placeholder: '(uid=testuser)' },
      { key: 'attributes', label: '返回属性', type: 'text', placeholder: 'cn,mail,uid' },
      { key: 'use_ssl', label: '使用SSL', type: 'select', default: 'false', options: [
        { label: '否', value: 'false' },
        { label: '是', value: 'true' },
      ]},
      ...commonParams,
    ],
  },
  {
    id: 'jsr223-script',
    name: '自定义脚本(JSR223)',
    category: 'advanced',
    description: '使用 Groovy/JavaScript/Python 编写自定义测试逻辑',
    samplerType: 'JSR223',
    icon: 'JSR',
    params: [
      { key: 'language', label: '脚本语言', type: 'select', default: 'groovy', options: [
        { label: 'Groovy', value: 'groovy' },
        { label: 'JavaScript', value: 'javascript' },
        { label: 'Python', value: 'python' },
        { label: 'BeanShell', value: 'beanshell' },
      ]},
      { key: 'script', label: '脚本内容', type: 'textarea', required: true, placeholder: '// 在此编写脚本\nlog.info("Hello JMeter!")' },
      ...commonParams,
    ],
  },
  {
    id: 'system-command',
    name: '系统命令测试',
    category: 'advanced',
    description: '执行本地系统命令/脚本进行压测',
    samplerType: 'System',
    icon: 'SYS',
    params: [
      { key: 'command', label: '命令', type: 'text', required: true, placeholder: 'ping' },
      { key: 'command_params', label: '命令参数', type: 'text', placeholder: '-c 4 localhost' },
      { key: 'working_dir', label: '工作目录', type: 'text', placeholder: '/tmp' },
      { key: 'interpreter', label: '解释器', type: 'select', default: 'cmd.exe', options: [
        { label: 'cmd.exe', value: 'cmd.exe' },
        { label: 'bash', value: 'bash' },
        { label: 'powershell', value: 'powershell' },
      ]},
      ...commonParams,
    ],
  },
  {
    id: 'blank',
    name: '从零开始',
    category: 'blank',
    description: '空白模板，完全自定义构建测试计划',
    samplerType: 'Custom',
    icon: 'NEW',
    params: [
      ...commonParams,
    ],
  },
]
