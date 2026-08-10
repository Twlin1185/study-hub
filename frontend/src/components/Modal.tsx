import { useEffect } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  widthClass?: string
  // 제목 옆·닫기 버튼 앞에 두는 보조 액션(예: stage-26 9-5 "창으로 열기") — 선택적.
  headerExtra?: ReactNode
}

export default function Modal({ title, onClose, children, footer, widthClass = 'max-w-md', headerExtra }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`w-full ${widthClass} max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-surface-raised p-5 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 text-lg font-semibold text-primary">{title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {headerExtra}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted hover:bg-bg hover:text-primary"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="text-primary">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
