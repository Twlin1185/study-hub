import type { ReactNode } from 'react'
import Modal from './Modal'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
  submitting?: boolean
  errorMessage?: string | null
  // stage-53(규약 C) — 삭제 확인창에 "휴지통 열기" 같은 보조 링크를 자기 줄로 덧붙일 때만 사용.
  // 미지정 시 렌더 0(기존 호출처 무변).
  footer?: ReactNode
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = '확인',
  danger,
  onConfirm,
  onClose,
  submitting,
  errorMessage,
  footer,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {/* 줄바꿈이 있는 경고 문구(예: 임베드 사용처 경고)를 그대로 보여준다. */}
        <p className="whitespace-pre-line text-sm text-primary">{message}</p>
        {footer && <div>{footer}</div>}
        {errorMessage && <p className="text-sm text-wrong">{errorMessage}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            취소
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className={`rounded px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50 ${
              danger ? 'bg-wrong' : 'bg-accent'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
