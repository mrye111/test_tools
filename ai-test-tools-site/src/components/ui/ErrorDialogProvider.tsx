import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { ModalShell } from './ModalShell'
import { normalizeErrorMessage } from '../../lib/app-error'

type ShowErrorOptions = {
  title?: string
  fallbackMessage?: string
}

type ErrorDialogState = {
  title: string
  message: string
}

type ErrorDialogContextValue = {
  showError: (error: unknown, options?: ShowErrorOptions) => void
  hideError: () => void
}

const noopContextValue: ErrorDialogContextValue = {
  showError: () => {},
  hideError: () => {},
}

const ErrorDialogContext = createContext<ErrorDialogContextValue>(noopContextValue)

export function ErrorDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ErrorDialogState | null>(null)
  // 无需缓存最后一次展示的内容：ModalShell 会在退出动画期间渲染 open 时的 children 快照

  const hideError = useCallback(() => {
    setDialog(null)
  }, [])

  const showError = useCallback((error: unknown, options: ShowErrorOptions = {}) => {
    const message = normalizeErrorMessage(error, { fallbackMessage: options.fallbackMessage })
    setDialog({
      title: options.title ?? '提示',
      message,
    })
  }, [])

  const value = useMemo<ErrorDialogContextValue>(() => ({
    showError,
    hideError,
  }), [hideError, showError])

  return (
    <ErrorDialogContext.Provider value={value}>
      {children}
      <ModalShell open={Boolean(dialog)} onClose={hideError}>
        {dialog && (
          <div
            className="modal-panel w-full max-w-[520px] rounded-[28px] p-6 max-sm:p-4"
            onClick={(event) => event.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="global-error-dialog-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[oklch(0.55_0.2_25/0.2)] bg-[oklch(0.55_0.2_25/0.1)] text-danger">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="global-error-dialog-title" className="font-display text-lg font-semibold tracking-[-0.03em] text-fg">
                    {dialog.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {dialog.message}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={hideError}
                className="icon-action h-8 w-8 rounded-xl"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={hideError}
                className="primary-action px-5 py-2.5 text-sm"
              >
                我知道了
              </button>
            </div>
          </div>
        )}
      </ModalShell>
    </ErrorDialogContext.Provider>
  )
}

export function useErrorDialog() {
  return useContext(ErrorDialogContext)
}
