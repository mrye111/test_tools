import type { HTMLProps, ReactNode } from 'react'

interface AuroraBackgroundProps extends HTMLProps<HTMLDivElement> {
  children: ReactNode
  showRadialGradient?: boolean
}

// 项目没有 tailwind-merge，简单拼接即可（本组件不依赖冲突类合并）
const cn = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ')

/**
 * Aurora 背景（源自 aceternity aurora-background，按本项目架构适配）：
 * - Tailwind v4 CSS-first 配置：颜色变量与 animate-aurora 令牌在 index.css 的 @theme 注入，
 *   不使用 tailwind.config.js / addVariablesForColors 插件
 * - 移除写死的 h-[100vh]，高度由调用方通过 className 控制（Hero 为 min-h-[88vh]）
 * - 动画仅 background-position（静态 blur，不动 filter），reduced-motion 由全局规则兜底
 */
export function AuroraBackground({
  className,
  children,
  showRadialGradient = true,
  ...props
}: AuroraBackgroundProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center bg-zinc-50 text-slate-950 transition-colors',
        className,
      )}
      {...props}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          className={cn(
            `
          [--white-gradient:repeating-linear-gradient(100deg,var(--white)_0%,var(--white)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--white)_16%)]
          [--aurora:repeating-linear-gradient(100deg,var(--blue-500)_10%,var(--indigo-300)_15%,var(--blue-300)_20%,var(--violet-200)_25%,var(--blue-400)_30%)]
          [background-image:var(--white-gradient),var(--aurora)]
          [background-size:300%,_200%]
          [background-position:50%_50%,50%_50%]
          filter blur-[10px] invert
          after:content-[""] after:absolute after:inset-0 after:[background-image:var(--white-gradient),var(--aurora)]
          after:[background-size:200%,_100%]
          after:animate-aurora after:[background-attachment:fixed] after:mix-blend-difference
          pointer-events-none
          absolute -inset-[10px] opacity-50`,
            showRadialGradient &&
              `[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,var(--transparent)_70%)]`,
          )}
        />
      </div>
      {children}
    </div>
  )
}
