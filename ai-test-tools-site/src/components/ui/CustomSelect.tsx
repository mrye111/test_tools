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
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

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
    if (!isOpen) {
      setHighlightIndex(-1)
      return
    }

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return

      const gap = 8
      const viewportPadding = 12
      const belowSpace = window.innerHeight - rect.bottom - viewportPadding
      const aboveSpace = rect.top - viewportPadding
      const openTop = placement === 'top' || (placement === 'auto' && belowSpace < 240 && aboveSpace > belowSpace)
      const maxHeight = Math.max(120, Math.min(280, (openTop ? aboveSpace : belowSpace) - gap))
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
      if (isOpen && highlightIndex >= 0) {
        handleSelect(options[highlightIndex].value)
      } else {
        setIsOpen((current) => !current)
        if (!isOpen) setHighlightIndex(options.findIndex((o) => o.value === value))
      }
      return
    }
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setIsOpen(true)
        setHighlightIndex(options.findIndex((o) => o.value === value))
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightIndex((prev) => (prev + 1) % options.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightIndex((prev) => (prev - 1 + options.length) % options.length)
      return
    }
  }

  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  const dropdown = isOpen
    ? createPortal(
        <div
          ref={dropdownRef}
          className={`${
            resolvedPlacement === 'top' ? 'dropdown-panel-up' : 'dropdown-panel'
          } z-[999] overflow-y-auto rounded-xl border border-[oklch(0.92_0.008_260/0.8)] bg-[oklch(1_0_0/0.96)] p-1.5 shadow-[0_20px_55px_-30px_oklch(0.18_0.02_262/0.45)] backdrop-blur-xl`}
          style={dropdownStyle}
          role="listbox"
        >
          <div ref={listRef}>
            {options.map((option, idx) => {
              const isSelected = option.value === value
              const isHighlighted = idx === highlightIndex
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  role="option"
                  aria-selected={isSelected}
                  className={`dropdown-item ${
                    isSelected ? 'dropdown-item-selected' : ''
                  } ${
                    isHighlighted && !isSelected ? 'bg-[oklch(0.95_0.01_260)]' : ''
                  }`}
                >
                  <span className="flex-1 text-left">{option.label}</span>
                  {isSelected && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>
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
        <span className={`min-w-0 truncate ${selectedOption ? 'text-fg' : 'text-[oklch(0.68_0.015_260)]'}`}>
          {selectedOption?.label || placeholder || '请选择'}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isOpen ? 'rotate-180 text-accent' : ''
          }`}
        />
      </button>
      {dropdown}
    </div>
  )
}
