import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useImportCommit, useImportPreview } from '../api/import'
import { isJobLost, jobUnavailable, useConvertedPreview, useConvertJob, useStartConvert } from '../api/convert'
import { ApiError } from '../api/client'
import { clearStoredConvertJob, getStoredConvertJob, setStoredConvertJob } from '../utils/convertJob'
import LlmJobProgress from '../components/LlmJobProgress'
import LlmErrorInfoView from '../components/LlmErrorInfo'
import LlmLimitBanner from '../components/LlmLimitBanner'
import Stepper from '../components/Stepper'
import ConfirmDialog from '../components/ConfirmDialog'
import FetchImportWizard from '../components/FetchImportWizard'
import type { StepperStep } from '../components/Stepper'
import type {
  ImportAction,
  ImportCommitResult,
  ImportDecision,
  ImportItem,
  ImportPreviewResponse,
  LlmErrorInfo,
} from '../api/types'

type WizardStep = 'select' | 'preview' | 'result'
// 'convert' = 원본 파일 업로드 자동 변환 · 'url' = URL 반입(§4.11 F35 1단계) — 둘 다 ConvertStep을
// 공유하고 sourceKind로 UI만 갈린다. 'fetch' = 사이트에서 가져오기(§5.9, S10, F35 2단계) — 자체
// 4단계 서브플로(FetchImportWizard)를 가진다.
type EntryMode = 'json' | 'convert' | 'url' | 'fetch'

interface ItemDecisionState {
  action: ImportAction
  // number = 기존 분류 category_id(exists:true) · string = 생성 승인할 경로(exists:false)
  approvedCategoryIds: (number | string)[]
  approvedRelationIds: number[]
}

const TYPE_LABEL: Record<string, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출',
  flashcard: '카드',
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 한도 기억(remembered-limit) 사전 차단 — 폴백 ask/off일 때 변환 시작 자체가 409로 거부되며
// detail에 LlmErrorInfo가 실려 온다(설계 §4.11). 원문 판별은 과하지 않게 kind 필드 존재만 본다.
function extractLlmErrorInfo(error: unknown): LlmErrorInfo | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const detail = error.detail
  if (detail && typeof detail === 'object' && 'kind' in detail) {
    return detail as LlmErrorInfo
  }
  return null
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

// 분류 제안 승인 식별키 — 기존 분류면 category_id, 생성 제안이면 path 문자열
function categoryApprovalKey(sc: { category_id: number | null; path: string }): number | string {
  return sc.category_id ?? sc.path
}

function buildInitialDecisions(items: ImportItem[]): Record<number, ItemDecisionState> {
  const initial: Record<number, ItemDecisionState> = {}
  for (const item of items) {
    if (item.status === 'error') continue
    initial[item.index] = {
      action: item.status === 'duplicate_suspect' ? 'skip' : 'new',
      // 분류 제안은 기존/생성 제안 모두 기본 체크
      approvedCategoryIds: item.suggest_categories.map(categoryApprovalKey),
      approvedRelationIds: item.suggest_relations
        .filter((r) => r.found && r.document_id != null)
        .map((r) => r.document_id as number),
    }
  }
  return initial
}

// 새로고침해도 진행 중인 convert 잡의 폴링이 이어지도록, 마운트 시 localStorage에 남은 잡이
// 있으면 해당 진입 모드로 초기화한다(설계 §4.11 진행 가시화 요구사항).
function initialEntryMode(): EntryMode {
  const stored = getStoredConvertJob()
  if (!stored) return 'json'
  if (stored.sourceKind === 'fetch') return 'fetch'
  return stored.sourceKind === 'url' ? 'url' : 'convert'
}

export default function ImportPage() {
  const [entryMode, setEntryMode] = useState<EntryMode>(initialEntryMode)
  const [step, setStep] = useState<WizardStep>('select')
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [decisions, setDecisions] = useState<Record<number, ItemDecisionState>>({})
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null)
  const [result, setResult] = useState<ImportCommitResult | null>(null)
  const [erroredCount, setErroredCount] = useState(0)

  const previewMutation = useImportPreview()
  const commitMutation = useImportCommit()

  // 반입 완료(result) 상태에서 지나온 단계를 클릭하면 결과가 버려지는 파괴적 복귀 — 확인 후 재시작.
  const [confirmRestart, setConfirmRestart] = useState(false)

  // 공용 Stepper 헤더 네비게이션(설계 §5.9, F36-⑪) — 'done' 단계만 클릭 가능.
  function handleStepNavigate(target: WizardStep) {
    if (step === 'result') {
      // result에서 뒤로 = 반입 결과 폐기 → 확인 후 처음부터.
      setConfirmRestart(true)
      return
    }
    if (target === 'select') setStep('select')
  }

  function resetWizard() {
    setStep('select')
    setEntryMode('json')
    setJsonFile(null)
    setSourceFile(null)
    setPreview(null)
    setDecisions({})
    setResult(null)
    setErroredCount(0)
  }

  function applyPreview(data: ImportPreviewResponse) {
    setPreview(data)
    setDecisions(buildInitialDecisions(data.items))
    setStep('preview')
  }

  function handlePreviewSubmit() {
    if (!jsonFile) return
    setExpiredNotice(null)
    previewMutation.mutate(
      { jsonFile, sourceFile },
      { onSuccess: applyPreview },
    )
  }

  function updateDecision(index: number, patch: Partial<ItemDecisionState>) {
    setDecisions((prev) => ({
      ...prev,
      [index]: { ...prev[index], ...patch },
    }))
  }

  function skipAll() {
    setDecisions((prev) => {
      const next: Record<number, ItemDecisionState> = {}
      for (const [key, state] of Object.entries(prev)) {
        next[Number(key)] = { ...state, action: 'skip' }
      }
      return next
    })
  }

  function handleCommit() {
    if (!preview) return
    const decisionList: ImportDecision[] = Object.entries(decisions).map(([idxStr, state]) => {
      const index = Number(idxStr)
      if (state.action === 'skip') {
        return { index, action: 'skip' }
      }
      const item = preview.items.find((i) => i.index === index)
      const decision: ImportDecision = {
        index,
        action: state.action,
        approve_categories: state.approvedCategoryIds,
        approve_relations: state.approvedRelationIds,
      }
      if (state.action === 'merge' && item?.duplicate_of) {
        decision.merge_into = item.duplicate_of.id
      }
      return decision
    })

    commitMutation.mutate(
      { preview_id: preview.preview_id, decisions: decisionList },
      {
        onSuccess: (data) => {
          setResult(data)
          // 오류로 자동 제외된 항목 수는 commit 응답에 없어 preview 요약에서 채출
          setErroredCount(preview.summary.error)
          setStep('result')
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) {
            setExpiredNotice('미리보기가 만료되었습니다 (1시간). 파일을 다시 선택해 반입을 시작하세요.')
            setStep('select')
            setPreview(null)
            setDecisions({})
          }
        },
      },
    )
  }

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-1 text-xl font-semibold text-primary">반입</h1>
      <p className="mb-4 text-sm text-muted">
        Claude Code로 변환한 기출 JSON을 미리보고 검증한 뒤 DB에 적재합니다.
      </p>

      <div className="mb-5">
        <StepIndicator step={step} onNavigate={handleStepNavigate} />
      </div>

      {confirmRestart && (
        <ConfirmDialog
          title="반입 다시 시작"
          message="이미 반입이 완료되었습니다. 처음부터 다시 시작할까요? (완료 요약은 사라집니다)"
          confirmLabel="처음부터"
          onClose={() => setConfirmRestart(false)}
          onConfirm={() => {
            setConfirmRestart(false)
            resetWizard()
          }}
        />
      )}

      {expiredNotice && (
        <div className="mb-4 rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
          {expiredNotice}
        </div>
      )}

      {step === 'select' && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEntryMode('json')}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                entryMode === 'json' ? 'bg-accent text-on-accent' : 'bg-surface text-muted hover:bg-bg'
              }`}
            >
              반입 JSON 파일 선택
            </button>
            <button
              type="button"
              onClick={() => setEntryMode('convert')}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                entryMode === 'convert' ? 'bg-accent text-on-accent' : 'bg-surface text-muted hover:bg-bg'
              }`}
            >
              원본 파일로 시작 (자동 변환)
            </button>
            <button
              type="button"
              onClick={() => setEntryMode('url')}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                entryMode === 'url' ? 'bg-accent text-on-accent' : 'bg-surface text-muted hover:bg-bg'
              }`}
            >
              URL로 시작
            </button>
            <button
              type="button"
              onClick={() => setEntryMode('fetch')}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                entryMode === 'fetch' ? 'bg-accent text-on-accent' : 'bg-surface text-muted hover:bg-bg'
              }`}
            >
              사이트에서 가져오기
            </button>
          </div>

          {entryMode === 'json' && (
            <SelectStep
              jsonFile={jsonFile}
              sourceFile={sourceFile}
              onJsonFileChange={setJsonFile}
              onSourceFileChange={setSourceFile}
              onSubmit={handlePreviewSubmit}
              submitting={previewMutation.isPending}
              errorMessage={previewMutation.isError ? errMsg(previewMutation.error, '미리보기에 실패했습니다.') : null}
            />
          )}
          {(entryMode === 'convert' || entryMode === 'url') && (
            <ConvertStep
              sourceKind={entryMode === 'url' ? 'url' : 'file'}
              onPreviewReady={applyPreview}
              onFallbackToManual={() => setEntryMode('json')}
            />
          )}
          {entryMode === 'fetch' && (
            <FetchImportWizard onPreviewReady={applyPreview} onFallbackToUrl={() => setEntryMode('url')} />
          )}
        </>
      )}

      {step === 'preview' && preview && (
        <PreviewStep
          preview={preview}
          decisions={decisions}
          onUpdateDecision={updateDecision}
          onSkipAll={skipAll}
          onBack={() => setStep('select')}
          onCommit={handleCommit}
          committing={commitMutation.isPending}
          commitError={
            commitMutation.isError && !(commitMutation.error instanceof ApiError && commitMutation.error.status === 409)
              ? errMsg(commitMutation.error, '반입 실행에 실패했습니다.')
              : null
          }
        />
      )}

      {step === 'result' && result && (
        <ResultStep result={result} erroredCount={erroredCount} onRestart={resetWizard} />
      )}
    </div>
  )
}

const STEP_ORDER: WizardStep[] = ['select', 'preview', 'result']
const STEP_LABELS: Record<WizardStep, string> = {
  select: '파일 선택',
  preview: '미리보기',
  result: '결과',
}

function StepIndicator({ step, onNavigate }: { step: WizardStep; onNavigate: (target: WizardStep) => void }) {
  const currentIndex = STEP_ORDER.indexOf(step)
  const steps: StepperStep[] = STEP_ORDER.map((key, i) => ({
    key,
    label: STEP_LABELS[key],
    status: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
  }))
  return <Stepper steps={steps} onStepClick={(i) => onNavigate(STEP_ORDER[i])} />
}

interface ConvertStepProps {
  sourceKind: 'file' | 'url'
  onPreviewReady: (data: ImportPreviewResponse) => void
  onFallbackToManual: () => void
}

// 설계 §4.10·§4.11, §5.9(S6·S8) — "원본 파일로 시작" / "URL로 시작"(F35 1단계). 서버 변환 잡을
// 시작하고 폴링, 완료 시 곧장 반입 미리보기 단계로 넘어간다. jobId는 localStorage에 영속해
// 새로고침 후에도 폴링이 이어진다(§4.11 진행 가시화). 실패 시 error_info를 사람이 읽는 안내로
// 렌더하고, fallback_available이면 [API로 재시도]로 engine:'api' 재요청한다. 그래도 안 되면
// 수동 반입(JSON 선택)으로 폴백한다.
function ConvertStep({ sourceKind, onPreviewReady, onFallbackToManual }: ConvertStepProps) {
  const initialStored = getStoredConvertJob()
  const resumed = initialStored && initialStored.sourceKind === sourceKind ? initialStored : null

  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState(resumed?.url ?? '')
  const [jobId, setJobId] = useState<string | null>(resumed?.jobId ?? null)
  const [resumedFileName] = useState<string | null>(resumed?.fileName ?? null)

  const startConvert = useStartConvert()
  const jobQuery = useConvertJob(jobId)
  const previewFetch = useConvertedPreview(
    jobQuery.data?.status === 'done' ? (jobQuery.data.result_preview_id ?? null) : null,
  )

  useEffect(() => {
    if (previewFetch.data) {
      clearStoredConvertJob()
      onPreviewReady(previewFetch.data)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFetch.data])

  // 잡 소실이 확인되면 저장된 기록을 즉시 정리한다(사이트 반입 위저드와 동일 규약) —
  // 안내는 이번 방문에 보이되 다시 열 때마다 반복되지 않게.
  useEffect(() => {
    if (jobId != null && isJobLost(jobQuery)) clearStoredConvertJob()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobQuery.isError])

  function startJob(engine?: 'api') {
    if (sourceKind === 'file') {
      if (!file) return
      startConvert.mutate(
        { kind: 'file', file, engine },
        {
          onSuccess: (data) => {
            setJobId(data.job_id)
            setStoredConvertJob({ jobId: data.job_id, sourceKind: 'file', fileName: file.name })
          },
        },
      )
    } else {
      if (!url.trim()) return
      startConvert.mutate(
        { kind: 'url', url: url.trim(), engine },
        {
          onSuccess: (data) => {
            setJobId(data.job_id)
            setStoredConvertJob({ jobId: data.job_id, sourceKind: 'url', url: url.trim() })
          },
        },
      )
    }
  }

  function handleReset() {
    clearStoredConvertJob()
    setFile(null)
    setUrl('')
    setJobId(null)
  }

  // 잡 소실(404 — 서버 재시작·TTL 1시간 만료)이면 진행 표시를 멈춘다(사이트 반입 위저드와 동일 규약).
  const unavailable = jobId != null ? jobUnavailable(jobQuery) : null
  const running = jobId != null && unavailable == null && (jobQuery.data == null || jobQuery.data.status === 'running')
  const jobFailed = jobQuery.data?.status === 'error'
  const done = jobQuery.data?.status === 'done'
  const previewFetchFailed = done && (previewFetch.isError || !jobQuery.data?.result_preview_id)
  // preview_id가 TTL(1시간)로 만료되면 GET /import/preview/{id}가 404(NOT_FOUND)를 반환한다(§4.3).
  const previewExpired = previewFetch.isError && previewFetch.error instanceof ApiError && previewFetch.error.status === 404

  // URL 소스는 새로고침 후에도 url 문자열이 남아 재시도 가능. 파일 소스는 File 객체를 되살릴 수
  // 없어 새로고침 후 재시도하려면 파일을 다시 선택해야 한다.
  const canStart = sourceKind === 'url' ? url.trim().length > 0 : file != null
  const needsReselect = sourceKind === 'file' && jobFailed && !file
  // 시작 요청 자체가 409(한도 기억 사전 차단)로 거부된 경우 — LlmErrorInfoView로 구조화 렌더.
  const startErrorInfo = startConvert.isError ? extractLlmErrorInfo(startConvert.error) : null

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <LlmLimitBanner />

      <p className="text-sm text-muted">
        {sourceKind === 'file'
          ? 'PDF·이미지 등 기출 원본 파일을 올리면 LLM이 반입 JSON으로 변환한 뒤 곧바로 미리보기 단계로 이어집니다.'
          : '공개 기출 자료 URL을 입력하면 서버가 다운로드부터 변환까지 처리합니다 (사설·로컬 네트워크 주소는 거부됩니다).'}
      </p>

      {sourceKind === 'file' ? (
        <label className="flex flex-col gap-1 text-sm">
          원본 파일
          <input
            type="file"
            disabled={jobId != null}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary disabled:opacity-50"
          />
          {file && <span className="text-xs text-muted">선택됨: {file.name}</span>}
          {!file && resumedFileName && (
            <span className="text-xs text-warning">
              새로고침 전 "{resumedFileName}"을(를) 올렸습니다. 재시도하려면 파일을 다시 선택하세요
              (진행 확인은 그대로 이어집니다).
            </span>
          )}
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          자료 URL
          <input
            type="url"
            disabled={jobId != null}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/2023-기출.pdf"
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary disabled:opacity-50"
          />
        </label>
      )}

      {startConvert.isError &&
        (startErrorInfo ? (
          <LlmErrorInfoView
            errorInfo={startErrorInfo}
            onRetryWithApi={canStart ? () => startJob('api') : undefined}
            retrying={startConvert.isPending}
          />
        ) : (
          <p className="text-sm text-wrong">{errMsg(startConvert.error, '변환 시작에 실패했습니다.')}</p>
        ))}

      {running && <LlmJobProgress progress={jobQuery.data?.progress} includeDownloading={sourceKind === 'url'} />}

      {unavailable && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning bg-accent-soft p-3 text-sm text-primary">
          <p className="font-medium">
            {unavailable === 'lost' ? '진행 상황을 더 이상 확인할 수 없습니다' : '서버에 연결하지 못했습니다'}
          </p>
          <p className="text-xs text-muted">
            {unavailable === 'lost'
              ? '서버가 다시 시작되었거나 작업 정보가 만료되어(1시간) 이 변환 작업의 진행 상황이 사라졌습니다. 변환이 끝나기 전이었다면 반입되지 않았으니 다시 시도해 주세요.'
              : '서버가 꺼져 있거나 다시 시작하는 중일 수 있습니다. 서버를 켠 뒤 [다시 확인]을 눌러 보세요 — 작업이 아직 살아 있으면 이어서 표시됩니다.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {unavailable === 'unreachable' && (
              <button
                type="button"
                onClick={() => jobQuery.refetch()}
                className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
              >
                다시 확인
              </button>
            )}
            <button
              type="button"
              onClick={handleReset}
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
            errorInfo={jobQuery.data?.error_info}
            legacyError={jobQuery.data?.error}
            onRetryWithApi={canStart ? () => startJob('api') : undefined}
            retrying={startConvert.isPending}
          />
          {needsReselect && (
            <p className="text-xs text-warning">
              새로고침으로 파일 정보가 사라졌습니다. 파일을 다시 선택한 뒤 재시도하세요.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              handleReset()
              onFallbackToManual()
            }}
            className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
          >
            대신 JSON 파일 직접 선택하기
          </button>
        </div>
      )}

      {previewFetchFailed && (
        <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
          {previewExpired ? (
            <p>미리보기가 만료되었습니다 (1시간 TTL). 다시 시작하세요.</p>
          ) : (
            <p>
              변환은 완료됐지만 미리보기를 자동으로 불러오지 못했습니다
              {jobQuery.data?.result_preview_id ? ` (preview_id: ${jobQuery.data.result_preview_id})` : ''}. 반입
              JSON 파일이 있다면 직접 선택해 반입하세요.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              handleReset()
              if (!previewExpired) onFallbackToManual()
            }}
            className="mt-2 rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
          >
            {previewExpired ? '다시 시작' : 'JSON 파일 직접 선택하기'}
          </button>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canStart || jobId != null || startConvert.isPending}
          onClick={() => startJob()}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {startConvert.isPending ? '시작 중…' : '변환 시작'}
        </button>
      </div>
    </div>
  )
}

interface SelectStepProps {
  jsonFile: File | null
  sourceFile: File | null
  onJsonFileChange: (f: File | null) => void
  onSourceFileChange: (f: File | null) => void
  onSubmit: () => void
  submitting: boolean
  errorMessage: string | null
}

function SelectStep({
  jsonFile,
  sourceFile,
  onJsonFileChange,
  onSourceFileChange,
  onSubmit,
  submitting,
  errorMessage,
}: SelectStepProps) {
  function handleJson(e: ChangeEvent<HTMLInputElement>) {
    onJsonFileChange(e.target.files?.[0] ?? null)
  }
  function handleSource(e: ChangeEvent<HTMLInputElement>) {
    onSourceFileChange(e.target.files?.[0] ?? null)
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <label className="flex flex-col gap-1 text-sm">
        반입 JSON 파일 (필수)
        <input
          type="file"
          accept="application/json,.json"
          onChange={handleJson}
          className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
        />
        {jsonFile && <span className="text-xs text-muted">선택됨: {jsonFile.name}</span>}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        원본 파일 (선택 — 반입 시 sources/에 함께 보관)
        <input
          type="file"
          onChange={handleSource}
          className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
        />
        {sourceFile && <span className="text-xs text-muted">선택됨: {sourceFile.name}</span>}
      </label>

      {errorMessage && <p className="text-sm text-wrong">{errorMessage}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!jsonFile || submitting}
          onClick={onSubmit}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? '미리보기 생성 중…' : '다음: 미리보기'}
        </button>
      </div>
    </div>
  )
}

interface PreviewStepProps {
  preview: ImportPreviewResponse
  decisions: Record<number, ItemDecisionState>
  onUpdateDecision: (index: number, patch: Partial<ItemDecisionState>) => void
  onSkipAll: () => void
  onBack: () => void
  onCommit: () => void
  committing: boolean
  commitError: string | null
}

function PreviewStep({
  preview,
  decisions,
  onUpdateDecision,
  onSkipAll,
  onBack,
  onCommit,
  committing,
  commitError,
}: PreviewStepProps) {
  const { summary, source, items } = preview

  return (
    <div className="flex flex-col gap-4">
      {source.duplicate_source && (
        <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
          같은 원본이 이미 반입된 적 있습니다 ("{source.filename}"). 내용이 중복 의심으로 잡힐 수 있습니다.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
        <div className="flex flex-wrap gap-3">
          <span className="text-primary">전체 {summary.total}</span>
          <span className="text-correct">정상 {summary.ok}</span>
          <span className="text-warning">중복 의심 {summary.duplicate_suspect}</span>
          <span className="text-wrong">오류 {summary.error}</span>
        </div>
        <button
          type="button"
          onClick={onSkipAll}
          className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
        >
          전체 건너뛰기
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <ItemRow
            key={item.index}
            item={item}
            state={decisions[item.index]}
            onUpdateDecision={onUpdateDecision}
          />
        ))}
      </div>

      {commitError && <p className="text-sm text-wrong">{commitError}</p>}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
        >
          ← 뒤로
        </button>
        <button
          type="button"
          disabled={committing}
          onClick={onCommit}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {committing ? '반입 실행 중…' : '반입 실행'}
        </button>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ImportItem['status'] }) {
  const map: Record<ImportItem['status'], { label: string; className: string }> = {
    ok: { label: '정상', className: 'bg-correct text-on-accent' },
    duplicate_suspect: { label: '중복 의심', className: 'bg-warning text-on-accent' },
    error: { label: '오류', className: 'bg-wrong text-on-accent' },
  }
  const conf = map[status]
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${conf.className}`}>{conf.label}</span>
}

interface ItemRowProps {
  item: ImportItem
  state: ItemDecisionState | undefined
  onUpdateDecision: (index: number, patch: Partial<ItemDecisionState>) => void
}

function ItemRow({ item, state, onUpdateDecision }: ItemRowProps) {
  const isSkipped = state?.action === 'skip'

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={item.status} />
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
          {TYPE_LABEL[item.type] ?? item.type}
        </span>
        <span className="text-sm font-medium text-primary">
          #{item.index} {item.title}
        </span>
      </div>

      {item.status === 'error' && (
        <ul className="ml-1 list-disc pl-4 text-sm text-wrong">
          {item.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {item.status !== 'error' && state && (
        <div className="flex flex-col gap-3">
          {item.status === 'duplicate_suspect' && item.duplicate_of && (
            <div className="grid grid-cols-1 gap-2 rounded border border-border bg-bg p-2 text-xs sm:grid-cols-2">
              <div>
                <p className="mb-1 font-semibold text-muted">새 항목</p>
                <p className="text-primary">{item.title}</p>
              </div>
              <div>
                <p className="mb-1 font-semibold text-muted">기존 문서 ({item.duplicate_of.doc_no})</p>
                <p className="text-primary">{item.duplicate_of.title}</p>
              </div>
            </div>
          )}

          {item.status === 'duplicate_suspect' ? (
            <div className="flex flex-wrap gap-3 text-sm text-primary">
              {(['skip', 'new', 'merge'] as ImportAction[]).map((action) => (
                <label key={action} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`action-${item.index}`}
                    checked={state.action === action}
                    onChange={() => onUpdateDecision(item.index, { action })}
                  />
                  {action === 'skip' ? '건너뛰기' : action === 'new' ? '새로 추가' : '기존에 병합'}
                </label>
              ))}
            </div>
          ) : (
            <label className="flex items-center gap-1 text-sm text-primary">
              <input
                type="checkbox"
                checked={isSkipped}
                onChange={(e) => onUpdateDecision(item.index, { action: e.target.checked ? 'skip' : 'new' })}
              />
              이 항목 건너뛰기
            </label>
          )}

          {item.suggest_categories.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">분류 제안</p>
              <div className="flex flex-wrap gap-2">
                {item.suggest_categories.map((sc) => {
                  const key = categoryApprovalKey(sc)
                  const checked = state.approvedCategoryIds.includes(key)
                  return (
                    <label
                      key={sc.path}
                      className={`flex items-center gap-1 rounded border border-border px-2 py-1 text-xs ${
                        isSkipped ? 'opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isSkipped}
                        checked={checked}
                        onChange={() =>
                          onUpdateDecision(item.index, {
                            approvedCategoryIds: toggleValue(state.approvedCategoryIds, key),
                          })
                        }
                      />
                      {sc.path}
                      {!sc.exists && (
                        <span className="rounded bg-accent-soft px-1 text-accent">생성 제안</span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {item.suggest_relations.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">관계 제안</p>
              <div className="flex flex-wrap gap-2">
                {item.suggest_relations.map((sr) => {
                  const checked = sr.found && sr.document_id != null && state.approvedRelationIds.includes(sr.document_id)
                  return (
                    <label
                      key={sr.doc_no}
                      className={`flex items-center gap-1 rounded border border-border px-2 py-1 text-xs ${
                        isSkipped || !sr.found ? 'opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isSkipped || !sr.found}
                        checked={checked}
                        onChange={() =>
                          sr.found &&
                          sr.document_id != null &&
                          onUpdateDecision(item.index, {
                            approvedRelationIds: toggleValue(state.approvedRelationIds, sr.document_id),
                          })
                        }
                      />
                      {sr.doc_no}
                      {!sr.found && <span className="text-wrong">문서를 찾을 수 없음</span>}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultStep({
  result,
  erroredCount,
  onRestart,
}: {
  result: ImportCommitResult
  erroredCount: number
  onRestart: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="생성" value={result.created} />
        <SummaryTile label="병합" value={result.merged} />
        <SummaryTile label="건너뜀" value={result.skipped} />
        <SummaryTile label="오류(제외)" value={erroredCount} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-3">
          <h2 className="mb-1 text-sm font-semibold text-primary">생성된 분류</h2>
          {result.categories_created.length === 0 ? (
            <p className="text-xs text-muted">없음</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {result.categories_created.map((path) => (
                <li key={path} className="text-xs text-primary">
                  {path}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <h2 className="mb-1 text-sm font-semibold text-primary">생성된 관계</h2>
          <p className="text-xs text-primary">{result.relations_created}건</p>
        </div>
      </div>

      {result.new_documents.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <h2 className="mb-2 text-sm font-semibold text-primary">새로 생성된 문서</h2>
          <ul className="flex flex-col gap-1">
            {result.new_documents.map((doc) => (
              <li key={doc.id}>
                <Link to={`/docs/${doc.id}`} className="text-sm text-accent hover:underline">
                  {doc.doc_no} — {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onRestart}
          className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
        >
          새로 반입하기
        </button>
      </div>
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-center">
      <p className="text-2xl font-semibold text-primary">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}
