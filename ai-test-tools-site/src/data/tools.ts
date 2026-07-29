import {
  Gauge,
  FileText,
  BarChart3,
  Database,
  FileSearch,
  Code2,
  type LucideIcon,
} from 'lucide-react'

export interface Tool {
  id: string
  title: string
  description: string
  tag: string
  icon: LucideIcon
  href: string
}

export const tools: Tool[] = [
  {
    id: 'jmeter-script',
    title: 'Jmeter脚本',
    description: '性能测试模板、AI智能生成、自定义脚本，一键导出.jmx',
    tag: '性能压测',
    icon: Gauge,
    href: '/jmeter',
  },
  {
    id: 'testcase-generator',
    title: '用例生成',
    description: 'AI 生成测试用例列表，支持 Excel/XMind 及项目管理平台格式导出',
    tag: '用例设计',
    icon: FileText,
    href: '/testcase',
  },
  {
    id: 'test-report',
    title: '测试报告',
    description: '导入测试用例与 BUG 数据，自动生成可视化质量分析报告',
    tag: '质量报告',
    icon: BarChart3,
    href: '/testreport',
  },
  {
    id: 'data-factory',
    title: '数据工厂',
    description: '测试数据生成、编码解码、字符串处理、加密哈希一站集成',
    tag: '数据处理',
    icon: Database,
    href: '/data-factory',
  },
  {
    id: 'requirement-analysis',
    title: '需求分析',
    description: '上传需求文档，AI 分析生成需求脑图与风险结论',
    tag: '需求洞察',
    icon: FileSearch,
    href: '/requirement-analysis',
  },
  {
    id: 'dev-tools',
    title: '开发工具',
    description: 'JSON 格式化、正则测试、颜色拾取器一站集成',
    tag: '开发辅助',
    icon: Code2,
    href: '#',
  },
]
