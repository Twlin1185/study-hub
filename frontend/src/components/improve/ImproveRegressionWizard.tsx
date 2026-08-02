import { useEffect, useState } from 'react'
import {
  useImproveCases,
  useImproveRegressionPrepare,
  useImproveRegressionJob,
  useStartImproveRegression,
} from '../../api/improve'
import { jobUnavailable } from '../../api/convert'
import { ApiError } from '../../api/client'
import Modal from '../Modal'
import LlmJobProgress from '../LlmJobProgress'
import LlmErrorInfoView from '../LlmErrorInfo'
import LlmLimitBanner from '../LlmLimitBanner'
import EngineSelect from '../EngineSelect'
import type { ImproveProposalListItem, LlmEngine } from '../../api/types'
import { ORIGIN_LABEL, REGRESSION_OUTCOME_BADGE_CLASS, REGRESSION_OUTCOME_LABEL, kindLabel } from './labels'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

const BILLING_LABEL: Record<string, string> = {
  subscription: '구독제(정액)',
  metered: '종량제(사용한 만큼 과금)',
}

const MAX_REGRESSION_CASES = 10

type Step = 'select' | 'confirm' | 'progress' | 'result'

interface ImproveRegressionWizardProps {
  proposal: ImproveProposalListItem
  onClose: () => void
  onDone?: () => void
}

// 설계 §4.22 ④(F46, S20) — 회귀 재검증. 사례 선택(기본 = 근거 사례 + 같은 kind, 1~10건, 신고
// 사례(user_report)는 자동 회귀 대상이 아니라 선택지에서 제외 — "이 단계에서 하지 않는 것") →
// prepare(LLM 0 견적) → 확인 스텝 → run(LLM 호출) → 진행 → results[] outcome 표시. 검증
// 전용(preview 미등록·DB 무기록) — 반입 경로와 절연.
export default function ImproveRegressionWizard({ proposal, onClose, onDone }: ImproveRegressionWizardProps) {
  const [step, setStep] = useState<Step>('select')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  const [regId, setRegId] = useState<string | null>(null)
  const [engine, setEngine] = useState<LlmEngine>('auto')
  const [agreed, setAgreed] = useState(false)

  const allCasesQuery = useImproveCases(1, 50)
  const prepareMutation = useImproveRegressionPrepare()
  const runMutation = useStartImproveRegression()
  // run 호출 전에는 잡이 시작되지 않았으므로 폴링하지 않는다(ImproveGenWizard와 동일 판단).
  const regJobQuery = useImproveRegressionJob(step === 'progress' || step === 'result' ? regId : null)

  const allCases = allCasesQuery.data?.items ?? []
  // user_report 사례는 자동 회귀 판정 대상이 아니다(§4.22 ④-1, 서버 422) — 선택지에서 원천 제외.
  const selectableCases = allCases.filter((c) => c.kind !== 'user_report')

  // 기본 선택 = 근거 사례 + 같은 kind 사례(상한 10건) — 사례 목록이 도착한 뒤 1회만 계산한다.
  useEffect(() => {
    if (defaultsApplied || allCasesQuery.data == null) return
    const evidence = selectableCases.filter((c) => proposal.case_ids.includes(c.case_id))
    const evidenceKinds = new Set(evidence.map((c) => c.kind))
    const sameKind = selectableCases.filter((c) => evidenceKinds.has(c.kind))
    const ids = Array.from(new Set([...evidence.map((c) => c.case_id), ...sameKind.map((c) => c.case_id)])).slice(
      0,
      MAX_REGRESSION_CASES,
    )
    setSelectedIds(new Set(ids))
    setDefaultsApplied(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCasesQuery.data])

  useEffect(() => {
    if (step === 'progress' && regJobQuery.data?.status === 'done') setStep('result')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, regJobQuery.data?.status])

  function toggle(caseId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(caseId)) {
        next.delete(caseId)
      } else if (next.size < MAX_REGRESSION_CASES) {
        next.add(caseId)
      }
      return next
    })
  }

  function handlePrepare() {
    prepareMutation.mutate(
      { case_ids: Array.from(selectedIds) },
      {
        onSuccess: (data) => {
          setRegId(data.reg_id)
          setStep('confirm')
        },
      },
    )
  }

  function handleRun() {
    if (!regId) return
    runMutation.mutate(
      { regId, engine },
      {
        onSuccess: () => setStep('progress'),
      },
    )
  }

  const unavailable = step === 'progress' || step === 'result' ? jobUnavailable(regJobQuery) : null
  const running =
    (step === 'progress' || step === 'result') &&
    unavailable == null &&
    (regJobQuery.data == null || regJobQuery.data.status === 'running')
  const jobFailed = regJobQuery.data?.status === 'error'
  const results = regJobQuery.data?.results ?? []

  return (
    <Modal title="회귀 재검증" onClose={onClose} widthClass="max-w-2xl">
      <div className="flex flex-col gap-4">
        {step === 'select' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              반영된 제안(『{proposal.title}』)의 근거 사례 + 같은 유형 사례가 기본 선택돼 있습니다.
              최대 {MAX_REGRESSION_CASES}건까지 조정할 수 있습니다.
            </p>

            {allCasesQuery.isLoading && <p className="text-sm text-muted">사례 목록 불러오는 중…</p>}
            {selectableCases.length === 0 && allCasesQuery.data && (
              <p className="text-sm text-muted">회귀 검증에 쓸 수 있는 사례가 없습니다(신고 사례는 제외됩니다).</p>
            )}

            <p className="text-xs text-muted">선택 {selectedIds.size} / {MAX_REGRESSION_CASES}건</p>

            <ul className="flex max-h-80 flex-col gap-2 overflow-auto">
              {selectableCases.map((c) => {
                const checked = selectedIds.has(c.case_id)
                const disabled = !checked && selectedIds.size >= MAX_REGRESSION_CASES
                return (
                  <li key={c.case_id}>
                    <label
                      className={`flex items-start gap-2 rounded border border-border bg-bg p-2 text-sm ${
                        disabled ? 'opacity-50' : 'cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(c.case_id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                            {kindLabel(c.kind)}
                          </span>
                          <span className="text-[11px] text-muted">{ORIGIN_LABEL[c.origin] ?? c.origin}</span>
                          {proposal.case_ids.includes(c.case_id) && (
                            <span className="rounded border border-accent px-1.5 py-0.5 text-[11px] text-accent">
                              근거 사례
                            </span>
                          )}
                        </div>
                        {c.document && (
                          <p className="truncate text-[11px] text-muted">
                            {c.document.doc_no} — {c.document.title}
                          </p>
                        )}
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>

            {prepareMutation.isError && (
              <p className="text-sm text-wrong">{errMsg(prepareMutation.error, '사용량 견적을 불러오지 못했습니다.')}</p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={selectedIds.size === 0 || prepareMutation.isPending}
                onClick={handlePrepare}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {prepareMutation.isPending ? '확인 중…' : '다음: 사용량 확인'}
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && prepareMutation.data && (
          <div className="flex flex-col gap-4">
            <div className="rounded border border-border bg-bg p-3 text-sm">
              <p className="font-medium text-primary">회귀 재검증 대상 {prepareMutation.data.case_count}건</p>
              <p className="mt-1 text-xs text-muted">
                예상 입력 토큰 약 {prepareMutation.data.estimate.approx_input_tokens.toLocaleString()}
                {prepareMutation.data.estimate.assumed && ' (사례당 전체 재변환 비용 — 보수 가정치)'}
              </p>
            </div>

            <LlmLimitBanner />

            <div>
              <p className="mb-1 text-xs font-semibold text-muted">사용 엔진 (과금형 표시)</p>
              <EngineSelect value={engine} onChange={setEngine} billingLabels={BILLING_LABEL} />
            </div>

            <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
              검증 전용입니다 — 반입 대기열·미리보기·DB에는 아무 흔적도 남기지 않습니다.
            </div>

            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              위 예상 사용량을 확인했습니다.
            </label>

            {runMutation.isError && (
              <p className="text-sm text-wrong">{errMsg(runMutation.error, '실행에 실패했습니다.')}</p>
            )}

            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setStep('select')}
                className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
              >
                ← 뒤로
              </button>
              <button
                type="button"
                disabled={!agreed || runMutation.isPending}
                onClick={handleRun}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {runMutation.isPending ? '시작 중…' : '실행'}
              </button>
            </div>
          </div>
        )}

        {(step === 'progress' || step === 'result') && (
          <div className="flex flex-col gap-3">
            {running && <LlmJobProgress progress={regJobQuery.data?.progress} includeDownloading={false} />}

            {unavailable && (
              <div className="flex flex-col gap-2 rounded-lg border border-warning bg-accent-soft p-3 text-sm text-primary">
                <p className="font-medium">
                  {unavailable === 'lost' ? '진행 상황을 더 이상 확인할 수 없습니다' : '서버에 연결하지 못했습니다'}
                </p>
                <p className="text-xs text-muted">
                  {unavailable === 'lost'
                    ? '서버가 다시 시작되었거나 작업 정보가 만료되어(1시간) 진행 상황이 사라졌습니다.'
                    : '서버가 꺼져 있거나 다시 시작하는 중일 수 있습니다. 서버를 켠 뒤 [다시 확인]을 눌러 보세요.'}
                </p>
                {unavailable === 'unreachable' && (
                  <button
                    type="button"
                    onClick={() => regJobQuery.refetch()}
                    className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                  >
                    다시 확인
                  </button>
                )}
              </div>
            )}

            {jobFailed && <LlmErrorInfoView errorInfo={regJobQuery.data?.error_info} />}

            {step === 'result' && results.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-primary">결과</p>
                {results.map((r) => {
                  const caseRecord = allCasesQuery.data?.items.find((c) => c.case_id === r.case_id)
                  return (
                    <div key={r.case_id} className="rounded border border-border bg-bg p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted">{r.case_id}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REGRESSION_OUTCOME_BADGE_CLASS[r.outcome]}`}
                        >
                          {REGRESSION_OUTCOME_LABEL[r.outcome]}
                        </span>
                      </div>
                      {r.detail && <p className="mt-1 text-xs text-muted">{r.detail}</p>}
                      {/* 사례 레코드의 regressions 이력 소표기(§4.22 ④-3) */}
                      {caseRecord && caseRecord.regressions.length > 0 && (
                        <p className="mt-1 text-[11px] text-muted">
                          이 사례 누적 이력: {caseRecord.regressions.length}회
                          {' · '}
                          {caseRecord.regressions
                            .slice(-3)
                            .map((h) => REGRESSION_OUTCOME_LABEL[h.outcome])
                            .join(', ')}
                        </p>
                      )}
                    </div>
                  )
                })}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onDone}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
                  >
                    닫기
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
