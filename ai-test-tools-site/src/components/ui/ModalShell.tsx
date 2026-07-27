import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ModalPortal } from './ModalPortal'

interface ModalShellProps {
  open: boolean
  onClose?: () => void
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  children: ReactNode
}

type Phase = 'closed' | 'open' | 'closing'

// 与 index.css 中 modal-out / backdrop-out 的时长保持一致
const EXIT_DURATION = 200

/**
 * 弹窗对称开合外壳：
 * - open false→true：立即挂载，进入动画由 CSS modal-in 驱动
 * - open true→false：给 backdrop 挂 .modal-closing 播退出动画，200ms 后再真正卸载
 *
 * 退出期间渲染的是 open 时缓存的 children 快照，因此调用方可以在
 * open 置 false 的同时安全清空弹窗依赖的数据（如 deletingCase）。
 * body 滚动锁定由 ModalPortal 负责，退出期间保持锁定，卸载时才释放。
 */
export function ModalShell({
  open,
  onClose,
  closeOnBackdrop = true,
  closeOnEscape = true,
  children,
}: ModalShellProps) {
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed')
  // open 期间的 children 快照，供退出动画继续渲染。
  // 快照在 effect 中更新（每次提交的渲染都刷新），保持 render 为纯函数——
  // StrictMode/并发渲染下被丢弃的渲染不会污染 ref。
  const contentRef = useRef<ReactNode>(children)
  useEffect(() => {
    if (open) contentRef.current = children
  })

  useEffect(() => {
    if (open) {
      // 打开（含退出途中重新打开）：立即回到 open，closing 副作用会清掉挂起的卸载定时器
      setPhase('open')
      return
    }
    setPhase((current) => (current === 'closed' ? current : 'closing'))
  }, [open])

  useEffect(() => {
    if (phase !== 'closing') return
    const timer = setTimeout(() => setPhase('closed'), EXIT_DURATION)
    return () => clearTimeout(timer)
  }, [phase])

  if (phase === 'closed') return null

  // 退出动画期间禁用交互：背景/Escape 的二次关闭与面板内按钮（如 ConfirmDialog 确认）
  // 的重复点击都要屏蔽；指针事件由 .modal-closing 的 pointer-events: none 兜底。
  const closing = phase === 'closing'

  return (
    <ModalPortal
      onClose={closing ? undefined : onClose}
      closeOnBackdrop={closing ? false : closeOnBackdrop}
      closeOnEscape={closing ? false : closeOnEscape}
      className={closing ? 'modal-closing' : ''}
    >
      {open ? children : contentRef.current}
    </ModalPortal>
  )
}
