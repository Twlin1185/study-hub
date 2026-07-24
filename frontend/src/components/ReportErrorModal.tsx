import { useState } from 'react'
import Modal from './Modal'

interface ReportErrorModalProps {
  onClose: () => void
  onSubmit: (reason: string) => void
  submitting?: boolean
  errorMessage?: string | null
}

// 설계 §5.3 — 오류 신고 사유 입력 모달. 문서 상세·학습 모드·퀴즈 해설 공용.
export default function ReportErrorModal({ onClose, onSubmit, submitting, errorMessage }: ReportErrorModalProps) {
  const [reason, setReason] = useState('')

  return (
    <Modal title="오류 신고" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          문제나 개념에 오류가 있다고 판단되면 사유를 적어 주세요. AI가 현재 내용과 사유를 바탕으로
          재생성한 초안을 만들고, 검토 후 직접 [교체]해야 실제로 반영됩니다(자동 덮어쓰기 없음).
        </p>
        <label className="flex flex-col gap-1 text-sm">
          신고 사유
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="예: 3번 보기와 정답이 실제로는 반대로 되어 있습니다."
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
        </label>

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
            disabled={submitting || !reason.trim()}
            onClick={() => onSubmit(reason.trim())}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '접수 중…' : '신고 접수'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
