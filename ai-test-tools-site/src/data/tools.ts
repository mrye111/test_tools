import {
  Gauge,
  FileText,
  BarChart3,
  Lock,
  Sparkles,
  Code2,
  type LucideIcon,
} from 'lucide-react'

export interface Tool {
  id: string
  title: string
  description: string
  icon: LucideIcon
  href: string
}

export const tools: Tool[] = [
  {
    id: 'jmeter-script',
    title: 'Jmeter脚本',
    description: '性能测试模板、AI智能生成、自定义脚本，一键导出.jmx',
    icon: Gauge,
    href: '/jmeter',
  },
  {
    id: 'testcase-generator',
    title: '用例生成',
    description: 'AI 生成测试用例列表，支持 Excel/XMind 及项目管理平台格式导出',
    icon: FileText,
    href: '/testcase',
  },
  {
    id: 'test-report',
    title: '测试报告',
    description: '导入测试用例与 BUG 数据，自动生成可视化质量分析报告',
    icon: BarChart3,
    href: '/testreport',
  },
  {
    id: 'encryption',
    title: '加密解密',
    description: 'Base64、MD5、AES 编解码，本地运算不上传',
    icon: Lock,
    href: '#',
  },
  {
    id: 'ai-assistant',
    title: '智能助手',
    description: 'AI 驱动的写作、翻译与摘要，一键生成结果',
    icon: Sparkles,
    href: '#',
  },
  {
    id: 'dev-tools',
    title: '开发工具',
    description: 'JSON 格式化、正则测试、颜色拾取器一站集成',
    icon: Code2,
    href: '#',
  },
]
