export function Hero() {
  return (
    <section className="mx-auto max-w-[1200px] px-6 pb-8 pt-16 text-center max-lg:px-4 max-lg:pt-12 max-sm:px-3 max-sm:pb-6">
      <div className="relative mx-auto max-w-[760px]">
        <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-[520px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative z-[1]">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[rgba(37,99,235,0.18)] bg-white/72 px-3 py-1.5 font-mono text-xs uppercase tracking-[0.08em] text-accent shadow-[0_16px_35px_-30px_rgba(15,23,42,0.5)] backdrop-blur">
            <span className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
            AI 测试工具网站
          </div>
          <h1 className="mb-5 font-display text-[clamp(46px,6vw,74px)] font-[780] leading-[0.94] tracking-[-0.075em] text-fg">
            AI测试工具，
            <span className="block text-accent drop-shadow-[0_18px_34px_rgba(37,99,235,0.18)]">
              一站生成
            </span>
          </h1>
          <p className="mx-auto max-w-[640px] text-[17px] leading-8 text-muted">
            面向测试团队的 AI 工具集合，覆盖 JMeter 脚本生成、测试用例生成、导出与调试等高频场景，无需安装，即开即用。
          </p>
        </div>
      </div>
    </section>
  )
}
