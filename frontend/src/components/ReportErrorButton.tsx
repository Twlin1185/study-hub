import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useRegenerate } from '../api/convert'
import { ApiError } from '../api/client'
import { setStoredRegenerateJob } from '../utils/regenerateJobs'
import ReportErrorModal from './ReportErrorModal'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

interface ReportErrorButtonProps {
  documentId: number
  // 'detail' = 문서 상세(접수 즉시 진행 상황 패널로 이어짐) · 'inline' = 학습 모드·퀴즈
  // (접수 후 "문서 상세에서 확인" 안내만 표시, 설계 §5.5·§5.6)
  variant?: 'detail' | 'inline'
  onSubmitted?: () => void
  className?: string
}

export default function ReportErrorButton({
  documentId,
  variant = 'inline',
  onSubmitted,
  className,
}: ReportErrorButtonProps) {
  const [open, setOpen] = useState(false)
  const [submittedNotice, setSubmittedNotice] = useState(false)
  const regenerate = useRegenerate()

  function handleSubmit(reason: string) {
    regenerate.mutate(
      { documentId, reason },
      {
        onSuccess: (data) => {
          setStoredRegenerateJob(documentId, { jobId: data.job_id, reason })
          setOpen(false)
          if (variant === 'detail') {
            onSubmitted?.()
          } else {
            setSubmittedNotice(true)
          }
        },
      },
    )
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs font-medium text-wrong hover:bg-bg"
      >
        ⚠ 오류 신고
      </button>

      {submittedNotice && (
        <p className="mt-2 text-xs text-muted">
          신고가 접수되었습니다.{' '}
          <Link to={`/docs/${documentId}`} className="text-accent hover:underline">
            문서 상세
          </Link>
          에서 처리 결과를 확인하세요.
        </p>
      )}

      {open && (
        <ReportErrorModal
          onClose={() => setOpen(false)}
          onSubmit={handleSubmit}
          submitting={regenerate.isPending}
          errorMessage={regenerate.isError ? errMsg(regenerate.error, '신고 접수에 실패했습니다.') : null}
        />
      )}
    </div>
  )
}
