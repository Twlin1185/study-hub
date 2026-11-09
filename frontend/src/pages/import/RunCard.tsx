import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { previewJsonUrl } from '../../api/convert'
import { ApiError } from '../../api/client'
import { importRunKeys, isRunInProgress, useDismissRun, useRunDetail } from '../../api/importRuns'
import { useMergePreviews } from '../../api/import'
import LlmJobProgress from '../../components/LlmJobProgress'
import RunTimeline, { formatRelative, splitTotalFromEvents } from './RunTimeline'
import type { ImportRun, ImportRunKind, ImportRunStatus, LlmJobItem } from '../../api/types'

// 반입 건 카드 1장 = run 1건(설계 §5.9 [S56] A·B). label·last_event.message·error_message는 서버 값
// 그대로 렌더한다. 상태 enum -> 한국어 배지만 프론트 매핑(§5.14 관례). 색은 전부 토큰.

const STATUS_LABEL: Record<ImportRunStatus, string> = {
  queued: '대기',
  converting: '변환 중',
  splitting: '분할 중',
  review_ready: '검토 대기',
  committing: '반입 중',
  committed: '반입 완료',
  failed: '실패',
  cancelled: '취소됨',
  expired: '만료',
}

const STATUS_CLASS: Record<ImportRunStatus, string> = {
  queued: 'bg-surface-raised text-muted',
  converting: 'bg-accent text-on-accent',
  splitting: 'bg-accent text-on-accent',
  review_ready: 'bg-warning text-on-accent',
  committing: 'bg-accent text-on-accent',
  committed: 'bg-correct text-on-accent',
  failed: 'bg-wrong text-on-accent',
  cancelled: 'border border-border text-muted',
  expired: 'border border-warning text-warning',
}

const KIND_LABEL: Record<ImportRunKind, string> = {
  convert_file: '파일',
  convert_url: 'URL',
  fetch: '사이트',
  json_upload: 'JSON',
  answer_key: '답지',
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 소스 1줄 — 파일명 / URL / 사이트 회차(서버가 채운 source_name·source_url).
function sourceLine(run: ImportRun): string {
  if (run.kind === 'convert_url') return run.source_url ?? run.source_name ?? ''
  return run.source_name ?? run.source_url ?? ''
}

export interface RunCardProps {
  run: ImportRun
  job: LlmJobItem | undefined
  highlighted: boolean
  reviewingPreviewId: string | null
  reviewError: { runId: number; message: string } | null
  retrying: boolean
  onReview: (run: ImportRun, previewId: string) => void
  onSplitImport: (run: ImportRun) => void
  onRetry: (run: ImportRun) => void
  onCancelRequest: (run: ImportRun) => void
}

export default function RunCard({
  run,
  job,
  highlighted,
  reviewingPreviewId,
  reviewError,
  retrying,
  onReview,
  onSplitImport,
  onRetry,
  onCancelRequest,
}: RunCardProps) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const dismissMutation = useDismissRun()
  const mergeMutation = useMergePreviews()
  // 상세는 [자세히]를 펼칠 때만 조회(preview_available·타임라인). 진행 중이면 펼친 동안만 짧게 갱신.
  const detailQuery = useRunDetail(run.id, {
    enabled: expanded,
    refetchMs: expanded && isRunInProgress(run.status) ? 3000 : false,
  })
  const detail = detailQuery.data

  const inProgress = isRunInProgress(run.status)
  const previews = run.summary.previews
  const isSplit = run.split_id != null
  const reviewable = run.status === 'review_ready'
  const previewAvailable = detail ? detail.preview_available : run.preview_available !== false
  const reviewDisabledReason =
    reviewable && run.kind !== 'answer_key' && !previewAvailable ? '보존 만료 — 다시 반입하세요' : null
  const splitTotal = run.summary.chunks_total ?? (detail ? splitTotalFromEvents(detail.events) : null)
  const chunksFailed = run.summary.chunks_failed ?? 0
  const canMerge = reviewable && isSplit && previews.length >= 2 && (splitTotal == null || previews.length + chunksFailed >= splitTotal)

  // 카드 [검토] 대상 — run.preview_id(단일·병합본) 우선, 없으면 조각이 1개뿐인 분할 run의 그 조각.
  const mainPreviewId = run.preview_id ?? (previews.length === 1 ? previews[0].preview_id : null)

  function handleMerge() {
    setLocalError(null)
    mergeMutation.mutate(
      previews.map((p) => p.preview_id),
      {
        onSuccess: (data) => {
          qc.invalidateQueries({ queryKey: importRunKeys.all })
          onReview(run, data.preview_id)
        },
        onError: (e) => setLocalError(errMsg(e, '병합에 실패했습니다.')),
      },
    )
  }

  function handleDismiss() {
    setLocalError(null)
    dismissMutation.mutate(run.id, { onError: (e) => setLocalError(errMsg(e, '목록에서 지우지 못했습니다.')) })
  }

  // 잡이 없거나 TTL로 사라진 진행 중 run — 빠져나갈 길로 [목록에서 지우기]를 연다(409면 서버 메시지 표시).
  const hasLiveJob = run.job_id != null && job != null && (job.status === 'running' || job.status === 'queued')
  const showProgress = inProgress && job != null && (job.status === 'running' || job.status === 'queued')
  const cardReviewError = reviewError && reviewError.runId === run.id ? reviewError.message : null

  return (
    <li
      id={`run-card-${run.id}`}
      className={`flex flex-col gap-2 rounded-lg border bg-surface p-3 ${
        highlighted ? 'border-accent ring-2 ring-accent' : 'border-border'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[run.status]}`}>
          {STATUS_LABEL[run.status]}
        </span>
        <span className="min-w-0 flex-1 break-all text-sm font-medium text-primary">{run.label}</span>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <span className="rounded border border-border px-1.5 py-0.5 text-[11px]">{KIND_LABEL[run.kind]}</span>
        <span className="min-w-0 break-all">{sourceLine(run)}</span>
      </p>

      {run.category_path && (
        <p className="text-xs text-muted">
          분류 경로: <span className="text-accent">{run.category_path}</span>
        </p>
      )}

      {run.last_event && (
        <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-primary">
          <span className="min-w-0 break-words">{run.last_event.message}</span>
          <span className="shrink-0 text-muted">{formatRelative(run.last_event.at)}</span>
        </p>
      )}

      {isSplit && previews.length > 0 && (
        <p className="text-xs text-accent">
          분할 조각 {previews.length}/{splitTotal ?? previews.length}
          {chunksFailed > 0 && (
            <span className="ml-2 rounded-full bg-wrong px-2 py-0.5 text-[11px] font-medium text-on-accent">
              실패 {chunksFailed}
            </span>
          )}
        </p>
      )}

      {showProgress && job && <LlmJobProgress progress={job.progress} includeDownloading={run.kind === 'convert_url'} />}

      {run.status === 'failed' && run.error_message && <p className="text-xs text-wrong">{run.error_message}</p>}

      {cardReviewError && <p className="text-xs text-wrong">{cardReviewError}</p>}
      {localError && <p className="text-xs text-wrong">{localError}</p>}

      {reviewDisabledReason && !expanded && <p className="text-xs text-warning">{reviewDisabledReason}</p>}

      <div className="flex flex-wrap gap-2">
        {reviewable && run.kind !== 'answer_key' && mainPreviewId && (
          <button
            type="button"
            disabled={!previewAvailable || reviewingPreviewId === mainPreviewId}
            onClick={() => onReview(run, mainPreviewId)}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {reviewingPreviewId === mainPreviewId && !cardReviewError ? '미리보기 여는 중…' : '검토'}
          </button>
        )}
        {reviewable && run.kind === 'answer_key' && (
          <button
            type="button"
            onClick={() => onReview(run, '')}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
          >
            답지 화면 열기
          </button>
        )}
        {canMerge && !run.preview_id && (
          <button
            type="button"
            disabled={mergeMutation.isPending || !previewAvailable}
            onClick={handleMerge}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {mergeMutation.isPending ? '병합 중…' : `합쳐서 검토 (${previews.length}조각)`}
          </button>
        )}
        {reviewable && mainPreviewId && (
          <a
            href={previewJsonUrl(mainPreviewId)}
            download
            className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
          >
            변환 JSON 내려받기
          </a>
        )}
        {run.status === 'failed' && run.error_kind === 'too_large' && (
          <button
            type="button"
            onClick={() => onSplitImport(run)}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
          >
            분할 반입
          </button>
        )}
        {(run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') && (
          <button
            type="button"
            disabled={retrying}
            onClick={() => onRetry(run)}
            className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg disabled:opacity-50"
          >
            다시 시도
          </button>
        )}
        {run.status === 'splitting' && run.split_id && (
          <button
            type="button"
            onClick={() => onSplitImport(run)}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
          >
            분할 이어서
          </button>
        )}
        {inProgress && run.job_id && (
          <button
            type="button"
            onClick={() => onCancelRequest(run)}
            className="rounded border border-border px-3 py-1.5 text-xs text-wrong hover:bg-bg"
          >
            {isSplit ? '마지막 조각 취소' : '취소'}
          </button>
        )}
        {(!inProgress || !hasLiveJob) && (
          <button
            type="button"
            disabled={dismissMutation.isPending}
            onClick={handleDismiss}
            className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg disabled:opacity-50"
          >
            목록에서 지우기
          </button>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
        >
          {expanded ? '접기' : '자세히'}
        </button>
      </div>

      {expanded && (
        <RunTimeline
          detail={detail}
          loading={detailQuery.isLoading}
          error={detailQuery.isError}
          reviewDisabledReason={reviewDisabledReason}
          reviewingPreviewId={reviewingPreviewId}
          onReviewChunk={(pid) => onReview(run, pid)}
        />
      )}
    </li>
  )
}
