import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalPortalProps {
  children: ReactNode
  onClose?: () => void
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}

let activeModalCount = 0
let previousBodyOverflow = ''
let previousBodyPaddingRight = ''

function lockBodyScroll() {
  if (typeof document === 'undefined') return

  if (activeModalCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    previousBodyPaddingRight = document.body.style.paddingRight

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }
  }

  activeModalCount += 1
}

function unlockBodyScroll() {
  if (typeof document === 'undefined' || activeModalCount === 0) return

  activeModalCount -= 1
  if (activeModalCount === 0) {
    document.body.style.overflow = previousBodyOverflow
    document.body.style.paddingRight = previousBodyPaddingRight
  }
}

export function ModalPortal({
  children,
  onClose,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: ModalPortalProps) {
  useEffect(() => {
    lockBodyScroll()
    return () => unlockBodyScroll()
  }, [])

  useEffect(() => {
    if (!closeOnEscape || !onClose) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeOnEscape, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      {children}
    </div>,
    document.body,
  )
}
