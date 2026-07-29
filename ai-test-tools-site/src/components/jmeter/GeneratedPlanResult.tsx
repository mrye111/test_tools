import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, Download, FileText, Loader2 } from 'lucide-react'
import type { GeneratedPlanResult } from '../../lib/jmeter-builders'
import { parseJmeterTree, type JmeterTreeNode } from '../../lib/jmeter-api'

interface Props {
  result: GeneratedPlanResult | null
  error: string | null
  downloading?: boolean
  onDownload?: () => void | Promise<void>
}

const JMETER_CLASS_LABELS: Record<string, string> = {
  TestPlan: '测试计划',
  ThreadGroup: '线程组',
  SetupThreadGroup: '前置线程组',
  PostThreadGroup: '后置线程组',
  HTTPSamplerProxy: 'HTTP 请求',
  HeaderManager: 'HTTP 请求头',
  ConfigTestElement: '配置元件',
  Arguments: '用户变量',
  CookieManager: 'Cookie 管理器',
  CacheManager: '缓存管理器',
  DNSCacheManager: 'DNS 缓存管理器',
  CSVDataSet: 'CSV 数据文件设置',
  JDBCDataSource: 'JDBC 连接配置',
  DataSourceElement: 'JDBC 连接配置',
  ResponseAssertion: '响应断言',
  JSONPathAssertion: 'JSON Path 断言',
  DurationAssertion: '持续时间断言',
  XPath2Assertion: 'XPath 断言',
  JMESPathAssertion: 'JMESPath 断言',
  XMLAssertion: 'XML 断言',
  XMLSchemaAssertion: 'XML Schema 断言',
  SizeAssertion: '大小断言',
  MD5HexAssertion: 'MD5 断言',
  BeanShellAssertion: 'BeanShell 断言',
  JSR223Assertion: 'JSR223 断言',
  RegexExtractor: '正则提取器',
  JSONPostProcessor: 'JSON 提取器',
  JMESPathExtractor: 'JMESPath 提取器',
  XPathExtractor: 'XPath 提取器',
  XPath2Extractor: 'XPath2 提取器',
  BoundaryExtractor: '边界提取器',
  HtmlExtractor: 'CSS 提取器',
  ConstantTimer: '固定定时器',
  UniformRandomTimer: '均匀随机定时器',
  GaussianRandomTimer: '高斯随机定时器',
  ConstantThroughputTimer: '固定吞吐量定时器',
  SyncTimer: '同步定时器',
  PoissonRandomTimer: '泊松随机定时器',
  BeanShellTimer: 'BeanShell 定时器',
  ResultCollector: '监听器',
  BackendListener: '后端监听器',
  JSR223Listener: 'JSR223 监听器',
  BeanShellListener: 'BeanShell 监听器',
  GenericController: '简单控制器',
  LoopController: '循环控制器',
  IfController: 'If 控制器',
  WhileController: 'While 控制器',
  ForeachController: 'ForEach 控制器',
  TransactionController: '事务控制器',
  ThroughputController: '吞吐量控制器',
  OnceOnlyController: '仅一次控制器',
  RandomOrderController: '随机顺序控制器',
  SwitchController: 'Switch 控制器',
  RunTime: '运行时间控制器',
  InterleaveControl: '交替控制器',
  RandomController: '随机控制器',
  CriticalSectionController: '临界区控制器',
  IncludeController: '包含控制器',
  ModuleController: '模块控制器',
  JSR223Sampler: 'JSR223 采样器',
  BeanShellSampler: 'BeanShell 采样器',
  JavaSampler: 'Java 请求',
  DebugSampler: '调试采样器',
  TestAction: '测试动作',
  TCPSampler: 'TCP 请求',
  FTPSampler: 'FTP 请求',
  MailReaderSampler: '邮件读取请求',
  LDAPExtSampler: 'LDAP 扩展请求',
  LDAPSampler: 'LDAP 请求',
  JMSSampler: 'JMS 请求',
  SystemSampler: '系统命令',
  JSR223PreProcessor: 'JSR223 前置处理器',
  JSR223PostProcessor: 'JSR223 后置处理器',
  BeanShellPreProcessor: 'BeanShell 前置处理器',
  BeanShellPostProcessor: 'BeanShell 后置处理器',
}

function toChineseClassName(testClass: string) {
  return JMETER_CLASS_LABELS[testClass] ?? testClass
}

function collectExpandedPaths(nodes: JmeterTreeNode[], bucket = new Set<string>()) {
  nodes.forEach((node) => {
    if (node.children.length > 0) {
      bucket.add(node.path)
      collectExpandedPaths(node.children, bucket)
    }
  })
  return bucket
}

export function GeneratedPlanResult({ result, error, downloading = false, onDownload }: Props) {
  const treeText = useMemo(() => result?.tree ?? '', [result?.tree])
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())

  const treeNodes = useMemo(() => parseJmeterTree(treeText), [treeText])

  const expandedPaths = useMemo(() => {
    const expanded = collectExpandedPaths(treeNodes)
    for (const path of collapsedPaths) {
      expanded.delete(path)
    }
    return expanded
  }, [treeNodes, collapsedPaths])

  const renderTreeNode = (node: JmeterTreeNode) => {
    const hasChildren = node.children.length > 0
    const isExpanded = expandedPaths.has(node.path)

    return (
      <div key={node.path} className="space-y-1">
        <div
          className="flex w-full items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-left transition-all hover:bg-[oklch(0.985_0.003_264/0.85)]"
          style={{ paddingLeft: `${12 + node.depth * 18}px` }}
        >
          <span
            onClick={() => {
              if (!hasChildren) return
              setCollapsedPaths((prev) => {
                const next = new Set(prev)
                if (next.has(node.path)) next.delete(node.path)
                else next.add(node.path)
                return next
              })
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-muted"
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.72_0.015_264)]" />
            )}
          </span>
          <span className={`h-2 w-2 shrink-0 rounded-full ${node.enabled ? 'bg-success' : 'bg-muted-soft'}`} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{node.name}</span>
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
            {toChineseClassName(node.testClass)}
          </span>
        </div>

        {hasChildren && isExpanded && (
          <div className="space-y-1">
            {node.children.map(renderTreeNode)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="status-panel danger-panel px-4 py-3 text-sm text-danger">
          <div className="relative z-[1] flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="surface-panel rounded-[26px] p-4">
            <div className="relative z-[1]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-accent" />
                  <div className="text-sm font-semibold text-fg">JMeter 计划树</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {onDownload && (
                    <button
                      type="button"
                      onClick={onDownload}
                      disabled={downloading}
                      className="primary-action px-4 py-2 text-sm disabled:opacity-50"
                    >
                      {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {downloading ? '下载中...' : '下载 .jmx'}
                    </button>
                  )}
                </div>
              </div>

              {treeNodes.length > 0 ? (
                <div className="max-h-[56vh] overflow-y-auto pr-2">
                  <div className="space-y-1.5">
                    {treeNodes.map(renderTreeNode)}
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="empty-state-title">暂无可展示的计划树</div>
                  <div className="empty-state-description">
                    当前测试计划树为空，或树数据尚未成功加载。
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="sr-only" aria-hidden="true">
            {result.savedPath}
            {result.planName}
          </div>
        </div>
      )}
    </div>
  )
}
