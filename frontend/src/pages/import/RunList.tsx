import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import { importRunKeys } from '../../api/importRuns'
import { useCancelLlmJob } from '../../api/llm'
import ConfirmDialog from '../../components/ConfirmDialog'
import RunCard from './RunCard'
import type { UseImportRunsResult } from '../../hooks/useImportRuns'
import type { ImportRun } from '../../api/types'

// 반입 건 목록(설계 §5.9 [S56] A) — 활성 run, 서버 정렬(updated_at DESC) 그대로. 카드 액션은 RunCard,
// 취소 확인 다이얼로그(§5.14 고정 문구)는 이 목록이 1개만 띄운다.

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 상단 요약 1줄 "검토 대기 n · 진행 중 m" — 둘 다 0이면 미표시.
export function RunSummaryLine({ reviewReady, inProgress }: { reviewReady: number; inProgress: number }) {
  if (reviewReady === 0 && inProgress === 0) return null
  return (
    <span className="text-sm text-primary">
      검토 대기 {reviewReady} · 진행 중 {inProgress}
    </span>
  )
}

interface RunListProps {
  data: UseImportRunsResult
  highlightIds: number[]
  scrollToId: number | null
  reviewingPreviewId: string | null
  reviewError: { runId: number; message: string } | null
  retrying: boolean
  onReview: (run: ImportRun, previewId: string) => void
  onSplitImport: (run: ImportRun) => void
  onRetry: (run: ImportRun) => void
  // run 0건일 때 빈 목록 문구 아래에 패널이 이어지므로 문구만 이 컴포넌트가 책임진다.
}

export default function RunList({
  data,
  highlightIds,
  scrollToId,
  reviewingPreviewId,
  reviewError,
  retrying,
  onReview,
  onSplitImport,
  onRetry,
}: RunListProps) {
  const qc = useQueryClient()
  const [cancelTarget, setCancelTarget] = useState<ImportRun | null>(null)
  const cancelMutation = useCancelLlmJob()
  const scrolledRef = useRef<number | null>(null)

  // ?run= 딥링크 — 카드가 렌더되면 1회 스크롤.
  const hasTarget = scrollToId != null && data.runs.some((r) => r.id === scrollToId)
  useEffect(() => {
    if (scrollToId == null || !hasTarget || scrolledRef.current === scrollToId) return
    scrolledRef.current = scrollToId
    document.getElementById(`run-card-${scrollToId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [scrollToId, hasTarget])

  if (data.isLoading) return <p className="text-sm text-muted">반입 건을 불러오는 중…</p>
  if (data.isError) {
    return (
      <div className="flex flex-col gap-2 rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
        <p>{errMsg(data.error, '반입 건 목록을 불러오지 못했습니다.')}</p>
        <button
          type="button"
          onClick={data.refetch}
          className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
        >
          다시 불러오기
        </button>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      {data.pinnedMissing && (
        <p className="text-xs text-warning">요청한 반입 건을 찾을 수 없습니다.</p>
      )}
      {data.runs.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-4 text-sm text-muted">
          아직 반입한 기록이 없습니다. 새 반입을 시작해 보세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              job={run.job_id ? data.jobsById.get(run.job_id) : undefined}
              highlighted={highlightIds.includes(run.id)}
              reviewingPreviewId={reviewingPreviewId}
              reviewError={reviewError}
              retrying={retrying}
              onReview={onReview}
              onSplitImport={onSplitImport}
              onRetry={onRetry}
              onCancelRequest={setCancelTarget}
            />
          ))}
        </ul>
      )}

      {data.hasMore && (
        <button
          type="button"
          disabled={data.fetchingMore}
          onClick={data.fetchMore}
          className="w-fit self-center rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg disabled:opacity-50"
        >
          {data.fetchingMore ? '불러오는 중…' : `더 보기 (${data.runs.length}/${data.total})`}
        </button>
      )}

      {cancelTarget && cancelTarget.job_id && (
        <ConfirmDialog
          title="작업 취소"
          message="실행 중 취소는 이미 처리된 토큰만큼 요금이 발생할 수 있습니다."
          confirmLabel="취소하기"
          danger
          submitting={cancelMutation.isPending}
          errorMessage={cancelMutation.isError ? errMsg(cancelMutation.error, '취소에 실패했습니다.') : null}
          onConfirm={() => {
            cancelMutation.mutate(cancelTarget.job_id as string, {
              onSuccess: () => setCancelTarget(null),
              onSettled: () => qc.invalidateQueries({ queryKey: importRunKeys.all }),
            })
          }}
          onClose={() => {
            cancelMutation.reset()
            setCancelTarget(null)
          }}
        />
      )}
    </section>
  )
}
