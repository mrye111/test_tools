import { badgeTintOf, glyphColorOf, resolveIcon } from '../lib/project-icons'

interface ProjectIconProps {
  iconKey?: string
  iconColor?: string
  glyphSize?: number
  className?: string
  title?: string
}

/** 项目图标徽标：浅色调底 + 彩色字形（品牌图标为单色 path 染色；语义图标为 lucide 组件）。 */
export function ProjectIcon({ iconKey, iconColor, glyphSize = 18, className, title }: ProjectIconProps) {
  const visual = resolveIcon(iconKey)
  return (
    <span
      className={`project-icon-badge${className ? ` ${className}` : ''}`}
      style={{ color: glyphColorOf(iconColor), background: badgeTintOf(iconColor) }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {visual.kind === 'brand' ? (
        <svg width={glyphSize} height={glyphSize} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={visual.data.path} />
        </svg>
      ) : (
        <visual.option.Icon size={glyphSize} />
      )}
    </span>
  )
}
