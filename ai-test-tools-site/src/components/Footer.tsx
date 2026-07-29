import { motion } from 'motion/react'
import { ExternalLink, Mail, Heart } from 'lucide-react'

export function Footer() {
  return (
    // 深色收边带：与 Hero 深色舞台同族（oklch 214-218），让深色在页面首尾呼应，
    // 浅色内容区成为被"括号"包住的主体，而非与深色 Hero 割裂的另一个世界
    <motion.footer
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -6% 0px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="footer-dark relative z-10 mt-2 text-sm"
    >
      <div className="mx-auto flex max-w-shell items-center justify-between gap-6 px-6 py-10 max-sm:flex-col max-sm:gap-4 max-sm:text-center">
        <div className="flex items-center gap-3">
          <div className="brand-mark flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold tracking-tight text-white">
            AI
          </div>
          <div className="text-left">
            <div className="text-[13px] font-semibold text-white/85">AI测试工具</div>
            <div className="text-[11px] text-white/40">2026 · 面向测试团队的在线工具集</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-white/45">
            Built with
            <Heart className="h-3 w-3 fill-[#6ee7b7] text-[#6ee7b7]" />
          </span>
          <span className="h-3.5 w-px bg-white/15" />
          <a
            href="#"
            className="glass-chip glass-chip-dark px-3 py-1.5 text-xs text-white/70 no-underline transition-colors duration-200 hover:text-[#67e8f9]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="max-sm:hidden">GitHub</span>
          </a>
          <a
            href="#"
            className="glass-chip glass-chip-dark px-3 py-1.5 text-xs text-white/70 no-underline transition-colors duration-200 hover:text-[#67e8f9]"
          >
            <Mail className="h-3.5 w-3.5" />
            <span className="max-sm:hidden">联系我们</span>
          </a>
        </div>
      </div>
    </motion.footer>
  )
}
