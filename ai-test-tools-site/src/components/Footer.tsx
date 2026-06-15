import { ExternalLink, Mail, Heart } from 'lucide-react'

export function Footer() {
  return (
    <footer className="relative z-10 mx-auto mb-6 flex max-w-[1200px] items-center justify-between rounded-[24px] border border-[oklch(0.92_0.008_260/0.64)] bg-white/52 px-6 py-5 text-sm text-muted shadow-[0_20px_50px_-42px_oklch(0.18_0.02_262/0.4)] backdrop-blur max-sm:mx-3 max-sm:flex-col max-sm:gap-3 max-sm:text-center">
      <div className="flex items-center gap-2">
        <span className="text-xs">2026 AI测试工具</span>
        <span className="text-[oklch(0.82_0.02_260)]">|</span>
        <span className="flex items-center gap-1 text-xs">
          Built with
          <Heart className="h-3 w-3 text-accent" />
        </span>
      </div>

      <div className="flex items-center gap-4">
        <a
          href="#"
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted no-underline transition-all duration-200 hover:bg-[oklch(0.62_0.18_265/0.06)] hover:text-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="max-sm:hidden">GitHub</span>
        </a>
        <a
          href="#"
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted no-underline transition-all duration-200 hover:bg-[oklch(0.62_0.18_265/0.06)] hover:text-accent"
        >
          <Mail className="h-3.5 w-3.5" />
          <span className="max-sm:hidden">联系我们</span>
        </a>
      </div>
    </footer>
  )
}
