import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ModalPortal } from './ModalPortal'

interface ConfirmDialogProps {
  title: string
  description: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <ModalPortal onClose={onCancel} closeOnBackdrop={false}>
      <div className="flex min-h-full w-full items-center justify-center px-4 py-8" onClick={(event) => event.stopPropagation()}>
        <section
          className="modal-panel w-full max-w-[420px] overflow-hidden rounded-[28px]"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
                danger
                  ? 'border-[oklch(0.55_0.2_25/0.22)] bg-[linear-gradient(135deg,oklch(0.55_0.2_25/0.16),oklch(0.6_0.22_15/0.1))] text-danger shadow-[0_12px_26px_-16px_oklch(0.55_0.2_25/0.55),inset_0_1px_0_oklch(1_0_0/0.6)]'
                  : 'border-[oklch(0.56_0.24_208/0.2)] bg-[linear-gradient(135deg,oklch(0.56_0.24_208/0.14),oklch(0.7_0.14_218/0.1))] text-accent shadow-[0_12px_26px_-16px_oklch(0.56_0.24_208/0.55),inset_0_1px_0_oklch(1_0_0/0.6)]'
              }`}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 id="confirm-dialog-title" className="font-display text-lg font-semibold tracking-[-0.03em] text-fg">
                  {title}
                </h3>
                <div className="mt-2 text-sm leading-6 text-muted">
                  {description}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-3 border-t border-white/60 bg-white/40 px-6 py-4">
            <button type="button" onClick={onCancel} className="secondary-action px-4 py-2 text-sm focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]">
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={danger
                ? 'rounded-xl border border-[oklch(0.55_0.2_25/0.42)] bg-[linear-gradient(115deg,oklch(0.52_0.22_25),oklch(0.6_0.22_15))] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_36px_-16px_oklch(0.55_0.2_25/0.6),inset_0_1px_0_oklch(1_0_0/0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]'
                : 'primary-action px-4 py-2 text-sm focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]'}
            >
              {confirmText}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  )
}
