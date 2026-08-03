import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCategoryTree } from '../api/categories'
import { useCreateExamSession } from '../api/exam'
import {
  useAppliedExamStatus,
  useAppliedExamHistory,
  usePrepareAppliedExam,
  useStartAppliedExamGenerate,
} from '../api/appliedExam'
import { jobUnavailable } from '../api/convert'
import { useLlmStatus } from '../api/llm'
import { useExamSessionStore } from '../stores/examSession'
import { ApiError } from '../api/client'
import CategoryScopePicker from './CategoryScopePicker'
import LlmJobProgress from './LlmJobProgress'
import LlmErrorInfoView from './LlmErrorInfo'
import LlmLimitBanner from './LlmLimitBanner'
import EngineSelect from './EngineSelect'
import Stepper from './Stepper'
import type { StepperStep } from './Stepper'
import type { AppliedExamDiscardReason, AppliedExamPrepareResponse, AppliedExamResult, LlmEngine } from '../api/types'

// 설계 §4.21(S19, F45) — 모의고사 구성 화면의 [AI 응용] 탭 본문. ① 범위·문항 수·엔진 선택 →
// [생성 준비](prepare, LLM 0) → ② 사용량 확인(확인 없이 생성 불가) → [생성 시작](generate) →
// ③ 진행(LlmJobProgress·LlmErrorInfo 재사용) → ④ 결과 요약(미달 시 경고·폐기 사유) →
// [응시 시작] = 기존 exam/session 재사용(신규 세션 API 없음).
type Step = 'setup' | 'confirm' | 'process' | 'summary'

const STEP_ORDER: Step[] = ['setup', 'confirm', 'process', 'summary']
const STEP_LABELS: Record<Step, string> = {
  setup: '범위·문항 수',
  confirm: '사용량 확인',
  process: '생성 진행',
  summary: '결과 요약',
}

const BILLING_LABEL: Record<string, string> = {
  subscription: '구독형(정액)',
  metered: '종량 과금',
}

const DISCARD_REASON_LABEL: Record<AppliedExamDiscardReason, string> = {
  invalid_item: '형식 오류(필수 항목 누락)',
  invalid_answer: '정답 형식 오류',
  missing_explanation: '해설 누락',
  bad_basis: '근거 문서 확인 불가',
  duplicate_of_source: '원본과 중복(복제 판정)',
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

export default function AppliedExamPanel() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('setup')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [countInput, setCountInput] = useState('10')
  const [engine, setEngine] = useState<LlmEngine>('auto')
  const [agreed, setAgreed] = useState(false)
  const [prepareResult, setPrepareResult] = useState<AppliedExamPrepareResponse | null>(null)
  const [genId, setGenId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  // 생성 완료(result) 캡처 — genStatusQuery는 'process' 단계에서만 활성(genId != null)이라, 'summary'
  // 단계로 넘어가며 쿼리를 끄면(캐시 키가 바뀌어) 응답을 잃는다. 여기 로컬 상태로 고정해 둔다
  // (AnswerKeyImportWizard의 previewData 로컬 캡처 전례와 동일 패턴).
  const [summaryResult, setSummaryResult] = useState<AppliedExamResult | null>(null)

  const treeQuery = useCategoryTree()
  const statusQuery = useLlmStatus()
  const prepareMutation = usePrepareAppliedExam()
  const generateMutation = useStartAppliedExamGenerate()
  const createSession = useCreateExamSession()
  const start = useExamSessionStore((s) => s.start)
  const genStatusQuery = useAppliedExamStatus(step === 'process' ? genId : null)
  const historyQuery = useAppliedExamHistory(10)

  const engineLabel =
    engine === 'auto' ? '자동' : (statusQuery.data?.engines.find((e) => e.id === engine)?.label ?? engine)
  const engineBilling =
    engine === 'auto'
      ? null
      : (statusQuery.data?.engines.find((e) => e.id === engine)?.billing ?? null)

  const count = Math.max(1, Math.min(20, Math.floor(Number(countInput)) || 1))

  // 생성 잡 완료(done) 시 결과 요약으로 전환(AnswerKeyImportWizard preview 전환 전례와 동일) — result를
  // 로컬 상태로 캡처해 둔다(위 summaryResult 주석 참조).
  useEffect(() => {
    if (step !== 'process' || genStatusQuery.data?.status !== 'done') return
    setSummaryResult(genStatusQuery.data.result ?? null)
    setStep('summary')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, genStatusQuery.data])

  function resetAll() {
    setStep('setup')
    setCategoryId(null)
    setCountInput('10')
    setEngine('auto')
    setAgreed(false)
    setPrepareResult(null)
    setGenId(null)
    setStartError(null)
    setSummaryResult(null)
  }

  function handlePrepare() {
    if (categoryId == null) return
    prepareMutation.mutate(
      { category_ids: [categoryId], count },
      {
        onSuccess: (data) => {
          setPrepareResult(data)
          setAgreed(false)
          setStep('confirm')
        },
      },
    )
  }

  function handleGenerate() {
    if (!prepareResult) return
    generateMutation.mutate(
      { genId: prepareResult.gen_id, engine },
      {
        onSuccess: () => {
          setGenId(prepareResult.gen_id)
          setStep('process')
        },
      },
    )
  }

  function handleStartExam() {
    const runCategoryId = summaryResult?.run_category_id
    if (runCategoryId == null) return
    setStartError(null)
    createSession.mutate(
      { subjects: [{ category_id: runCategoryId }], order: 'sequential' },
      {
        onSuccess: (data) => {
          start(data.subjects, data.time_limit_minutes, data.cut, data.order, true, runCategoryId)
          navigate('/exam/run')
        },
        onError: (e) => setStartError(errMsg(e, '응시를 시작하지 못했습니다.')),
      },
    )
  }

  function handleStepNavigate(target: Step) {
    const currentIndex = STEP_ORDER.indexOf(step)
    const targetIndex = STEP_ORDER.indexOf(target)
    if (targetIndex >= currentIndex) return // 지나온(done) 단계만 클릭 가능
    if (target === 'setup') resetAll()
    else setStep(target)
  }

  const steps: StepperStep[] = STEP_ORDER.map((key, i) => {
    const currentIndex = STEP_ORDER.indexOf(step)
    return {
      key,
      label: STEP_LABELS[key],
      status: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
    }
  })

  const unavailable = step === 'process' ? jobUnavailable(genStatusQuery) : null
  const running =
    step === 'process' &&
    unavailable == null &&
    (genStatusQuery.data == null || genStatusQuery.data.status === 'running')
  const jobFailed = step === 'process' && genStatusQuery.data?.status === 'error'
  const shortfall = summaryResult != null && summaryResult.generated < summaryResult.requested

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <Stepper steps={steps} size="sm" onStepClick={(i) => handleStepNavigate(STEP_ORDER[i])} />

        <div className="mt-4">
          {step === 'setup' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                범위 안의 기출·개념 문서를 근거로 LLM이 <b className="text-primary">응용 문항</b>을 새로
                만듭니다(기출 그대로가 아닙니다). 생성 문항은 <b className="text-primary">격리 분류</b>에만
                저장되어 문서고 본류·일반 퀴즈·SRS를 오염시키지 않습니다.
              </p>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-primary">범위 선택</h3>
                {treeQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
                {treeQuery.isError && <p className="text-sm text-wrong">분류를 불러오지 못했습니다.</p>}
                {treeQuery.data && (
                  <CategoryScopePicker nodes={treeQuery.data} selectedId={categoryId} onSelect={setCategoryId} />
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  문항 수 (1~20)
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={countInput}
                    onChange={(e) => setCountInput(e.target.value)}
                    className="w-24 rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                  />
                </label>

                <div>
                  <p className="mb-1 text-xs font-semibold text-muted">엔진</p>
                  <EngineSelect value={engine} onChange={setEngine} />
                </div>
              </div>

              {prepareMutation.isError && (
                <p className="text-sm text-wrong">{errMsg(prepareMutation.error, '생성 준비에 실패했습니다.')}</p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={categoryId == null || prepareMutation.isPending}
                  onClick={handlePrepare}
                  className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                >
                  {prepareMutation.isPending ? '확인 중…' : '생성 준비'}
                </button>
              </div>
            </div>
          )}

          {step === 'confirm' && prepareResult && (
            <div className="flex flex-col gap-4">
              <div className="rounded border border-border bg-bg p-3 text-sm">
                <p className="font-medium text-primary">{prepareResult.scope_label}</p>
                <p className="mt-1 text-xs text-muted">
                  근거 문서 — 기출 {prepareResult.source_counts.past_question}건 · 문제{' '}
                  {prepareResult.source_counts.question}건 · 개념 {prepareResult.source_counts.concept}건
                </p>
                <p className="mt-1 text-xs text-muted">
                  요청 문항 수 {prepareResult.requested_count}개 (실제 생성 수는 검증 게이트 통과분에 따라
                  달라질 수 있습니다)
                </p>
                <p className="mt-1 text-xs text-muted">
                  예상 입력 토큰 약 {prepareResult.estimate.approx_input_tokens.toLocaleString()}
                  {prepareResult.estimate.assumed && ' (가정치)'}
                </p>
                <p className="mt-1 text-xs text-muted">
                  사용 엔진: {engineLabel}
                  {engineBilling && ` (${BILLING_LABEL[engineBilling] ?? engineBilling})`}
                </p>
              </div>

              <LlmLimitBanner />

              {/* 고정 고지 — 항상 표시, 확인 없이 생성 불가 (FetchImportWizard·AnswerKeyImportWizard 전례) */}
              <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
                생성 문항은 기출 원본이 아닙니다 — 정답·해설 품질을 항상 검토하고, 이상하면 결과 화면의
                [오류 신고]를 이용하세요.
              </div>

              <label className="flex items-center gap-2 text-sm text-primary">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                위 내용을 확인했습니다.
              </label>

              {generateMutation.isError && (
                <p className="text-sm text-wrong">{errMsg(generateMutation.error, '생성 시작에 실패했습니다.')}</p>
              )}

              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep('setup')}
                  className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
                >
                  ← 뒤로
                </button>
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

          {step === 'process' && (
            <div className="flex flex-col gap-3">
              {running && <LlmJobProgress progress={genStatusQuery.data?.progress} includeDownloading={false} />}

              {unavailable && (
                <div className="flex flex-col gap-2 rounded-lg border border-warning bg-accent-soft p-3 text-sm text-primary">
                  <p className="font-medium">
                    {unavailable === 'lost'
                      ? '진행 상황을 더 이상 확인할 수 없습니다'
                      : '서버에 연결하지 못했습니다'}
                  </p>
                  <p className="text-xs text-muted">
                    {unavailable === 'lost'
                      ? '서버가 다시 시작되었거나 작업 정보가 만료되어(1시간) 진행 상황이 사라졌습니다. 처음부터 다시 시도해 주세요.'
                      : '서버가 꺼져 있거나 다시 시작하는 중일 수 있습니다. 서버를 켠 뒤 [다시 확인]을 눌러 보세요.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unavailable === 'unreachable' && (
                      <button
                        type="button"
                        onClick={() => genStatusQuery.refetch()}
                        className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                      >
                        다시 확인
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={resetAll}
                      className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                    >
                      처음부터 다시 시도
                    </button>
                  </div>
                </div>
              )}

              {jobFailed && (
                <div className="flex flex-col gap-2">
                  <LlmErrorInfoView
                    errorInfo={genStatusQuery.data?.error_info}
                    legacyError={genStatusQuery.data?.error}
                  />
                  <button
                    type="button"
                    onClick={resetAll}
                    className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                  >
                    처음부터 다시
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'summary' && summaryResult && (
            <div className="flex flex-col gap-4">
              <div className="rounded border border-border bg-bg p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-primary">
                    요청 {summaryResult.requested}개 중 {summaryResult.generated}개 생성
                  </p>
                  {shortfall && (
                    <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-medium text-on-accent">
                      요청보다 적게 생성됨
                    </span>
                  )}
                </div>
                {summaryResult.discarded.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
                    {summaryResult.discarded.map((d) => (
                      <li key={d.reason}>
                        {DISCARD_REASON_LABEL[d.reason] ?? d.reason}: {d.count}건 폐기
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {startError && <p className="text-sm text-wrong">{startError}</p>}

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={createSession.isPending}
                  onClick={handleStartExam}
                  className="flex-1 rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                >
                  {createSession.isPending ? '준비 중…' : '응시 시작'}
                </button>
                <button
                  type="button"
                  onClick={resetAll}
                  className="flex-1 rounded border border-border px-4 py-2.5 text-sm font-medium text-primary hover:bg-bg"
                >
                  새로 생성
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI 응용 탭 하단 응시 이력(§4.21) — 실전 이력(exam/history)과 분리 표시, 혼입 없음. */}
      {historyQuery.data && historyQuery.data.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">AI 응용 응시 이력</h2>
          <div className="flex flex-col gap-1.5">
            {historyQuery.data.map((h) => (
              <div
                key={h.taken_at}
                className="flex items-center justify-between gap-2 rounded border border-border bg-bg px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-primary" title={h.label}>
                  {h.label}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-muted">{h.total.score}점</span>
                  <span className={`text-xs font-medium ${h.passed ? 'text-correct' : 'text-wrong'}`}>
                    {h.passed ? '합격' : '불합격'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
