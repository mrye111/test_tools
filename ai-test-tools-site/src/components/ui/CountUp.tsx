import { useEffect, useRef } from 'react'
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react'

interface CountUpProps {
  to: number
  suffix?: string
  duration?: number
  delay?: number
  className?: string
}

/**
 * 滚动进入视口后从 0 计数到目标值。
 * 用 easeOutExpo 曲线让后段自然减速；reduced-motion 下直接呈现终值。
 */
export function CountUp({ to, suffix = '', duration = 1.4, delay = 0, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })
  const reduceMotion = useReducedMotion()
  const value = useMotionValue(0)
  const text = useTransform(value, (v) => `${Math.round(v)}${suffix}`)

  useEffect(() => {
    if (!inView) return
    if (reduceMotion) {
      value.set(to)
      return
    }
    const controls = animate(value, to, { duration, delay, ease: [0.16, 1, 0.3, 1] })
    return () => controls.stop()
  }, [inView, reduceMotion, value, to, duration, delay])

  return (
    <span ref={ref} className={className}>
      <motion.span className="tabular-nums">{text}</motion.span>
    </span>
  )
}
