/**
 * 项目图标注册表与配色模型（领域术语：ProjectIcon）。
 *
 * - 图形隐喻图标：lucide（ISC 免费商用）精选内置，key 前缀 `sem:`；
 * - 品牌标志图标：Simple Icons（CC0）收编数据，key 前缀 `brand:`，默认字形色为品牌官方色；
 * - 配色：预设 10 色板存字形色（CSS 颜色值），徽标底色渲染时取该色同色系浅色调；
 *   未配置颜色（存量项目）回落到主题蓝（`var(--color-accent)`）。
 */

import {
  Bell,
  BookOpen,
  Boxes,
  Bug,
  Building2,
  Briefcase,
  Calendar,
  Camera,
  Car,
  ChartColumn,
  Cloud,
  Coffee,
  CodeXml,
  Cpu,
  CreditCard,
  Database,
  FileText,
  FlaskConical,
  FolderKanban,
  Gamepad2,
  Globe,
  GraduationCap,
  HardDrive,
  Heart,
  House,
  Landmark,
  Layers,
  Lock,
  MapPin,
  Megaphone,
  MessageCircle,
  Music,
  Newspaper,
  Package,
  Palette,
  Plane,
  Puzzle,
  Rocket,
  Search,
  Server,
  Settings,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Stethoscope,
  Store,
  Terminal,
  Ticket,
  Truck,
  Tv,
  Users,
  Video,
  Wallet,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import { BRAND_ICONS, type BrandIconData } from './brand-icons.generated'

export interface SemanticIconOption {
  key: string
  label: string
  Icon: LucideIcon
}

export const DEFAULT_ICON_KEY = 'sem:folder-kanban'

export const SEMANTIC_ICONS: SemanticIconOption[] = [
  { key: 'sem:folder-kanban', label: '项目', Icon: FolderKanban },
  { key: 'sem:shopping-cart', label: '电商', Icon: ShoppingCart },
  { key: 'sem:flask-conical', label: '实验', Icon: FlaskConical },
  { key: 'sem:smartphone', label: '移动端', Icon: Smartphone },
  { key: 'sem:cloud', label: '云', Icon: Cloud },
  { key: 'sem:database', label: '数据', Icon: Database },
  { key: 'sem:shield', label: '防护', Icon: Shield },
  { key: 'sem:rocket', label: '发布', Icon: Rocket },
  { key: 'sem:gamepad-2', label: '游戏', Icon: Gamepad2 },
  { key: 'sem:music', label: '音乐', Icon: Music },
  { key: 'sem:video', label: '视频', Icon: Video },
  { key: 'sem:camera', label: '图像', Icon: Camera },
  { key: 'sem:book-open', label: '文档', Icon: BookOpen },
  { key: 'sem:graduation-cap', label: '教育', Icon: GraduationCap },
  { key: 'sem:heart', label: '医疗', Icon: Heart },
  { key: 'sem:plane', label: '出行', Icon: Plane },
  { key: 'sem:car', label: '车辆', Icon: Car },
  { key: 'sem:house', label: '生活', Icon: House },
  { key: 'sem:building-2', label: '企业', Icon: Building2 },
  { key: 'sem:credit-card', label: '支付', Icon: CreditCard },
  { key: 'sem:wallet', label: '钱包', Icon: Wallet },
  { key: 'sem:package', label: '包裹', Icon: Package },
  { key: 'sem:truck', label: '配送', Icon: Truck },
  { key: 'sem:map-pin', label: '位置', Icon: MapPin },
  { key: 'sem:globe', label: '网站', Icon: Globe },
  { key: 'sem:wifi', label: '网络', Icon: Wifi },
  { key: 'sem:server', label: '服务', Icon: Server },
  { key: 'sem:hard-drive', label: '存储', Icon: HardDrive },
  { key: 'sem:cpu', label: '算力', Icon: Cpu },
  { key: 'sem:code-xml', label: '研发', Icon: CodeXml },
  { key: 'sem:bug', label: '测试', Icon: Bug },
  { key: 'sem:terminal', label: '命令行', Icon: Terminal },
  { key: 'sem:puzzle', label: '组件', Icon: Puzzle },
  { key: 'sem:palette', label: '设计', Icon: Palette },
  { key: 'sem:megaphone', label: '营销', Icon: Megaphone },
  { key: 'sem:message-circle', label: '沟通', Icon: MessageCircle },
  { key: 'sem:users', label: '团队', Icon: Users },
  { key: 'sem:settings', label: '配置', Icon: Settings },
  { key: 'sem:lock', label: '安全', Icon: Lock },
  { key: 'sem:bell', label: '通知', Icon: Bell },
  { key: 'sem:calendar', label: '日程', Icon: Calendar },
  { key: 'sem:file-text', label: '报表', Icon: FileText },
  { key: 'sem:chart-column', label: '分析', Icon: ChartColumn },
  { key: 'sem:search', label: '搜索', Icon: Search },
  { key: 'sem:layers', label: '平台', Icon: Layers },
  { key: 'sem:boxes', label: '仓库', Icon: Boxes },
  { key: 'sem:store', label: '门店', Icon: Store },
  { key: 'sem:coffee', label: '生活服务', Icon: Coffee },
  { key: 'sem:stethoscope', label: '健康', Icon: Stethoscope },
  { key: 'sem:landmark', label: '金融', Icon: Landmark },
  { key: 'sem:briefcase', label: '商业', Icon: Briefcase },
  { key: 'sem:newspaper', label: '资讯', Icon: Newspaper },
  { key: 'sem:tv', label: '影音', Icon: Tv },
  { key: 'sem:ticket', label: '票务', Icon: Ticket },
  { key: 'sem:sparkles', label: 'AI', Icon: Sparkles },
]

export interface PaletteColor {
  key: string
  label: string
  hex: string
}

/** 预设 10 色板（字形色）。不提供自由取色器，保证项目卡片网格整体协调。 */
export const PROJECT_PALETTE: PaletteColor[] = [
  { key: 'blue', label: '蓝', hex: '#5B6CF0' },
  { key: 'indigo', label: '靛', hex: '#3E63DD' },
  { key: 'violet', label: '紫', hex: '#8E4EC6' },
  { key: 'teal', label: '青', hex: '#12A594' },
  { key: 'green', label: '绿', hex: '#30A46C' },
  { key: 'amber', label: '金', hex: '#FFB224' },
  { key: 'orange', label: '橙', hex: '#F76B15' },
  { key: 'red', label: '红', hex: '#E5484D' },
  { key: 'brown', label: '棕', hex: '#AD7A59' },
  { key: 'slate', label: '石板灰', hex: '#626D83' },
]

export type IconVisual =
  | { kind: 'semantic'; option: SemanticIconOption }
  | { kind: 'brand'; data: BrandIconData }

export function resolveIcon(iconKey?: string): IconVisual {
  const key = iconKey ?? ''
  if (key.startsWith('brand:')) {
    const data = BRAND_ICONS.find((item) => item.key === key)
    if (data) return { kind: 'brand', data }
  }
  const option = SEMANTIC_ICONS.find((item) => item.key === key) ?? SEMANTIC_ICONS[0]
  return { kind: 'semantic', option }
}

/** 图标默认字形色：品牌图标取品牌官方色；其余为空串表示回落主题蓝。 */
export function defaultColorFor(iconKey?: string): string {
  const visual = resolveIcon(iconKey)
  return visual.kind === 'brand' ? visual.data.officialColor : ''
}

/** 字形实际颜色：显式配色优先，未配置回落主题蓝（与存量项目视觉一致）。 */
export function glyphColorOf(iconColor?: string): string {
  return iconColor?.trim() || 'var(--color-accent)'
}

/** 徽标底色：所选色 ~12% 同色系浅色调；未配置回落现有浅灰蓝底。 */
export function badgeTintOf(iconColor?: string): string {
  const color = iconColor?.trim()
  return color ? `color-mix(in oklab, ${color} 12%, white)` : 'oklch(0.96 0.018 264)'
}

export function brandIconByKey(iconKey: string): BrandIconData | undefined {
  return BRAND_ICONS.find((item) => item.key === iconKey)
}
