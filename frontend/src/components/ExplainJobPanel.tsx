import { useEffect, useState } from 'react'
import { jobUnavailable } from '../api/convert'
import { useApplyExplain, useExplainJob, useStartExplain } from '../api/explain'
import { clearStoredExplainJob, getStoredExplainJob, setStoredExplainJob } from '../utils/explainJobs'
import type { DocumentDetail, LlmEngine } from '../api/types'
import { ApiError } from '../api/client'
import Modal from './Modal'
import MarkdownView from './MarkdownView'
import LlmJobProgress from './LlmJobProgress'
import LlmErrorInfoView from './LlmErrorInfo'
import EngineSelect from './EngineSelect'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// S21(설계 §4.23) — EngineSelect 표시용 billing 라벨(기존 카피 유지).
const BILLING_LABEL: Record<string, string> = {
  subscription: '구독형(정액)',
  metered: '종량 과금',
}

interface ExplainJobPanelProps {
  doc: DocumentDetail
}

// 설계 §4.20 ②(F44, S18) — 문서 상세의 [AI 풀이 생성] 진입점. 문제 타입 + 해설 없음 문서에만
// 노출한다(정답 우회 방지 정신과 별개로, 이미 해설이 있으면 서버가 409를 주므로 애초에 버튼을
// 숨긴다). 실행 전 확인 다이얼로그(엔진·과금형 + R21 경고) → 진행(LlmJobProgress 재사용) →
// 초안 미리보기(경고 배지) → [승인 반영]/[버리기] — RegenerateJobPanel(F30) 전례 그대로.
export default function ExplainJobPanel({ doc }: ExplainJobPanelProps) {
  const [stored, setStored] = useState(() => getStoredExplainJob(doc.id))
  const [dismissed, setDismissed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // S21(설계 §4.23 ⓒ) — 게이팅되는 EngineSelect로 명시 선택(기본 auto=서버 우선순위 그대로).
  const [engine, setEngine] = useState<LlmEngine>('auto')
  const jobId = stored?.jobId ?? null
  const active = jobId != null && !dismissed

  const startExplain = useStartExplain()
  const applyExplain = useApplyExplain()
  const jobQuery = useExplainJob(active ? doc.id : null, active ? jobId : null)

  // 다른 문서 상세로 이동했을 때 그 문서의 잡 상태를 다시 확인한다.
  useEffect(() => {
    setStored(getStoredExplainJob(doc.id))
    setDismissed(false)
    setConfirmOpen(false)
    setEngine('auto')
  }, [doc.id])

  const eligible =
    (doc.type === 'question' || doc.type === 'past_question') && !(doc.explanation ?? '').trim()

  // 대상이 아니고(이미 해설 있음 등) 진행 중 잡도 없으면 아무것도 렌더하지 않는다.
  if (!eligible && !active) return null

  if (!active) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded border border-border px-3 py-1.5 text-sm font-medium text-accent hover:bg-bg"
        >
          AI 풀이 생성
        </button>

        {confirmOpen && (
          <Modal title="AI 풀이 생성" onClose={() => setConfirmOpen(false)}>
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-primary">
                지문·보기{doc.answer ? '' : '(정답 없음)'}를 근거로 LLM을 1회 호출해 해설
                {doc.answer ? '' : '과 정답'}을 생성합니다.
              </p>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted">사용 엔진</p>
                <EngineSelect value={engine} onChange={setEngine} billingLabels={BILLING_LABEL} />
              </div>
              <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-xs text-primary">
                AI가 생성한 해설은 오개념이 섞여 있을 수 있습니다 — 검토 후 승인하세요.
              </div>
              {startExplain.isError && (
                <p className="text-sm text-wrong">
                  {errMsg(startExplain.error, '풀이 생성을 시작하지 못했습니다.')}
                </p>
              )}
              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={startExplain.isPending}
                  onClick={() =>
                    startExplain.mutate(
                      { documentId: doc.id, engine },
                      {
                        onSuccess: (data) => {
                          setStoredExplainJob(doc.id, { jobId: data.job_id })
                          setStored({ jobId: data.job_id })
                          setConfirmOpen(false)
                        },
                      },
                    )
                  }
                  className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                >
                  {startExplain.isPending ? '시작 중…' : '생성 시작'}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  const job = jobQuery.data
  const unavailable = jobUnavailable(jobQuery)

  if (unavailable) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-wrong">
          {unavailable === 'lost'
            ? '진행 상황을 더 이상 확인할 수 없습니다 (서버 재시작 또는 1시간 만료). 다시 시도해 주세요.'
            : errMsg(jobQuery.error, '풀이 생성 진행 상황을 확인할 수 없습니다.')}
        </p>
        <button
          type="button"
          onClick={() => {
            clearStoredExplainJob(doc.id)
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
      <div className="rounded-lg border border-border bg-surface p-4">
        <LlmJobProgress progress={job?.progress} includeDownloading={false} />
      </div>
    )
  }

  if (job.status === 'error') {
    return (
      <div className="rounded-lg border border-wrong bg-surface p-4">
        <LlmErrorInfoView errorInfo={job.error_info} legacyError={job.error} />
        <button
          type="button"
          onClick={() => {
            clearStoredExplainJob(doc.id)
            setDismissed(true)
          }}
          className="mt-3 rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
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
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-primary">AI 풀이 초안</h2>
        <span className="rounded bg-warning px-2 py-0.5 text-[11px] font-medium text-on-accent">
          AI 생성 — 오개념 가능
        </span>
      </div>
      <p className="mb-3 text-xs text-muted">
        승인하면 해설 서두에 생성 표시(마커)가 자동으로 붙어 원본과 항상 구분됩니다. 내용을 검토한
        뒤 승인하세요.
      </p>

      <div className="flex flex-col gap-3">
        {draft.answer_included && (
          <div className="rounded border border-warning bg-bg p-2 text-sm text-primary">
            <p className="mb-1 text-xs font-semibold text-warning">정답도 함께 생성됨 (원본에 없던 값)</p>
            {draft.answer || '-'}
          </div>
        )}
        <div className="rounded border border-border bg-bg p-2">
          <p className="mb-1 text-xs font-semibold text-muted">해설 초안</p>
          <MarkdownView content={draft.explanation} />
        </div>
      </div>

      {applyExplain.isError && (
        <p className="mt-3 text-sm text-wrong">{errMsg(applyExplain.error, '반영에 실패했습니다.')}</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            clearStoredExplainJob(doc.id)
            setDismissed(true)
          }}
          className="rounded border border-border px-3 py-2 text-sm text-primary hover:bg-bg"
        >
          버리기
        </button>
        <button
          type="button"
          disabled={applyExplain.isPending}
          onClick={() =>
            jobId &&
            applyExplain.mutate(
              { documentId: doc.id, jobId },
              {
                onSuccess: () => {
                  clearStoredExplainJob(doc.id)
                  setDismissed(true)
                },
              },
            )
          }
          className="rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {applyExplain.isPending ? '반영 중…' : '승인 반영'}
        </button>
      </div>
    </div>
  )
}
