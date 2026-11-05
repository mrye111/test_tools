import { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PrototypeVariant } from './types'

const variantNames: Record<PrototypeVariant, string> = {
  A: 'Dedicated shell',
  B: 'Existing tools + project tabs',
  C: 'Persistent automation sidebar',
}

interface PrototypeSwitcherProps {
  current: PrototypeVariant
  onChange: (variant: PrototypeVariant) => void
}

export function PrototypeSwitcher({ current, onChange }: PrototypeSwitcherProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const order: PrototypeVariant[] = ['A', 'B', 'C']
      const direction = event.key === 'ArrowRight' ? 1 : -1
      const next = (order.indexOf(current) + direction + order.length) % order.length
      onChange(order[next])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, onChange])

  const cycle = (direction: number) => {
    const order: PrototypeVariant[] = ['A', 'B', 'C']
    const next = (order.indexOf(current) + direction + order.length) % order.length
    onChange(order[next])
  }

  return (
    <div className="tsp-switcher" aria-label="Prototype variant switcher">
      <button type="button" onClick={() => cycle(-1)} aria-label="Previous prototype variant">
        <ChevronLeft aria-hidden="true" />
      </button>
      <span><strong>PROTOTYPE · {current}</strong>{variantNames[current]}</span>
      <button type="button" onClick={() => cycle(1)} aria-label="Next prototype variant">
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  )
}
