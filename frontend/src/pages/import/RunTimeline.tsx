import { Link } from 'react-router-dom'
import type { ImportRun, ImportRunDetail, ImportRunEvent } from '../../api/types'

// 반입 건 타임라인(설계 §5.9 [S56] C) — [자세히] 펼침. events[] 시간순(점 + message + 상대 시각) ·
// 생성 문서 링크(비활성 = "휴지통" 배지) · 실패 사례 링크(FB-31) · 분할 run 조각 k/N 표.
// message는 서버가 완성한 문구 그대로 렌더한다(포맷 분기 0).

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diffSec = Math.floor((Date.now() - t) / 1000)
  if (diffSec < 45) return '방금 전'
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `${Math.max(min, 1)}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day}일 전`
  return new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
}

// 이벤트 type -> 점 색(토큰만). 모르는 type은 중립.
function eventDotClass(type: string): string {
  if (type === 'job_failed') return 'bg-wrong'
  if (type === 'committed' || type === 'answer_key_applied') return 'bg-correct'
  if (type === 'preview_ready' || type === 'split_analyzed' || type === 'split_enqueued') return 'bg-accent'
  if (type === 'job_cancelled' || type === 'expired') return 'bg-warning'
  return 'bg-border'
}

// 분할 조각 총수 — split_enqueued 이벤트의 detail.chunks(숫자 또는 배열) / job_ids 길이. 모르면 null.
export function splitTotalFromEvents(events: ImportRunEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev.type !== 'split_enqueued') continue
    const d = ev.detail ?? {}
    const chunks = (d as Record<string, unknown>).chunks
    if (typeof chunks === 'number') return chunks
    if (Array.isArray(chunks)) return chunks.length
    const jobIds = (d as Record<string, unknown>).job_ids
    if (Array.isArray(jobIds)) return jobIds.length
  }
  return null
}

function isCommittedPreview(run: ImportRun, previewId: string): boolean {
  if (run.summary.previews.some((p) => p.preview_id === previewId && p.committed_at)) return true
  return run.summary.commits.some(
    (c) => typeof c === 'object' && c != null && (c as { preview_id?: unknown }).preview_id === previewId,
  )
}

interface RunTimelineProps {
  detail: ImportRunDetail | undefined
  loading: boolean
  error: boolean
  reviewDisabledReason: string | null
  reviewingPreviewId: string | null
  onReviewChunk: (previewId: string) => void
}

export default function RunTimeline({
  detail,
  loading,
  error,
  reviewDisabledReason,
  reviewingPreviewId,
  onReviewChunk,
}: RunTimelineProps) {
  if (loading) return <p className="text-xs text-muted">불러오는 중…</p>
  if (error || !detail) return <p className="text-xs text-wrong">자세한 내용을 불러오지 못했습니다.</p>

  const { run, events, documents, failure_cases: failureCases } = detail
  const previews = run.summary.previews
  const isSplit = run.split_id != null || previews.length > 1
  const splitTotal = run.summary.chunks_total ?? splitTotalFromEvents(events)
  const chunksFailed = run.summary.chunks_failed ?? 0

  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-bg p-3">
      <ol className="flex flex-col gap-1.5">
        {events.map((ev) => (
          <li key={ev.id} className="flex items-start gap-2 text-xs">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${eventDotClass(ev.type)}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words text-primary">{ev.message}</span>
            <span className="shrink-0 text-muted">{formatRelative(ev.at)}</span>
          </li>
        ))}
        {events.length === 0 && <li className="text-xs text-muted">기록된 이벤트가 없습니다.</li>}
      </ol>

      {isSplit && previews.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-accent">
            분할 조각 {previews.length}/{splitTotal ?? previews.length}
            {chunksFailed > 0 && (
              <span className="ml-2 rounded-full bg-wrong px-2 py-0.5 text-[11px] font-medium text-on-accent">
                실패 {chunksFailed}
              </span>
            )}
          </p>
          <ul className="flex flex-col gap-1">
            {previews.map((p, i) => {
              const committed = isCommittedPreview(run, p.preview_id)
              return (
                <li
                  key={p.preview_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1 text-xs"
                >
                  <span className="text-primary">조각 {p.chunk_index ?? i + 1}</span>
                  <span className="flex items-center gap-2">
                    <span className={committed ? 'text-correct' : 'text-muted'}>{committed ? '반입 완료' : '검토 대기'}</span>
                    {!committed && (
                      <button
                        type="button"
                        disabled={reviewDisabledReason != null || reviewingPreviewId === p.preview_id}
                        onClick={() => onReviewChunk(p.preview_id)}
                        className="rounded bg-accent px-2 py-1 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                      >
                        {reviewingPreviewId === p.preview_id ? '여는 중…' : '검토'}
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {documents.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-muted">생성 문서</p>
          <ul className="flex flex-col gap-0.5">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Link to={`/docs/${d.id}`} className="break-all text-accent hover:underline">
                  {d.doc_no} — {d.title}
                </Link>
                {!d.is_active && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">휴지통</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failureCases.length > 0 && (
        <Link to="/suggestions?tab=improve" className="w-fit text-xs text-accent hover:underline">
          실패 사례 {failureCases.length}건 → 제안함 › 반입 개선
        </Link>
      )}

      {reviewDisabledReason && <p className="text-xs text-warning">{reviewDisabledReason}</p>}
    </div>
  )
}
