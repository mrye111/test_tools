import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

interface HeaderComboInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  suggestions: string[]
  className?: string
}

interface FilteredItem {
  text: string
  matchStart: number
  matchEnd: number
  isPrefix: boolean
}

/**
 * 组合输入框：支持自由输入 + 搜索过滤 + 下拉选择预设值。
 */
export function HeaderComboInput({
  value,
  onChange,
  placeholder,
  suggestions,
  className = '',
}: HeaderComboInputProps) {
  const id = `hc-${Math.random().toString(36).slice(2, 8)}`
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const hasSuggestions = suggestions.length > 0
  const query = value.trim().toLowerCase()

  // 搜索过滤 + 匹配位置信息
  const filtered: FilteredItem[] = useMemo(() => {
    if (!suggestions.length) return []

    if (!query) {
      return suggestions.map((text) => ({
        text,
        matchStart: 0,
        matchEnd: 0,
        isPrefix: false,
      }))
    }

    const results: FilteredItem[] = []
    const lower = query

    for (const text of suggestions) {
      const lowerText = text.toLowerCase()
      const idx = lowerText.indexOf(lower)
      if (idx !== -1) {
        results.push({
          text,
          matchStart: idx,
          matchEnd: idx + lower.length,
          isPrefix: idx === 0,
        })
      }
    }

    // 前缀匹配优先
    results.sort((a, b) => {
      if (a.isPrefix !== b.isPrefix) return a.isPrefix ? -1 : 1
      return a.text.localeCompare(b.text)
    })

    return results
  }, [suggestions, query])

  // ── 关闭 ──
  const close = useCallback(() => {
    setOpen(false)
    setHighlightIndex(-1)
  }, [])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  // 页面滚动关闭
  useEffect(() => {
    if (!open) return
    const handler = () => close()
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [open, close])

  // 高亮项滚动可见
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  // ── 面板位置 ──
  const getPanelStyle = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return {}
    const gap = 6
    const maxHeight = Math.min(240, window.innerHeight - rect.bottom - 12)
    return {
      position: 'fixed' as const,
      top: rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxHeight,
    }
  }, [])

  // ── 选择 ──
  const select = useCallback(
    (text: string) => {
      onChange(text)
      close()
      inputRef.current?.focus()
    },
    [onChange, close],
  )

  // ── 键盘 ──
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hasSuggestions) return

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((p) => {
        const max = filtered.length - 1
        return p >= max ? 0 : p + 1
      })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((p) => {
        return p <= 0 ? filtered.length - 1 : p - 1
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightIndex >= 0 && highlightIndex < filtered.length) {
        select(filtered[highlightIndex].text)
      } else {
        close()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  // ── 渲染匹配高亮 ──
  const renderItem = (item: FilteredItem) => {
    if (!query || item.matchStart === item.matchEnd) {
      return item.text
    }
    return (
      <>
        {item.text.slice(0, item.matchStart)}
        <mark className="bg-[oklch(0.62_0.18_265/0.14)] text-inherit rounded-sm px-0.5">
          {item.text.slice(item.matchStart, item.matchEnd)}
        </mark>
        {item.text.slice(item.matchEnd)}
      </>
    )
  }

  // ── Portal 面板 ──
  const panel = open && hasSuggestions
    ? createPortal(
        <div
          ref={panelRef}
          className="dropdown-panel z-[999] overflow-y-auto rounded-xl border border-[oklch(0.92_0.008_260/0.85)] bg-[oklch(1_0_0/0.97)] p-1 shadow-[0_18px_50px_-28px_oklch(0.18_0.02_262/0.4)] backdrop-blur-xl"
          style={getPanelStyle()}
          onWheel={(e) => e.stopPropagation()}
        >
          {filtered.length > 0 ? (
            <div ref={listRef}>
              {filtered.map((item, idx) => (
                <button
                  key={`${id}-${idx}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    select(item.text)
                  }}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  className={`dropdown-item ${
                    highlightIndex === idx ? 'bg-[oklch(0.95_0.01_260)]' : ''
                  } ${
                    item.text === value ? 'dropdown-item-selected' : ''
                  }`}
                >
                  <span className="truncate">{renderItem(item)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-[12px] text-muted">
              {query ? (
                <>
                  无匹配结果 "<span className="font-medium text-fg">{value.trim()}</span>"
                </>
              ) : (
                '暂无建议选项'
              )}
            </div>
          )}
        </div>,
        document.body,
      )
    : null

  return (
    <div ref={containerRef} className={`relative flex-1 ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          if (!open) setOpen(true)
          setHighlightIndex(-1)
        }}
        onFocus={() => {
          if (hasSuggestions) setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // 清除上一次的延迟关闭定时器
          if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
          blurTimerRef.current = setTimeout(close, 150)
        }}
        placeholder={placeholder}
        className="field-control w-full pr-8"
      />
      {hasSuggestions && (
        <button
          type="button"
          onClick={() => {
            inputRef.current?.focus()
            setOpen((c) => !c)
          }}
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted transition-colors hover:text-accent"
          tabIndex={-1}
          aria-label="展开建议选项"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${
              open ? 'rotate-180 text-accent' : ''
            }`}
          />
        </button>
      )}
      {panel}
    </div>
  )
}
