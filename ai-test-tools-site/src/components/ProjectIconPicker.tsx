import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { BRAND_ICONS } from '../lib/brand-icons.generated'
import { PROJECT_PALETTE, SEMANTIC_ICONS, defaultColorFor, resolveIcon } from '../lib/project-icons'
import { ProjectIcon } from './ProjectIcon'

interface ProjectIconPickerProps {
  iconKey: string
  iconColor: string
  /** 选图标（增量）：品牌图标带官方默认色；语义图标不带色（沿用当前配色） */
  onSelectIcon: (iconKey: string, defaultColor?: string) => void
  /** 选配色（增量）：覆盖字形色 */
  onSelectColor: (iconColor: string) => void
}

/**
 * 项目图标选择器：图形隐喻（lucide）+ 品牌标志（Simple Icons 收编）两组网格 + 搜索 + 10 色板。
 * 选品牌图标自动带品牌官方色；点色板覆盖配色；语义图标沿用当前配色（空 = 主题蓝）。
 * 回调为增量式（选图标/选配色分离），避免快速连点时整体对象互相覆盖。
 */
export function ProjectIconPicker({ iconKey, iconColor, onSelectIcon, onSelectColor }: ProjectIconPickerProps) {
  const [query, setQuery] = useState('')
  const keyword = query.trim().toLowerCase()
  const preview = resolveIcon(iconKey)

  const semanticMatches = useMemo(
    () => SEMANTIC_ICONS.filter((item) => !keyword || item.label.toLowerCase().includes(keyword) || item.key.includes(keyword)),
    [keyword],
  )
  const brandMatches = useMemo(
    () => BRAND_ICONS.filter((item) => !keyword || item.title.toLowerCase().includes(keyword) || item.key.includes(keyword)),
    [keyword],
  )

  return (
    <div className="project-icon-picker">
      <div className="project-icon-picker-topline">
        <ProjectIcon iconKey={iconKey} iconColor={iconColor} glyphSize={22} />
        <div className="project-icon-search">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索图标"
            aria-label="搜索图标"
          />
        </div>
      </div>

      <div className="project-icon-palette" role="group" aria-label="图标配色">
        {PROJECT_PALETTE.map((color) => (
          <button
            key={color.key}
            type="button"
            aria-label={`配色 ${color.label}`}
            aria-pressed={iconColor.toLowerCase() === color.hex.toLowerCase()}
            className={`project-icon-swatch${iconColor.toLowerCase() === color.hex.toLowerCase() ? ' is-active' : ''}`}
            style={{ background: color.hex }}
            onClick={() => onSelectColor(color.hex)}
          />
        ))}
      </div>

      {semanticMatches.length > 0 && (
        <div className="project-icon-group">
          <p className="project-icon-group-title">图形隐喻</p>
          <div className="project-icon-grid">
            {semanticMatches.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-label={item.label}
                aria-pressed={iconKey === item.key}
                className={`project-icon-option${iconKey === item.key ? ' is-active' : ''}`}
                onClick={() => onSelectIcon(item.key)}
              >
                <item.Icon size={18} />
              </button>
            ))}
          </div>
        </div>
      )}

      {brandMatches.length > 0 && (
        <div className="project-icon-group">
          <p className="project-icon-group-title">品牌标志</p>
          <div className="project-icon-grid">
            {brandMatches.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-label={item.title}
                aria-pressed={iconKey === item.key}
                className={`project-icon-option${iconKey === item.key ? ' is-active' : ''}`}
                onClick={() => onSelectIcon(item.key, defaultColorFor(item.key))}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d={item.path} />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {semanticMatches.length === 0 && brandMatches.length === 0 && (
        <p className="project-icon-empty">没有匹配「{query}」的图标</p>
      )}

      <p className="project-icon-picker-hint">
        当前：{preview.kind === 'brand' ? preview.data.title : preview.option.label}
        {iconColor ? ' · 自定义配色' : ' · 默认配色'}
      </p>
    </div>
  )
}
