import { useEffect, useState } from 'react'
import {
  useImproveGenJob,
  useImproveGenPrepare,
  useStartImproveGen,
} from '../../api/improve'
import { jobUnavailable } from '../../api/convert'
import { ApiError } from '../../api/client'
import Modal from '../Modal'
import LlmJobProgress from '../LlmJobProgress'
import LlmErrorInfoView from '../LlmErrorInfo'
import LlmLimitBanner from '../LlmLimitBanner'
import { useLlmStatus } from '../../api/llm'
import type { LlmEngine } from '../../api/types'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

const BILLING_LABEL: Record<string, string> = {
  subscription: '구독제(정액)',
  metered: '종량제(사용한 만큼 과금)',
}

type Step = 'preparing' | 'confirm' | 'progress' | 'result'

interface ImproveGenWizardProps {
  caseIds: string[]
  onClose: () => void
  // 생성 잡이 완료(성공)되면 호출 — 호출부가 제안 목록을 새로고침하고 탭을 전환할 수 있게 한다.
  onGenerated?: () => void
}

// 설계 §4.22 ②(F46, S20) — 개선 제안 생성. prepare(LLM 0 견적) → 확인 스텝(estimate·엔진·
// 과금형·고지, FetchImportWizard 전례) → generate(LLM 호출) → 진행(LlmJobProgress) → 결과
// 요약(proposal 수 + discarded 사유 — 조용한 축소 금지).
export default function ImproveGenWizard({ caseIds, onClose, onGenerated }: ImproveGenWizardProps) {
  const [step, setStep] = useState<Step>('preparing')
  const [genId, setGenId] = useState<string | null>(null)
  const [engine, setEngine] = useState<LlmEngine>('auto')
  const [agreed, setAgreed] = useState(false)

  const statusQuery = useLlmStatus()
  const prepareMutation = useImproveGenPrepare()
  const generateMutation = useStartImproveGen()
  // generate 호출 전(=아직 진행 스텝이 아님)에는 잡이 시작되지 않았으므로 폴링하지 않는다
  // (AnswerKeyImportWizard의 useAnswerKeyStatus(step === 'process' ? keyId : null) 전례).
  const genJobQuery = useImproveGenJob(step === 'progress' || step === 'result' ? genId : null)

  const engines = statusQuery.data?.engines ?? []
  const engineOptions: { value: LlmEngine; label: string; billing?: string }[] = [
    { value: 'auto', label: '자동' },
    ...engines.map((e) => ({ value: e.id as LlmEngine, label: e.label, billing: e.billing })),
  ]

  function runPrepare() {
    prepareMutation.mutate(
      { case_ids: caseIds },
      {
        onSuccess: (data) => {
          setGenId(data.gen_id)
          setStep('confirm')
        },
      },
    )
  }

  useEffect(() => {
    runPrepare()
    // 최초 1회만 — 사례 선택은 위저드가 열린 시점에 고정된다(선택 조정은 닫고 다시 선택).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (step === 'progress' && genJobQuery.data?.status === 'done') setStep('result')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, genJobQuery.data?.status])

  function handleGenerate() {
    if (!genId) return
    generateMutation.mutate(
      { genId, engine },
      {
        onSuccess: () => setStep('progress'),
      },
    )
  }

  const unavailable = step === 'progress' || step === 'result' ? jobUnavailable(genJobQuery) : null
  const running =
    (step === 'progress' || step === 'result') &&
    unavailable == null &&
    (genJobQuery.data == null || genJobQuery.data.status === 'running')
  const jobFailed = genJobQuery.data?.status === 'error'
  const result = genJobQuery.data?.result

  return (
    <Modal title="개선 제안 생성" onClose={onClose} widthClass="max-w-lg">
      <div className="flex flex-col gap-4">
        {step === 'preparing' && (
          <div className="flex flex-col gap-3">
            {prepareMutation.isPending && <p className="text-sm text-muted">입력 조립 중… (LLM 호출 없음)</p>}
            {prepareMutation.isError && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-wrong">{errMsg(prepareMutation.error, '사용량 견적을 불러오지 못했습니다.')}</p>
                <button
                  type="button"
                  onClick={runPrepare}
                  className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                >
                  다시 시도
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'confirm' && prepareMutation.data && (
          <div className="flex flex-col gap-4">
            <div className="rounded border border-border bg-bg p-3 text-sm">
              <p className="font-medium text-primary">선택 사례 {prepareMutation.data.case_count}건</p>
              <p className="mt-1 text-xs text-muted">
                예상 입력 토큰 약 {prepareMutation.data.estimate.approx_input_tokens.toLocaleString()}
                {prepareMutation.data.estimate.assumed && ' (가정치)'}
              </p>
            </div>

            <LlmLimitBanner />

            <div>
              <p className="mb-1 text-xs font-semibold text-muted">사용 엔진 (과금형 표시)</p>
              <div className="flex flex-wrap gap-2">
                {engineOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEngine(opt.value)}
                    aria-pressed={engine === opt.value}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                      engine === opt.value ? 'bg-accent text-on-accent' : 'bg-bg text-muted hover:bg-surface-raised'
                    }`}
                  >
                    {opt.label}
                    {opt.billing && ` · ${BILLING_LABEL[opt.billing] ?? opt.billing}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
              생성된 제안은 승인해야만 파일에 반영됩니다 — 이 단계는 제안함에 카드로 올라올 뿐입니다.
            </div>

            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              위 예상 사용량을 확인했습니다.
            </label>

            {generateMutation.isError && (
              <p className="text-sm text-wrong">{errMsg(generateMutation.error, '생성 시작에 실패했습니다.')}</p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={!agreed || generateMutation.isPending}
                onClick={handleGenerate}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {generateMutation.isPending ? '시작 중…' : '생성 시작'}
              </button>
            </div>
          </div>
        )}

        {(step === 'progress' || step === 'result') && (
          <div className="flex flex-col gap-3">
            {running && <LlmJobProgress progress={genJobQuery.data?.progress} includeDownloading={false} />}

            {unavailable && (
              <div className="flex flex-col gap-2 rounded-lg border border-warning bg-accent-soft p-3 text-sm text-primary">
                <p className="font-medium">
                  {unavailable === 'lost' ? '진행 상황을 더 이상 확인할 수 없습니다' : '서버에 연결하지 못했습니다'}
                </p>
                <p className="text-xs text-muted">
                  {unavailable === 'lost'
                    ? '서버가 다시 시작되었거나 작업 정보가 만료되어(1시간) 진행 상황이 사라졌습니다. 처음부터 다시 시도해 주세요.'
                    : '서버가 꺼져 있거나 다시 시작하는 중일 수 있습니다. 서버를 켠 뒤 [다시 확인]을 눌러 보세요.'}
                </p>
                {unavailable === 'unreachable' && (
                  <button
                    type="button"
                    onClick={() => genJobQuery.refetch()}
                    className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                  >
                    다시 확인
                  </button>
                )}
              </div>
            )}

            {jobFailed && <LlmErrorInfoView errorInfo={genJobQuery.data?.error_info} />}

            {step === 'result' && result && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-surface p-3 text-center">
                    <p className="text-2xl font-semibold text-primary">{result.proposal_ids.length}</p>
                    <p className="text-xs text-muted">생성된 제안</p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-3 text-center">
                    <p className="text-2xl font-semibold text-primary">
                      {result.discarded.reduce((sum, d) => sum + d.count, 0)}
                    </p>
                    <p className="text-xs text-muted">폐기됨</p>
                  </div>
                </div>

                {/* 조용한 축소 금지 — 폐기 사유를 항상 구조화해 보여준다(설계 §4.22 ②-3). */}
                {result.discarded.length > 0 && (
                  <div className="rounded-lg border border-border bg-bg p-3">
                    <p className="mb-1 text-xs font-semibold text-muted">폐기 사유</p>
                    <ul className="flex flex-col gap-1">
                      {result.discarded.map((d, i) => (
                        <li key={i} className="text-xs text-primary">
                          {d.reason} — {d.count}건
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onGenerated}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
                  >
                    제안함에서 보기
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
