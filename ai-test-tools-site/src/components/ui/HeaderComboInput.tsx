import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
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
  // 关闭退出动画：open 先置 false，面板挂 .dropdown-panel-closing 保留 140ms 再卸载
  const [closing, setClosing] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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

  // ── 关闭（先播退出动画，140ms 与 dropdown-out 时长一致）──
  // openRef 跟踪面板开关态：已关闭时 close 必须是幂等无操作，否则
  // 「点击外部关闭 → input blur 延迟 150ms 再次 close」会让面板重新挂载闪退一次。
  const openRef = useRef(false)
  const close = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    setOpen(false)
    setHighlightIndex(-1)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setClosing(true)
    closeTimerRef.current = setTimeout(() => setClosing(false), 140)
  }, [])

  // ── 打开（取消挂起的退出卸载，立即恢复）──
  const openPanel = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    openRef.current = true
    setClosing(false)
    setOpen(true)
  }, [])

  // 卸载时清理所有定时器
  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
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

  // 高亮项滚动可见
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  // ── 面板位置 ──
  const updatePanelPosition = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      close()
      return
    }
    const gap = 6
    const viewportPadding = 12
    const belowSpace = window.innerHeight - rect.bottom - viewportPadding
    const aboveSpace = rect.top - viewportPadding
    const minHeight = 160
    const preferredMax = 240
    const openTop = belowSpace < minHeight && aboveSpace > belowSpace
    const maxHeight = Math.max(minHeight, Math.min(preferredMax, (openTop ? aboveSpace : belowSpace) - gap))

    setPlacement(openTop ? 'top' : 'bottom')
    setPanelStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      maxHeight,
      ...(openTop
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap }),
    })
  }, [close])

  useEffect(() => {
    if (!open) return
    updatePanelPosition()
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
    return () => {
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
    }
  }, [open, updatePanelPosition])

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
        openPanel()
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
        <mark className="bg-accent/15 text-inherit rounded-sm px-0.5">
          {item.text.slice(item.matchStart, item.matchEnd)}
        </mark>
        {item.text.slice(item.matchEnd)}
      </>
    )
  }

  // ── Portal 面板（open 或退出动画期间都保持挂载）──
  const panel = (open || closing) && hasSuggestions
    ? createPortal(
        <div
          ref={panelRef}
          className={`${
            placement === 'top' ? 'dropdown-panel-up' : 'dropdown-panel'
          } ${closing ? 'dropdown-panel-closing' : ''} liquid-glass z-[999] overflow-y-auto rounded-xl p-1`}
          style={panelStyle}
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
                    highlightIndex === idx ? 'bg-accent/10' : ''
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
          if (!open) openPanel()
          setHighlightIndex(-1)
        }}
        onFocus={() => {
          if (hasSuggestions) openPanel()
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
            if (open) close()
            else openPanel()
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
