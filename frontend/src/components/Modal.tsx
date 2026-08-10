import { useEffect, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'

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
      // 10-1ⓑ — Esc 단독일 때만 닫는다(다른 키·조합 키는 절대 닫지 않음). 브라우저별로
      // 조합 키에서도 e.key가 'Escape'로 보고되는 경우는 없지만, 혹시 모를 modifier 동반을
      // 명시적으로 걸러 의도를 코드로 고정해 둔다.
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 10-1ⓐ — 오버레이 "클릭"으로 닫던 것을 mousedown·mouseup이 **둘 다** 오버레이 자신일 때만
  // 닫히게 바꾼다. 기존 onClick 방식은 textarea 안에서 드래그를 시작해 오버레이 위에서 손을 떼면
  // (mousedown 대상과 mouseup 대상의 최근접 공통 조상이 오버레이가 되어) 의도치 않게 닫혔다
  // (Modal 공용 수정 — 이 컴포넌트를 쓰는 모든 모달에 적용).
  const mouseDownOnOverlay = useRef(false)
  function handleOverlayMouseDown(e: MouseEvent<HTMLDivElement>) {
    mouseDownOnOverlay.current = e.target === e.currentTarget
  }
  function handleOverlayMouseUp(e: MouseEvent<HTMLDivElement>) {
    const shouldClose = mouseDownOnOverlay.current && e.target === e.currentTarget
    mouseDownOnOverlay.current = false
    if (shouldClose) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={handleOverlayMouseDown}
      onMouseUp={handleOverlayMouseUp}
      role="presentation"
    >
      <div
        className={`w-full ${widthClass} max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-surface-raised p-5 shadow-xl`}
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
