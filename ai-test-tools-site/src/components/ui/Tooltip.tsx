import { useState, useRef, useEffect, useCallback, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Placement = 'top' | 'bottom' | 'left' | 'right'
type Phase = 'hidden' | 'measuring' | 'entering' | 'visible' | 'exiting'

interface TooltipProps {
  content: string
  children: ReactNode
  placement?: Placement
  delay?: number
}

const PAD = 8

export function Tooltip({ content, children, placement = 'top', delay = 400 }: TooltipProps) {
  const [phase, setPhase] = useState<Phase>('hidden')
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [actualPlacement, setActualPlacement] = useState<Placement>(placement)
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const computePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const gap = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    const tooltipEl = tooltipRef.current
    const tw = tooltipEl?.offsetWidth ?? 0
    const th = tooltipEl?.offsetHeight ?? 0

    let p = placement
    let top = 0
    let left = 0

    // Try primary placement, flip if overflow
    if (p === 'top' && rect.top - gap - th < PAD) p = 'bottom'
    else if (p === 'bottom' && rect.bottom + gap + th > vh - PAD) p = 'top'
    else if (p === 'left' && rect.left - gap - tw < PAD) p = 'right'
    else if (p === 'right' && rect.right + gap + tw > vw - PAD) p = 'left'

    setActualPlacement(p)

    switch (p) {
      case 'top':
        top = rect.top - gap - th
        left = rect.left + rect.width / 2 - tw / 2
        break
      case 'bottom':
        top = rect.bottom + gap
        left = rect.left + rect.width / 2 - tw / 2
        break
      case 'left':
        top = rect.top + rect.height / 2 - th / 2
        left = rect.left - gap - tw
        break
      case 'right':
        top = rect.top + rect.height / 2 - th / 2
        left = rect.right + gap
        break
    }

    // Clamp to viewport
    left = Math.max(PAD, Math.min(left, vw - tw - PAD))
    top = Math.max(PAD, Math.min(top, vh - th - PAD))

    setPos({ top, left })
  }, [placement])

  // Re-measure after tooltip enters DOM to get accurate size
  useLayoutEffect(() => {
    if (phase === 'measuring') {
      computePosition()
      setPhase('entering')
    }
  }, [phase, computePosition])

  const show = useCallback(() => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    timerRef.current = setTimeout(() => {
      setPhase('measuring')
    }, delay)
  }, [delay])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (phase === 'entering' || phase === 'visible' || phase === 'measuring') {
      setPhase('exiting')
      exitTimerRef.current = setTimeout(() => setPhase('hidden'), 140)
    } else {
      setPhase('hidden')
    }
  }, [phase])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'entering' && phase !== 'visible' && phase !== 'measuring') return
    const handleScroll = () => setPhase('hidden')
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [phase])

  const handleAnimationEnd = useCallback(() => {
    if (phase === 'entering') setPhase('visible')
  }, [phase])

  const showTooltip = phase !== 'hidden'
  const animClass = phase === 'exiting'
    ? `tooltip-exit-${actualPlacement}`
    : `tooltip-enter-${actualPlacement}`

  const tooltip = showTooltip
    ? createPortal(
        <div
          ref={tooltipRef}
          className={`tooltip-content ${phase === 'measuring' ? 'tooltip-measuring' : ''} ${phase !== 'measuring' ? animClass : ''}`}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
          }}
          onAnimationEnd={handleAnimationEnd}
        >
          {content}
        </div>,
        document.body,
      )
    : null

  return (
    <div
      ref={triggerRef}
      className="tooltip-trigger"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {tooltip}
    </div>
  )
}
