import { useState, useRef, useEffect, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'

interface Option {
  value: string
  label: string
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  className?: string
  placement?: 'auto' | 'bottom' | 'top'
}

export function CustomSelect({ value, onChange, options, placeholder, className = '', placement = 'auto' }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})
  const [resolvedPlacement, setResolvedPlacement] = useState<'bottom' | 'top'>('bottom')
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current
        && !containerRef.current.contains(target)
        && dropdownRef.current
        && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return

      const gap = 8
      const viewportPadding = 12
      const belowSpace = window.innerHeight - rect.bottom - viewportPadding
      const aboveSpace = rect.top - viewportPadding
      const openTop = placement === 'top' || (placement === 'auto' && belowSpace < 220 && aboveSpace > belowSpace)
      const maxHeight = Math.max(120, Math.min(240, (openTop ? aboveSpace : belowSpace) - gap))
      const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - rect.width - viewportPadding))

      setResolvedPlacement(openTop ? 'top' : 'bottom')
      setDropdownStyle({
        position: 'fixed',
        left,
        width: rect.width,
        maxHeight,
        ...(openTop
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen, placement])

  const handleSelect = (optionValue: string) => {
    onChange(optionValue)
    setIsOpen(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setIsOpen((current) => !current)
    }
  }

  const dropdown = isOpen
    ? createPortal(
        <div
          ref={dropdownRef}
          className={`dropdown-panel z-[999] overflow-y-auto rounded-xl border border-slate-200 bg-white/96 p-1 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur ${resolvedPlacement === 'top' ? 'origin-bottom' : 'origin-top'}`}
          style={dropdownStyle}
          role="listbox"
        >
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                role="option"
                aria-selected={isSelected}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-all duration-150 ${
                  isSelected
                    ? 'bg-[rgba(37,99,235,0.08)] font-medium text-accent'
                    : 'text-fg hover:bg-slate-50'
                }`}
              >
                <span>{option.label}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-accent" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )
    : null

  return (
    <div ref={containerRef} className={`relative ${isOpen ? 'z-[320]' : 'z-[1]'} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className="field-control flex items-center justify-between text-left"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={`min-w-0 truncate ${selectedOption ? 'text-fg' : 'text-slate-400'}`}>
          {selectedOption?.label || placeholder || '请选择'}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {dropdown}
    </div>
  )
}
