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
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-primary">{message}</p>
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
