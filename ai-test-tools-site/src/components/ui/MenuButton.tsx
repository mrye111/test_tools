import { useState, useRef, useEffect, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Check } from 'lucide-react'

interface MenuOption {
  value: string
  label: string
}

interface MenuButtonProps {
  options: MenuOption[]
  onSelect: (value: string) => void
  /** 触发按钮内容（图标或文字），由调用方决定 */
  children: ReactNode
  className?: string
  /** 触发按钮的 aria-label */
  ariaLabel: string
  placement?: 'auto' | 'bottom' | 'top'
  /** 菜单项是否展示当前选中态（勾选）；动作类菜单（如导出）不传 */
  selectedValue?: string
  /** 下拉面板最小宽度（px），默认跟随触发按钮宽度 */
  menuMinWidth?: number
}

/**
 * 图标/任意触发器 + 浮层菜单按钮：交互与定位逻辑复用自 CustomSelect，
 * 但触发器可以是纯图标（配 Tooltip），菜单用于动作选择而非表单选值。
 */
export function MenuButton({
  options,
  onSelect,
  children,
  className = '',
  ariaLabel,
  placement = 'auto',
  selectedValue,
  menuMinWidth,
}: MenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})
  const [resolvedPlacement, setResolvedPlacement] = useState<'bottom' | 'top'>('bottom')
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

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
      const openTop = placement === 'top' || (placement === 'auto' && belowSpace < 240 && aboveSpace > belowSpace)
      const maxHeight = Math.max(120, Math.min(280, (openTop ? aboveSpace : belowSpace) - gap))
      const minWidth = Math.max(rect.width, menuMinWidth ?? 0)
      const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - minWidth - viewportPadding))

      setResolvedPlacement(openTop ? 'top' : 'bottom')
      setDropdownStyle({
        position: 'fixed',
        left,
        minWidth,
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
  }, [isOpen, placement, menuMinWidth])

  const handleSelect = (optionValue: string) => {
    onSelect(optionValue)
    setIsOpen(false)
    setHighlightIndex(-1)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
      setHighlightIndex(-1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (isOpen && highlightIndex >= 0) {
        handleSelect(options[highlightIndex].value)
      } else {
        setIsOpen((current) => !current)
        if (!isOpen) setHighlightIndex(0)
      }
      return
    }
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setIsOpen(true)
        setHighlightIndex(0)
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
    }
  }

  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  const dropdown = createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={dropdownRef}
          className={`${
            resolvedPlacement === 'top' ? 'dropdown-panel-up' : 'dropdown-panel'
          } liquid-glass z-[999] w-max overflow-y-auto rounded-xl p-1.5`}
          style={dropdownStyle}
          role="menu"
          initial={{ opacity: 0, y: resolvedPlacement === 'top' ? 12 : -12, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: resolvedPlacement === 'top' ? 8 : -8, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 1 }}
        >
          <div ref={listRef}>
            {options.map((option, idx) => {
              const isSelected = selectedValue !== undefined && option.value === selectedValue
              const isHighlighted = idx === highlightIndex
              return (
                <motion.button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  role="menuitem"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    type: 'spring',
                    stiffness: 240,
                    damping: 22,
                    delay: idx * 0.06,
                  }}
                  whileHover={{ x: 4, transition: { type: 'spring', stiffness: 300, damping: 24 } }}
                  whileTap={{ scale: 0.97 }}
                  className={`dropdown-item whitespace-nowrap ${
                    isSelected ? 'dropdown-item-selected' : ''
                  } ${
                    isHighlighted && !isSelected ? 'bg-accent/10' : ''
                  }`}
                >
                  <span className="flex-1 text-left">{option.label}</span>
                  {isSelected && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-accent" />}
                </motion.button>
              )
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )

  return (
    <div ref={containerRef} className={`relative ${isOpen ? 'z-[320]' : 'z-[1]'} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="analysis-board-capsule-btn"
      >
        {children}
      </button>
      {dropdown}
    </div>
  )
}
