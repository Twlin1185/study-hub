import { useEffect, useState } from 'react'
import { useApplyRegenerate, useRegenerate, useRegenerateJob } from '../api/convert'
import { useJobRecovery } from '../hooks/useJobRecovery'
import { clearStoredRegenerateJob, getStoredRegenerateJob, setStoredRegenerateJob } from '../utils/regenerateJobs'
import type { DocumentDetail, LlmEngine } from '../api/types'
import { ApiError } from '../api/client'
import MarkdownView from './MarkdownView'
import ReportErrorButton from './ReportErrorButton'
import LlmJobProgress from './LlmJobProgress'
import LlmErrorInfoView from './LlmErrorInfo'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

interface RegenerateJobPanelProps {
  doc: DocumentDetail
}

// 설계 §5.3, §4.11 — 문서 상세의 오류 신고 진입점 + 잡 진행 중 표시(단계·경과·토큰) + 실패 시
// error_info 안내(§4.17③ — 다음 후보 엔진으로 재시도) + 기존/신규 비교([교체]/[폐기]). job_id·신고 사유는 로컬
// (localStorage)에서 추적한다 — 백엔드에 "문서별 진행 중 잡 조회" 엔드포인트가 명세돼 있지
// 않기 때문(utils/regenerateJobs.ts 참고, 명세 갭 — 최종 보고 필요).
export default function RegenerateJobPanel({ doc }: RegenerateJobPanelProps) {
  const [stored, setStored] = useState(() => getStoredRegenerateJob(doc.id))
  const [dismissed, setDismissed] = useState(false)
  // 재진입 복원 소표기(설계 §4.24 ⑤·ⓓ, F40-① recovered 전례).
  const [recoveredNotice, setRecoveredNotice] = useState(false)
  const jobId = stored?.jobId ?? null
  const active = jobId != null && !dismissed
  const jobQuery = useRegenerateJob(active ? doc.id : null, active ? jobId : null)
  const applyRegenerate = useApplyRegenerate()
  const retryRegenerate = useRegenerate()

  // 공용 재진입 복원 훅 — localStorage 기록이 없는데 이 문서의 running·queued regenerate 잡이
  // 실제로 있으면 복원한다(기존 "진행 중 배지"=localStorage 경로와 중복 렌더 금지 — active일 때
  // 훅을 끈다). "이유" 텍스트는 서버가 갖고 있지 않으므로 빈 문자열로 저장해 두고, 실패 시
  // [다시 시도] 버튼은 reason이 실제로 있을 때만 노출한다(아래 stored?.reason 조건).
  useJobRecovery({
    kind: 'regenerate',
    enabled: !active,
    matchRef: (ref) => ref.document_id === doc.id,
    onRecovered: (job) => {
      setStoredRegenerateJob(doc.id, { jobId: job.job_id, reason: '' })
      setStored({ jobId: job.job_id, reason: '' })
      setRecoveredNotice(true)
    },
  })

  // 다른 문서 상세로 이동했을 때 그 문서의 잡 상태를 다시 확인한다.
  useEffect(() => {
    setStored(getStoredRegenerateJob(doc.id))
    setDismissed(false)
    setRecoveredNotice(false)
  }, [doc.id])

  if (!active) {
    return (
      <ReportErrorButton
        documentId={doc.id}
        variant="detail"
        onSubmitted={() => {
          setStored(getStoredRegenerateJob(doc.id))
          setDismissed(false)
        }}
      />
    )
  }

  const job = jobQuery.data

  // S15(설계 §4.17③) — engineId는 LlmErrorInfoView가 error_info.fallback_engine(없으면 legacy
  // 'api' 폴백)에서 구해 넘겨준다. 하드코딩된 engine:'api' 이항 가정 제거.
  function handleRetry(engineId: string) {
    if (!stored) return
    retryRegenerate.mutate(
      { documentId: doc.id, reason: stored.reason, engine: engineId as LlmEngine },
      {
        onSuccess: (data) => {
          const next = { jobId: data.job_id, reason: stored.reason }
          setStoredRegenerateJob(doc.id, next)
          setStored(next)
        },
      },
    )
  }

  if (jobQuery.isError) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-wrong">
          {errMsg(jobQuery.error, '재생성 진행 상황을 확인할 수 없습니다 (만료되었을 수 있습니다).')}
        </p>
        <button
          type="button"
          onClick={() => {
            clearStoredRegenerateJob(doc.id)
            setDismissed(true)
          }}
          className="mt-2 rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
        >
          닫기
        </button>
      </div>
    )
  }

  if (!job || job.status === 'running') {
    return (
      <div className="flex flex-col gap-2">
        {recoveredNotice && <p className="text-xs text-accent">진행 중 작업을 복원했습니다.</p>}
        <LlmJobProgress progress={job?.progress} includeDownloading={false} />
      </div>
    )
  }

  if (job.status === 'error') {
    return (
      <div className="rounded-lg border border-wrong bg-surface p-4">
        <LlmErrorInfoView
          errorInfo={job.error_info}
          legacyError={job.error}
          // 복원된 잡(reason 빈 문자열)은 재시도 시 빈 사유로 재요청하게 되므로 [다시 시도]를
          // 숨긴다 — 서버가 갖고 있지 않은 원 신고 사유를 프론트가 지어낼 수 없다.
          onRetry={stored?.reason ? handleRetry : undefined}
          retrying={retryRegenerate.isPending}
        />
        <button
          type="button"
          onClick={() => {
            clearStoredRegenerateJob(doc.id)
            setDismissed(true)
          }}
          className="mt-3 rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
        >
          닫기
        </button>
      </div>
    )
  }

  // 취소됨(S22, §4.24 ②) — 오류가 아닌 중립 종료 상태.
  if (job.status === 'cancelled') {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-muted">작업이 취소되었습니다.</p>
        <button
          type="button"
          onClick={() => {
            clearStoredRegenerateJob(doc.id)
            setDismissed(true)
          }}
          className="mt-2 rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
        >
          닫기
        </button>
      </div>
    )
  }

  const draft = job.draft
  if (!draft) return null

  return (
    <div className="rounded-lg border border-accent bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-primary">재생성 초안 검토</h2>
      <p className="mb-3 text-xs text-muted">
        기존 내용과 재생성된 초안을 비교하세요. [교체]하면 같은 문서 번호를 유지한 채 내용만
        바뀌어 풀이 이력·오답노트·복습(SRS) 기록이 그대로 보존됩니다. 자동 반영되지 않으니
        검토 후 직접 선택하세요.
      </p>

      <div className="flex flex-col gap-3">
        <CompareField label="제목" oldValue={doc.title} newValue={draft.title} />
        <CompareField label="지문" oldValue={doc.content} newValue={draft.content} markdown />
        <CompareField
          label="보기"
          oldValue={(doc.choices ?? []).join('\n')}
          newValue={(draft.choices ?? []).join('\n')}
        />
        <CompareField label="정답" oldValue={doc.answer} newValue={draft.answer} />
        <CompareField label="해설" oldValue={doc.explanation} newValue={draft.explanation} markdown />
        <CompareField label="태그" oldValue={doc.tags.join(', ')} newValue={draft.tags.join(', ')} />
      </div>

      {applyRegenerate.isError && (
        <p className="mt-3 text-sm text-wrong">{errMsg(applyRegenerate.error, '교체에 실패했습니다.')}</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            clearStoredRegenerateJob(doc.id)
            setDismissed(true)
          }}
          className="rounded border border-border px-3 py-2 text-sm text-primary hover:bg-bg"
        >
          폐기
        </button>
        <button
          type="button"
          disabled={applyRegenerate.isPending}
          onClick={() =>
            jobId &&
            applyRegenerate.mutate(
              { documentId: doc.id, jobId },
              {
                onSuccess: () => {
                  clearStoredRegenerateJob(doc.id)
                  setDismissed(true)
                },
              },
            )
          }
          className="rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {applyRegenerate.isPending ? '교체 중…' : '교체'}
        </button>
      </div>
    </div>
  )
}

function CompareField({
  label,
  oldValue,
  newValue,
  markdown,
}: {
  label: string
  oldValue: string | null
  newValue: string | null
  markdown?: boolean
}) {
  const changed = (oldValue ?? '') !== (newValue ?? '')
  return (
    <div className={`rounded border p-2 ${changed ? 'border-warning' : 'border-border'}`}>
      <p className="mb-1 text-xs font-semibold text-muted">
        {label} {changed && <span className="text-warning">(변경됨)</span>}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <p className="mb-0.5 text-[11px] font-semibold text-muted">기존</p>
          {markdown ? (
            <MarkdownView content={oldValue} />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-primary">{oldValue || '-'}</p>
          )}
        </div>
        <div>
          <p className="mb-0.5 text-[11px] font-semibold text-accent">신규 초안</p>
          {markdown ? (
            <MarkdownView content={newValue} />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-primary">{newValue || '-'}</p>
          )}
        </div>
      </div>
    </div>
  )
}
