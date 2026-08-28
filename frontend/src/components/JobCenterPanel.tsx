import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCancelLlmJob, useDismissLlmJob, useLlmJobs, usePauseLlmQueue, useResumeLlmQueue } from '../api/llm'
import { ApiError } from '../api/client'
import { jobCenterRoute } from '../utils/jobRoutes'
import ConfirmDialog from './ConfirmDialog'
import LlmJobProgress from './LlmJobProgress'
import type { LlmJobItem } from '../api/types'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 상태 배지 문구·색은 프론트가 정한 고정 라벨(§4.10 "notes" 관례는 label·에러 message 같은
// 자유 문장에만 적용 — 유한한 status enum을 한국어로 옮기는 것은 다른 화면(ImportQueue
// STATUS_LABEL 등)과 동일한 통상 UI 관례). item.label·error_info.message는 서버 값 그대로 렌더.
function statusLabel(status: LlmJobItem['status'], queuePosition: number | null): string {
  switch (status) {
    case 'running':
      return '진행 중'
    case 'queued':
      return queuePosition != null ? `대기 중 (${queuePosition}번째)` : '대기 중'
    case 'done':
      return '완료'
    case 'error':
      return '실패'
    case 'cancelled':
      return '취소됨'
    default:
      return status
  }
}

// 취소됨 = 중립 토큰(오류 색 아님, §5.14).
function statusBadgeClass(status: LlmJobItem['status']): string {
  switch (status) {
    case 'running':
      return 'bg-accent text-on-accent'
    case 'queued':
      return 'bg-surface-raised text-muted'
    case 'done':
      return 'bg-correct text-on-accent'
    case 'error':
      return 'bg-wrong text-on-accent'
    case 'cancelled':
      return 'border border-border text-muted'
    default:
      return 'bg-surface text-muted'
  }
}

interface JobCenterPanelProps {
  open: boolean
  onClose: () => void
}

// 설계 §4.24·§5.14(S22, F48) — 전역 LLM 작업 센터. 라우트가 아닌 전역 슬라이드 오버(PC)/바텀
// 시트(모바일) — 어느 화면에서든 현재 상태를 떠나지 않는다. 목록·취소·일시정지 전부 §4.24 신규
// 4개 엔드포인트(LLM 0·DB 0)만 사용한다. 색상은 전부 토큰.
export default function JobCenterPanel({ open, onClose }: JobCenterPanelProps) {
  const jobsQuery = useLlmJobs()
  const cancelMutation = useCancelLlmJob()
  const dismissMutation = useDismissLlmJob()
  const pauseMutation = usePauseLlmQueue()
  const resumeMutation = useResumeLlmQueue()

  const [confirmTarget, setConfirmTarget] = useState<LlmJobItem | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (!open) return null

  const items = jobsQuery.data?.items ?? []
  const paused = jobsQuery.data?.queue.paused ?? false

  function requestCancel(item: LlmJobItem) {
    setActionError(null)
    if (item.status === 'running') {
      setConfirmTarget(item)
      return
    }
    // 대기 항목 = 즉시 취소(비용 0, 확인 없음 — §4.24 ②).
    cancelMutation.mutate(item.job_id, {
      onError: (e) => setActionError(errMsg(e, '취소에 실패했습니다.')),
    })
  }

  function confirmCancel() {
    if (!confirmTarget) return
    cancelMutation.mutate(confirmTarget.job_id, {
      onError: (e) => setActionError(errMsg(e, '취소에 실패했습니다.')),
      onSettled: () => setConfirmTarget(null),
    })
  }

  // stage-42(B2-1, §4.24) — 종료(done·error·cancelled) 잡만 지울 수 있다(진행 중은 409 —
  // 이 버튼 자체가 종료 잡에만 노출되므로 정상 경로에서는 도달하지 않는다).
  function requestDismiss(jobId: string) {
    setActionError(null)
    dismissMutation.mutate(jobId, {
      onError: (e) => setActionError(errMsg(e, '목록에서 지우지 못했습니다.')),
    })
  }

  let queuedIndex = 0

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-stretch md:justify-end"
        onClick={onClose}
        role="presentation"
      >
      <div
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-xl border border-border bg-surface-raised shadow-xl md:h-full md:max-h-none md:w-[420px] md:rounded-none md:rounded-l-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="LLM 작업 센터"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-primary">LLM 작업 센터</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded p-1 text-muted hover:bg-bg hover:text-primary"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-1 border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-primary">
              {paused ? '대기열 일시정지됨' : '대기열 실행 중'}
            </span>
            <button
              type="button"
              onClick={() => {
                setActionError(null)
                if (paused) {
                  resumeMutation.mutate(undefined, {
                    onError: (e) => setActionError(errMsg(e, '재개에 실패했습니다.')),
                  })
                } else {
                  pauseMutation.mutate(undefined, {
                    onError: (e) => setActionError(errMsg(e, '일시정지에 실패했습니다.')),
                  })
                }
              }}
              disabled={pauseMutation.isPending || resumeMutation.isPending}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-bg disabled:opacity-50"
            >
              {paused ? '재개' : '일시정지'}
            </button>
          </div>
          {/* 고정 안내 — 일시정지는 대기열 수준만(§4.24 ③). */}
          <p className="text-xs text-muted">
            실행 중인 작업은 끝까지 진행됩니다 — 다음 작업부터 보류합니다.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {jobsQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
          {jobsQuery.isError && <p className="text-sm text-wrong">작업 목록을 불러오지 못했습니다.</p>}
          {jobsQuery.data && items.length === 0 && (
            <p className="text-sm text-muted">진행 중인 작업이 없습니다.</p>
          )}

          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              if (item.status === 'queued') queuedIndex += 1
              const route = jobCenterRoute(item)
              const cancellable = item.status === 'running' || item.status === 'queued'
              const dismissible = item.status === 'done' || item.status === 'error' || item.status === 'cancelled'
              return (
                <li key={item.job_id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(item.status)}`}
                    >
                      {statusLabel(item.status, item.status === 'queued' ? queuedIndex : null)}
                    </span>
                    {/* label은 서버 완성 문장 그대로(§4.10 notes 관례 — 포맷 분기 금지). */}
                    <span className="min-w-0 flex-1 break-words text-sm font-medium text-primary">
                      {item.label}
                    </span>
                  </div>

                  {item.status === 'running' && (
                    <div className="mb-2">
                      <LlmJobProgress progress={item.progress} includeDownloading includeFetching />
                    </div>
                  )}

                  {item.status === 'error' && item.error_info?.message && (
                    <p className="mb-2 text-xs text-wrong">{item.error_info.message}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {route && (
                      <Link
                        to={route}
                        onClick={onClose}
                        className="rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-bg"
                      >
                        화면으로 이동
                      </Link>
                    )}
                    {cancellable && (
                      <button
                        type="button"
                        onClick={() => requestCancel(item)}
                        disabled={cancelMutation.isPending}
                        className="rounded border border-border px-2.5 py-1 text-xs text-wrong hover:bg-bg disabled:opacity-50"
                      >
                        취소
                      </button>
                    )}
                    {/* stage-42(B2-1, §4.24) — 종료 잡 일반화: [분할 반입]이 자동으로 정리하지
                        못한 실패·완료·취소 잡도 사용자가 직접 목록에서 지울 수 있다. */}
                    {dismissible && (
                      <button
                        type="button"
                        onClick={() => requestDismiss(item.job_id)}
                        disabled={dismissMutation.isPending}
                        className="rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-bg disabled:opacity-50"
                      >
                        목록에서 지우기
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {actionError && <p className="mt-3 text-sm text-wrong">{actionError}</p>}
        </div>
      </div>
      </div>

      {/* ConfirmDialog는 배경 오버레이 div의 자식이 아닌 형제로 둔다 — 안에 두면 확인 다이얼로그의
          배경 클릭이 이벤트 버블링으로 이 패널까지 함께 닫혀 버린다(별개의 오버레이여야 함). */}
      {confirmTarget && (
        <ConfirmDialog
          title="작업 취소"
          message="실행 중 취소는 이미 처리된 토큰만큼 요금이 발생할 수 있습니다."
          confirmLabel="취소하기"
          danger
          submitting={cancelMutation.isPending}
          onConfirm={confirmCancel}
          onClose={() => setConfirmTarget(null)}
        />
      )}
    </>
  )
}
