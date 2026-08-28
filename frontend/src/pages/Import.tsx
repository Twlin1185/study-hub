import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useImportCommit, useImportPreview } from '../api/import'
import { previewJsonUrl, useConvertedPreview } from '../api/convert'
import { useDismissLlmJob } from '../api/llm'
import { ApiError } from '../api/client'
import { readQueue } from '../utils/convertQueue'
import { useConvertQueue, MAX_QUEUE_BATCH } from '../hooks/useConvertQueue'
import type { ConvertQueue, QueueItem } from '../hooks/useConvertQueue'
import LlmLimitBanner from '../components/LlmLimitBanner'
import EngineSelect from '../components/EngineSelect'
import Stepper from '../components/Stepper'
import ConfirmDialog from '../components/ConfirmDialog'
import FetchImportWizard from '../components/FetchImportWizard'
import AnswerKeyImportWizard from '../components/AnswerKeyImportWizard'
import SplitImportWizard from '../components/SplitImportWizard'
import type { SplitInitialSource } from '../components/SplitImportWizard'
import ImportQueueList, { ImportQueueSummary } from '../components/ImportQueue'
import MarkdownView from '../components/MarkdownView'
import CategoryPathField, { categoryPathError, normalizeCategoryPath } from '../components/CategoryPathField'
import type { StepperStep } from '../components/Stepper'
import type {
  ImportAction,
  ImportCommitResult,
  ImportDecision,
  ImportItem,
  ImportItemOverride,
  ImportItemWarning,
  ImportPreviewResponse,
  LlmEngine,
} from '../api/types'

type WizardStep = 'select' | 'preview' | 'result'
// 'convert' = 원본 파일 업로드 자동 변환(S13: **다중 선택 = 반입 대기열**, F40-②) ·
// 'url' = URL 반입(§4.11 F35 1단계) — 둘 다 StartConvertPanel + 같은 대기열을 공유하고
// sourceKind로 입력 UI만 갈린다. 'fetch' = 사이트에서 가져오기(§5.9, S10) — 자체 4단계 서브플로.
// 'answer_key' = 답지·해설지 반입(§4.20 ①, F44, S18) — 반입 preview(§4.3)와 독립된 별도 경로
// (매칭 미리보기·apply 응답 스키마가 다름). 자체 스텝을 갖는 AnswerKeyImportWizard가 전담한다.
// 'split_import'(S23, §4.25, F49) — 대용량 원본 분할 반입 위저드. 상시 메뉴 없음(YAGNI) —
// too_large [분할 반입] 버튼 또는 작업 센터 딥링크(?mode=split_import)로만 진입한다.
type EntryMode = 'json' | 'convert' | 'url' | 'fetch' | 'answer_key' | 'split_import'

interface ItemDecisionState {
  action: ImportAction
  // number = 기존 분류 category_id(exists:true) · string = 생성 승인할 경로(exists:false)
  approvedCategoryIds: (number | string)[]
  approvedRelationIds: number[]
  // stage-42(B3, §4.3) — 검토 단계 편집분. 값을 가진 필드만 채워진다(전체 undefined = 미편집).
  override?: ImportItemOverride
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

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

// stage-42(B3, §4.3) — choices는 문자열 배열 또는 객체 배열(text/content/label 중 하나) 둘 다
// 올 수 있어 방어적으로 해석한다. 알 수 없는 형태는 JSON 문자열로 표시(조용한 누락 금지).
function choiceLabel(choice: unknown): string {
  if (typeof choice === 'string') return choice
  if (choice && typeof choice === 'object') {
    const obj = choice as Record<string, unknown>
    const val = obj.text ?? obj.content ?? obj.label
    if (typeof val === 'string') return val
  }
  try {
    return JSON.stringify(choice)
  } catch {
    return String(choice)
  }
}

// 분류 제안 승인 식별키 — 기존 분류면 category_id, 생성 제안이면 path 문자열
function categoryApprovalKey(sc: { category_id: number | null; path: string }): number | string {
  return sc.category_id ?? sc.path
}

// S15(설계 §4.17⑤·⑥) — solved_answer(정답을 LLM이 풀어 채움)·fabrication_suspect(원문 대조
// 실패)는 기본 반입 제외(체크 해제) 대상. match_unavailable(대조 불가)은 배지·안내만이고 기본
// 포함을 유지한다(이미지 PDF 경로 전체가 막히지 않게).
function hasExclusionWarning(warnings: ImportItemWarning[] | undefined): boolean {
  return warnings?.some((w) => w === 'solved_answer' || w === 'fabrication_suspect') ?? false
}

function buildInitialDecisions(items: ImportItem[]): Record<number, ItemDecisionState> {
  const initial: Record<number, ItemDecisionState> = {}
  for (const item of items) {
    if (item.status === 'error') continue
    initial[item.index] = {
      action: item.status === 'duplicate_suspect' || hasExclusionWarning(item.warnings) ? 'skip' : 'new',
      // 분류 제안은 기존/생성 제안 모두 기본 체크 — 단, 컨테이너(자식이 있는 중간 노드) 제안은
      // stage-42(B4-S8) 기본 미체크(하위 분류에 연결하는 편이 나아 강제하지 않되 유도).
      approvedCategoryIds: item.suggest_categories
        .filter((sc) => !sc.container)
        .map(categoryApprovalKey),
      approvedRelationIds: item.suggest_relations
        .filter((r) => r.found && r.document_id != null)
        .map((r) => r.document_id as number),
    }
  }
  return initial
}

// 새로고침해도 진행 중인 잡의 폴링이 이어지도록, 마운트 시 대기열에 남은 항목이 있으면 해당
// 진입 모드로 초기화한다(설계 §4.11 진행 가시화 · §5.9 F40-② 복원 요구).
function initialEntryMode(): EntryMode {
  const entries = readQueue().filter((e) => !e.committed)
  if (entries.length === 0) return 'json'
  const fetchOnly = entries.every((e) => e.sourceKind === 'fetch')
  if (fetchOnly) return 'fetch'
  const last = [...entries].reverse().find((e) => e.sourceKind !== 'fetch')
  return last?.sourceKind === 'url' ? 'url' : 'convert'
}

export default function ImportPage() {
  const queue = useConvertQueue()
  // S22(설계 §4.24 ⓓ, F48) — 작업 센터 [화면으로 이동]이 `?mode=answer_key`로 답지 위저드를
  // 곧바로 연다(대기열 복원보다 우선 — 명시적으로 그 화면을 지목한 진입이므로).
  const [searchParams] = useSearchParams()
  const [entryMode, setEntryMode] = useState<EntryMode>(() => {
    const mode = searchParams.get('mode')
    if (mode === 'answer_key') return 'answer_key'
    if (mode === 'split_import') return 'split_import'
    return initialEntryMode()
  })
  // 검토 반영 — 이미 이 라우트에 있는 상태에서 딥링크(쿼리 파라미터)만 바뀌는 경우(useState
  // 초기값은 마운트 시 1회만 읽힌다) 대응. 파라미터가 실제로 'answer_key'|'split_import'로
  // 바뀔 때만 반응하고, 그 외에는 사용자가 수동으로 고른 진입 모드를 그대로 둔다.
  const modeParam = searchParams.get('mode')
  // S23(§4.25 — 작업 센터 딥링크) split_id가 있으면 위저드가 GET으로 그 분할안을 이어 받는다.
  const splitIdParam = searchParams.get('split_id')
  useEffect(() => {
    if (modeParam === 'answer_key') setEntryMode('answer_key')
    if (modeParam === 'split_import') setEntryMode('split_import')
  }, [modeParam])
  // too_large [분할 반입] 버튼이 곧장 넘겨준 원본(§4.25 진입점) — 딥링크(split_id)로 들어온
  // 경우는 원본이 필요 없다(위저드가 GET으로 기존 분할안을 이어 받는다).
  const [splitInitialSource, setSplitInitialSource] = useState<SplitInitialSource | null>(null)
  // 재진입 앵커(사용자 실사용 피드백 반영, §4.25) — [분할안 열기]로 이미 시작된 분할을 이어서
  // 열 때 쓰는 split_id(딥링크 splitIdParam과 별개 — 큐 항목 클릭이 출처). 두 경로 다 있으면
  // 큐 항목 클릭이 이번 세션에서 더 구체적인 의도이므로 우선한다.
  const [splitResumeId, setSplitResumeId] = useState<string | null>(null)
  // 위 splitResumeId·splitIdParam으로 위저드를 연 출발점이 된 큐 항목(too_large 실패 항목,
  // 'split_in_progress') — split_id 확보(onSplitStarted)·enqueue 완료(제거)·만료 복귀
  // (onSplitExpired)가 전부 이 id를 갱신 대상으로 삼는다.
  const [splitAnchorEntryId, setSplitAnchorEntryId] = useState<string | null>(null)
  const [splitExpiredNotice, setSplitExpiredNotice] = useState<string | null>(null)
  // stage-42(B2-2, §4.25 ②) — 원 항목의 categoryPath를 위저드의 공통 경로 초기값으로 넘긴다.
  const [splitInitialCommonPath, setSplitInitialCommonPath] = useState<string | null>(null)
  // stage-42(B2-1, §4.24) — [분할 반입] 시작(split_id 확보) 직후 원 실패 잡을 정리한다(결정 ①).
  const dismissJobMutation = useDismissLlmJob()

  // 작업 센터 딥링크(?split_id=)로 들어온 경우도 큐에 같은 split_id를 든 항목이 있으면 앵커로
  // 잡는다(엔트리를 몰라도 재진입 경로가 일관되게 동작 — enqueue 시 제거·만료 시 복귀).
  useEffect(() => {
    if (!splitIdParam || splitAnchorEntryId) return
    const match = queue.items.find((it) => it.entry.splitId === splitIdParam)
    if (match) setSplitAnchorEntryId(match.entry.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitIdParam, queue.items])
  const [step, setStep] = useState<WizardStep>('select')
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  // 미리보기가 변환 잡(대기열·사이트 반입)에서 왔는가 — 디스크 보존본이 있는 경우에만
  // [변환 JSON 내려받기]가 의미를 갖는다(직접 올린 JSON은 서버가 보존하지 않는다, §4.3).
  const [previewFromJob, setPreviewFromJob] = useState(false)
  const [decisions, setDecisions] = useState<Record<number, ItemDecisionState>>({})
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null)
  const [result, setResult] = useState<ImportCommitResult | null>(null)
  const [erroredCount, setErroredCount] = useState(0)

  // 대기열 항목 [검토] — preview_id로 미리보기를 열어 기존 ②단계에 그대로 합류시킨다.
  const [reviewEntryId, setReviewEntryId] = useState<string | null>(null)
  const [reviewPreviewId, setReviewPreviewId] = useState<string | null>(null)
  const awaitingReview = useRef(false)
  const reviewQuery = useConvertedPreview(reviewPreviewId)
  // [검토] 시점에 잡아 둔 큐 항목의 notes — reviewQuery.data가 도착하는 useEffect에서 그대로
  // applyPreview로 넘긴다(§4.13 — notes는 GET /api/convert/{job_id} 응답 소관이라 preview
  // 응답에는 없다).
  const pendingReviewNotes = useRef<string[]>([])
  // 미리보기와 함께 표시할 잡 성공 소표기(S14, §4.13 notes) — 서버 문구를 그대로 보관.
  const [previewNotes, setPreviewNotes] = useState<string[]>([])

  const previewMutation = useImportPreview()
  const commitMutation = useImportCommit()

  // 반입 완료(result) 상태에서 지나온 단계를 클릭하면 결과가 버려지는 파괴적 복귀 — 확인 후 재시작.
  const [confirmRestart, setConfirmRestart] = useState(false)

  useEffect(() => {
    // ①단계에서 [검토]를 눌러 기다리는 중일 때만 미리보기로 넘어간다 — 결과 화면에서 백그라운드
    // 재조회가 일어나도 화면이 제멋대로 되돌아가지 않게 하는 가드.
    if (reviewQuery.data && awaitingReview.current && step === 'select') {
      awaitingReview.current = false
      applyPreview(reviewQuery.data, true, pendingReviewNotes.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewQuery.data])

  // 공용 Stepper 헤더 네비게이션(설계 §5.9, F36-⑪) — 'done' 단계만 클릭 가능.
  function handleStepNavigate(target: WizardStep) {
    if (step === 'result') {
      // result에서 뒤로 = 반입 결과 폐기 → 확인 후 처음부터.
      setConfirmRestart(true)
      return
    }
    if (target === 'select') backToSelect()
  }

  function backToSelect() {
    setStep('select')
    setPreview(null)
    setDecisions({})
    setPreviewFromJob(false)
    setPreviewNotes([])
    awaitingReview.current = false
    setReviewPreviewId(null)
    setReviewEntryId(null)
  }

  function resetWizard() {
    backToSelect()
    setEntryMode('json')
    setJsonFile(null)
    setSourceFile(null)
    setResult(null)
    setErroredCount(0)
  }

  // 대기열로 돌아가기 — 다음 항목을 이어서 검토한다(§5.9 F40-②).
  function backToQueue() {
    backToSelect()
    setResult(null)
    setErroredCount(0)
    setEntryMode((mode) => (mode === 'convert' || mode === 'url' ? mode : 'convert'))
  }

  function applyPreview(data: ImportPreviewResponse, fromJob = false, notes: string[] = []) {
    setPreview(data)
    setPreviewFromJob(fromJob)
    setPreviewNotes(notes)
    setDecisions(buildInitialDecisions(data.items))
    setExpiredNotice(null)
    setStep('preview')
  }

  function handleReview(item: QueueItem) {
    if (!item.previewId) return
    awaitingReview.current = true
    pendingReviewNotes.current = item.notes
    setReviewEntryId(item.entry.id)
    setReviewPreviewId(item.previewId)
    // 같은 preview를 다시 여는 경우 캐시된 응답이 즉시 반환된다(refetch는 백그라운드).
    if (reviewPreviewId === item.previewId && reviewQuery.data) {
      awaitingReview.current = false
      applyPreview(reviewQuery.data, true, item.notes)
    }
  }

  // too_large [분할 반입](§4.25 진입점, ㉳) — url 소스는 항상 재제출 가능(문자열 보존), file
  // 소스는 이번 세션에 File이 남아 있을 때만(retryable과 동일 근거). 둘 다 없으면 위저드
  // 자체의 'source' 단계(직접 재선택)로 열어 진입 자체는 항상 성공하게 한다.
  //
  // 재진입 앵커(사용자 실사용 피드백 반영) — 이 항목이 이미 split_id를 갖고 있으면('분할 진행
  // 중', [분할안 열기]로 눌린 경우) 원본을 다시 묻지 않고 그 split_id로 곧장 이어서 연다.
  function handleSplitImport(item: QueueItem) {
    setSplitAnchorEntryId(item.entry.id)
    setSplitExpiredNotice(null)
    setSplitInitialCommonPath(item.entry.categoryPath ?? null)
    if (item.entry.splitId) {
      setSplitInitialSource(null)
      setSplitResumeId(item.entry.splitId)
    } else {
      if (item.entry.sourceKind === 'url' && item.entry.url) {
        setSplitInitialSource({ kind: 'url', url: item.entry.url })
      } else {
        const file = queue.getFile(item.entry.id)
        setSplitInitialSource(file ? { kind: 'file', file } : null)
      }
      setSplitResumeId(null)
    }
    setEntryMode('split_import')
  }

  function handlePreviewSubmit() {
    if (!jsonFile) return
    setExpiredNotice(null)
    previewMutation.mutate({ jsonFile, sourceFile }, { onSuccess: (data) => applyPreview(data, false) })
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
      // stage-42(B3, §4.3) — 편집한 항목만 override를 실어 보낸다.
      if (state.override) decision.override = state.override
      return decision
    })

    commitMutation.mutate(
      { preview_id: preview.preview_id, decisions: decisionList },
      {
        onSuccess: (data) => {
          setResult(data)
          // 오류로 자동 제외된 항목 수는 commit 응답에 없어 preview 요약에서 채출
          setErroredCount(preview.summary.error)
          if (reviewEntryId) queue.markCommitted(reviewEntryId)
          setStep('result')
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) {
            // S13(F40-①): 서버가 디스크 복구를 먼저 시도하므로 409는 "복구도 실패" 또는
            // "이미 반입 완료"일 때만 도달한다 — 서버 메시지를 그대로 보여 준다.
            setExpiredNotice(errMsg(e, '미리보기가 만료되었습니다. 다시 시작하세요.'))
            backToSelect()
          }
        },
      },
    )
  }

  const reviewError =
    reviewQuery.isError && reviewEntryId
      ? errMsg(reviewQuery.error, '미리보기를 불러오지 못했습니다. 변환 JSON을 내려받아 직접 반입해 보세요.')
      : null

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

      {/* 재진입 앵커 만료 안내(사용자 실사용 피드백 반영, §4.25) */}
      {splitExpiredNotice && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
          <span>{splitExpiredNotice}</span>
          <button
            type="button"
            onClick={() => setSplitExpiredNotice(null)}
            className="shrink-0 text-xs text-muted hover:text-primary"
          >
            닫기
          </button>
        </div>
      )}

      {step === 'select' && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <ModeTab active={entryMode === 'json'} onClick={() => setEntryMode('json')}>
              반입 JSON 파일 선택
            </ModeTab>
            <ModeTab active={entryMode === 'convert'} onClick={() => setEntryMode('convert')}>
              원본 파일로 시작 (자동 변환)
            </ModeTab>
            <ModeTab active={entryMode === 'url'} onClick={() => setEntryMode('url')}>
              URL로 시작
            </ModeTab>
            <ModeTab active={entryMode === 'fetch'} onClick={() => setEntryMode('fetch')}>
              사이트에서 가져오기
            </ModeTab>
            <ModeTab active={entryMode === 'answer_key'} onClick={() => setEntryMode('answer_key')}>
              답지·해설지 반입
            </ModeTab>
          </div>

          {/* 다른 탭에 있어도 대기열이 살아 있음을 잊지 않게 한다(§5.9 접힌 요약) */}
          {(entryMode === 'json' || entryMode === 'fetch') && (
            <div className="mb-3">
              <ImportQueueSummary items={queue.items} onBackToQueue={backToQueue} />
            </div>
          )}

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
            <div className="flex flex-col gap-4">
              <StartConvertPanel sourceKind={entryMode === 'url' ? 'url' : 'file'} queue={queue} />
              <ImportQueueList
                items={queue.items}
                starting={queue.starting}
                reviewingEntryId={reviewEntryId}
                reviewError={reviewError}
                onReview={handleReview}
                onRemove={queue.removeEntry}
                // S15(설계 §4.17③) — engineId는 LlmErrorInfoView가 fallback_engine(없으면
                // legacy 'api')에서 구해 넘겨준다. retryEntry의 기본값 'api'는 engineId 자체가
                // undefined일 때(레거시 경로에서 호출)만 쓰인다.
                onRetryApi={(id, engineId) => queue.retryEntry(id, engineId as LlmEngine | undefined)}
                onSplitReupload={() => {
                  // F40-④ — 시작 화면(파일 선택)으로 되돌려 원본을 나눠 다시 올리게 한다.
                  setEntryMode('convert')
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                onSplitImport={handleSplitImport}
                onMergeSplitEntries={queue.mergeSplitEntries}
                onClearFinished={queue.clearFinished}
                onCancel={queue.cancelEntry}
                cancelling={queue.cancelling}
                cancelError={queue.cancelError}
              />
              {queue.items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEntryMode('json')}
                  className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                >
                  대신 JSON 파일 직접 선택하기
                </button>
              )}
            </div>
          )}
          {entryMode === 'fetch' && (
            <FetchImportWizard
              onPreviewReady={(data, notes) => applyPreview(data, true, notes ?? [])}
              onFallbackToUrl={() => setEntryMode('url')}
              onFallbackToFile={() => setEntryMode('convert')}
            />
          )}
          {entryMode === 'answer_key' && (
            <>
              <p className="mb-3 text-sm text-muted">
                이미 반입된 문항 중 정답·해설이 빈 곳을 답지·해설지 파일로 채웁니다 — 기존 값은
                덮어쓰지 않습니다(빈 필드만 병합).
              </p>
              <AnswerKeyImportWizard />
            </>
          )}
          {entryMode === 'split_import' && (
            <SplitImportWizard
              // stage-reviewer 표적 확인([예방 1줄]) — resumeSplitId만 바뀌는 딥링크 재진입에서
              // 위저드 내부 useState 초기값이 갱신되지 않는 사고를 예방하기 위해 split_id별로
              // 강제 리마운트한다.
              key={(splitResumeId ?? splitIdParam) ?? 'new'}
              initialSource={splitInitialSource}
              resumeSplitId={splitResumeId ?? splitIdParam}
              initialCommonPath={splitInitialCommonPath}
              onCancel={() => {
                setSplitInitialSource(null)
                setSplitResumeId(null)
                setSplitAnchorEntryId(null)
                setSplitInitialCommonPath(null)
                setEntryMode('convert')
              }}
              onEnqueued={(jobs, splitId) => {
                // 4단계(조각별 미리보기 승인)는 신규 진행 UI 없이 기존 ImportQueue 화면이
                // 그대로 이어받는다(체크리스트 — 신규 진행 UI 없음). 이 split_id를 가진 재진입
                // 앵커 항목은(재사용으로 앵커가 둘 이상 생겼더라도 전부) 조각들이 이미
                // 합류했으니 큐에서 제거한다(원본이 두 번 남아 혼란스럽다는 피드백 반영 —
                // stage-reviewer 표적 확인 [관찰 (a)] 재수정: entryId 1개가 아니라 split_id
                // 기준 전체 제거).
                queue.addJobs(jobs.map((j) => ({ job_id: j.job_id, label: j.label })), splitId)
                setSplitInitialSource(null)
                setSplitResumeId(null)
                setSplitAnchorEntryId(null)
                setSplitInitialCommonPath(null)
                setEntryMode('convert')
              }}
              onSplitStarted={(splitId) => {
                // 재진입 앵커(사용자 실사용 피드백 반영) — split_id를 확보하면 앵커 항목을
                // "분할 진행 중"으로 전환해, 위저드를 닫거나 다른 화면에 갔다 와도 [분할안
                // 열기]로 이어서 열 수 있게 한다.
                if (splitAnchorEntryId) {
                  queue.setEntrySplitId(splitAnchorEntryId, splitId)
                  // stage-42(B2-1, 결정 ①) — [분할 반입]이 성공적으로 시작됐으니(이 too_large
                  // 실패 항목의) 원 convert 잡을 작업 센터 목록에서 지운다. 실패해도(이미 지워짐
                  // 등) 분할 진행 자체를 막을 이유는 아니므로 콘솔 경고만 남긴다.
                  const anchorJobId = queue.items.find((it) => it.entry.id === splitAnchorEntryId)?.entry.jobId
                  if (anchorJobId) {
                    dismissJobMutation.mutate(anchorJobId, {
                      onError: (e) => console.warn('실패 잡 정리에 실패했습니다(무시):', e),
                    })
                  }
                }
              }}
              onSplitExpired={() => {
                // split이 서버에서 만료(404 — TTL 1h·디스크 최근 20건 초과)됐다 — 앵커를
                // 원래 실패 상태로 되돌려 [분할 반입] 재시도를 다시 열어 준다.
                if (splitAnchorEntryId) queue.setEntrySplitId(splitAnchorEntryId, null)
                setSplitExpiredNotice(
                  '분할 작업 정보를 더 이상 확인할 수 없습니다(만료됨) — [분할 반입]을 다시 눌러 새로 시작해 주세요.',
                )
              }}
            />
          )}
        </>
      )}

      {step === 'preview' && preview && (
        <div className="flex flex-col gap-4">
          <ImportQueueSummary items={queue.items} onBackToQueue={backToQueue} />
          <PreviewStep
            preview={preview}
            notes={previewNotes}
            showJsonDownload={previewFromJob}
            decisions={decisions}
            onUpdateDecision={updateDecision}
            onSkipAll={skipAll}
            onBack={backToSelect}
            onCommit={handleCommit}
            committing={commitMutation.isPending}
            commitError={
              commitMutation.isError && !(commitMutation.error instanceof ApiError && commitMutation.error.status === 409)
                ? errMsg(commitMutation.error, '반입 실행에 실패했습니다.')
                : null
            }
          />
        </div>
      )}

      {step === 'result' && result && (
        <div className="flex flex-col gap-4">
          <ImportQueueSummary items={queue.items} onBackToQueue={backToQueue} />
          <ResultStep
            result={result}
            erroredCount={erroredCount}
            onRestart={resetWizard}
            onBackToQueue={queue.items.length > 0 ? backToQueue : null}
          />
        </div>
      )}
    </div>
  )
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
        active ? 'bg-accent text-on-accent' : 'bg-surface text-muted hover:bg-bg'
      }`}
    >
      {children}
    </button>
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

interface StartConvertPanelProps {
  sourceKind: 'file' | 'url'
  queue: ConvertQueue
}

// 설계 §5.9(S6·S8·S13) — "원본 파일로 시작"(F40-②: **다중 선택 → 대기열**) / "URL로 시작".
// 서버 워커는 동시 1개라 대기열은 큐잉일 뿐 병렬 실행이 아니다. 시작 전 한도 배너(§4.11)를
// 노출하고, 분류 경로(F40-③)는 파일·URL 공통 접이식 패널로 받는다.
function StartConvertPanel({ sourceKind, queue }: StartConvertPanelProps) {
  const [files, setFiles] = useState<File[]>([])
  const [url, setUrl] = useState('')
  const [commonPath, setCommonPath] = useState('')
  // 파일별 마지막 칸(회차 등) — 공통 상위 경로 뒤에 붙는다(§5.9 F40-③).
  const [perFileSuffix, setPerFileSuffix] = useState<Record<string, string>>({})
  const [selectNotice, setSelectNotice] = useState<string | null>(null)
  // S21(설계 §4.23·§5.9 ①) — 시작 화면 engine 선택. 이번 선택분(배치) 전체에 같이 적용된다.
  const [engine, setEngine] = useState<LlmEngine>('auto')
  // S22(설계 §4.24 ④·⑤·§5.9, F48) — 요청 단위 모델 오버라이드. 미선택(null) = 설정값.
  const [model, setModel] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    // 대량 투입으로 LLM 한도를 한 번에 태우는 사고 방지(§5.9 · 리스크 6) — 이미 대기 중인
    // 항목까지 합쳐 10개를 넘지 않게 한다.
    if (picked.length + queue.pendingCount > MAX_QUEUE_BATCH) {
      setSelectNotice(
        queue.pendingCount > 0
          ? `대기 중 ${queue.pendingCount}건이 있어 ${MAX_QUEUE_BATCH - queue.pendingCount}개까지 더 걸 수 있습니다 (선택 ${picked.length}개).`
          : `한 번에 최대 ${MAX_QUEUE_BATCH}개까지 걸 수 있습니다 (선택 ${picked.length}개). 나눠서 올려 주세요.`,
      )
      setFiles([])
      return
    }
    setSelectNotice(null)
    setFiles(picked)
  }

  function pathForFile(name: string): string {
    const suffix = perFileSuffix[name] ?? ''
    return normalizeCategoryPath([commonPath, suffix].filter(Boolean).join('/'))
  }

  const pathError =
    categoryPathError(commonPath) ??
    files.map((f) => categoryPathError(pathForFile(f.name))).find((e) => e != null) ??
    null

  const canStart =
    !queue.starting && pathError == null && (sourceKind === 'url' ? url.trim().length > 0 : files.length > 0)

  async function handleStart() {
    if (!canStart) return
    if (sourceKind === 'url') {
      const value = url.trim()
      setUrl('')
      await queue.startUrl(value, commonPath || null, { engine, model: model ?? undefined })
      return
    }
    const inputs = files.map((file) => ({ file, categoryPath: pathForFile(file.name) || null }))
    setFiles([])
    setPerFileSuffix({})
    if (fileInputRef.current) fileInputRef.current.value = ''
    await queue.startFiles(inputs, { engine, model: model ?? undefined })
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <LlmLimitBanner />

      <p className="text-sm text-muted">
        {sourceKind === 'file'
          ? `PDF·이미지(png/jpg 등)·docx·xlsx·md·txt·html·xml·csv 등 기출 원본 파일을 올리면 LLM이 반입 JSON으로 변환한 뒤 미리보기 단계로 이어집니다. 여러 파일(최대 ${MAX_QUEUE_BATCH}개)을 한 번에 걸어두면 순서대로 변환되고, 끝난 것부터 검토할 수 있습니다.`
          : '공개 기출 자료 URL을 입력하면 서버가 다운로드부터 변환까지 처리합니다 (사설·로컬 네트워크 주소는 거부됩니다).'}
      </p>

      {sourceKind === 'file' ? (
        <label className="flex flex-col gap-1 text-sm text-primary">
          원본 파일 (여러 개 선택 가능)
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.md,.markdown,.txt,.html,.htm,.xhtml,.xml,.csv,.docx,.xlsx"
            onChange={handleFiles}
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
          />
          {files.length > 0 && <span className="text-xs text-muted">선택됨: {files.length}개</span>}
          {selectNotice && <span className="text-xs text-warning">{selectNotice}</span>}
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-primary">
          자료 URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/2023-기출.pdf"
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
          />
        </label>
      )}

      <CategoryPathField value={commonPath} onChange={setCommonPath} sharedNotice={files.length > 1} />

      <div>
        <p className="mb-1 text-xs font-semibold text-muted">사용 엔진</p>
        <EngineSelect value={engine} onChange={setEngine} modelValue={model} onModelChange={setModel} />
      </div>

      {sourceKind === 'file' && files.length > 1 && (
        <div className="flex flex-col gap-2 rounded border border-border bg-bg p-3">
          <p className="text-xs font-semibold text-muted">
            파일별 회차 (선택) — 위에서 정한 상위 경로가 모든 파일에 같이 적용됩니다.
          </p>
          {files.map((file) => (
            <div key={file.name} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <span className="min-w-0 flex-1 break-all text-xs text-primary">{file.name}</span>
              <input
                type="text"
                value={perFileSuffix[file.name] ?? ''}
                onChange={(e) => setPerFileSuffix((prev) => ({ ...prev, [file.name]: e.target.value }))}
                placeholder="2022년 2회"
                className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-primary outline-none focus:border-accent sm:w-40"
              />
              <span className="min-w-0 flex-1 break-all text-[11px] text-muted">
                {pathForFile(file.name) || '분류 경로 지정 안 함'}
              </span>
            </div>
          ))}
        </div>
      )}

      {pathError && <p className="text-sm text-warning">{pathError}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canStart}
          onClick={handleStart}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {queue.starting
            ? '시작 중…'
            : sourceKind === 'file' && files.length > 1
              ? `${files.length}개 변환 시작`
              : '변환 시작'}
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
  // 잡 성공 소표기(S14, §4.13 notes) — GET /api/convert/{job_id}.notes를 그대로 전달받아
  // 렌더한다(직접 JSON 업로드 경로는 잡이 없으므로 항상 빈 배열).
  notes: string[]
  showJsonDownload: boolean
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
  notes,
  showJsonDownload,
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
      {/* S13(F40-①, 설계 §4.3) — 디스크 보존본에서 복구된 미리보기 소표기 */}
      {preview.recovered && (
        <div className="rounded border border-accent bg-accent-soft px-3 py-2 text-sm text-primary">
          이전 미리보기를 복구했습니다 — 중복 판정은 현재 DB 기준입니다.
        </div>
      )}

      {/* 잡 성공 소표기(S14, §4.13 notes) — 서버가 완성한 문장을 그대로 렌더(포맷 분기 금지). */}
      {notes.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-border bg-surface px-3 py-2 text-sm text-muted">
          {notes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
        </div>
      )}

      {source.duplicate_source && (
        <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
          같은 원본이 이미 반입된 적 있습니다 ("{source.filename}"). 내용이 중복 의심으로 잡힐 수 있습니다.
        </div>
      )}

      {/* S15(설계 §4.17⑥) — 대조 불가는 조용한 통과 금지: 배지(항목별) + 상단 안내 1줄.
          기본 반입은 유지한다(제외하면 이미지 PDF 경로 전체가 막힘). */}
      {items.some((i) => i.warnings?.includes('match_unavailable')) && (
        <div className="rounded border border-border bg-surface px-3 py-2 text-sm text-muted">
          원본에서 텍스트를 추출하지 못해 원문 대조를 수행하지 못했습니다 — 반입 전 원본과 직접
          대조하세요.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
        <div className="flex flex-wrap gap-3">
          <span className="text-primary">전체 {summary.total}</span>
          <span className="text-correct">정상 {summary.ok}</span>
          <span className="text-warning">중복 의심 {summary.duplicate_suspect}</span>
          <span className="text-wrong">오류 {summary.error}</span>
          {(summary.warning ?? 0) > 0 && <span className="text-warning">경고 {summary.warning}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {showJsonDownload && (
            <a
              href={previewJsonUrl(preview.preview_id)}
              download
              className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
            >
              변환 JSON 내려받기
            </a>
          )}
          <button
            type="button"
            onClick={onSkipAll}
            className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
          >
            전체 건너뛰기
          </button>
        </div>
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

// S15(설계 §4.17⑤·⑥) — 변환 신뢰 게이트 경고 배지. 모르는 값은 무시(전방 호환, alternatives 관례).
const WARNING_BADGE: Record<ImportItemWarning, { label: string; className: string }> = {
  solved_answer: { label: 'AI가 정답을 직접 채움', className: 'bg-warning text-on-accent' },
  fabrication_suspect: { label: '원문과 불일치 (창작 의심)', className: 'bg-wrong text-on-accent' },
  match_unavailable: { label: '원문 대조 불가', className: 'border border-border text-muted' },
  // stage-42(B4-S1/S7) — 분류 제안 0건·형식 오류. 반입 자체는 막지 않고 아래 분류 블록에서
  // 경로를 직접 입력해 분류할 수 있다(항상 렌더).
  no_category: { label: '분류 제안 없음', className: 'border border-border text-muted' },
  category_malformed: { label: '분류 제안 형식 오류 — 일부만 반영됨', className: 'bg-warning text-on-accent' },
}

function WarningBadges({ warnings }: { warnings: ImportItemWarning[] | undefined }) {
  if (!warnings || warnings.length === 0) return null
  return (
    <>
      {warnings.map((w) => {
        const conf = WARNING_BADGE[w]
        if (!conf) return null
        return (
          <span key={w} className={`rounded px-2 py-0.5 text-[11px] font-medium ${conf.className}`}>
            {conf.label}
          </span>
        )
      })}
    </>
  )
}

interface ItemRowProps {
  item: ImportItem
  state: ItemDecisionState | undefined
  onUpdateDecision: (index: number, patch: Partial<ItemDecisionState>) => void
}

function ItemRow({ item, state, onUpdateDecision }: ItemRowProps) {
  const isSkipped = state?.action === 'skip'
  const isQuestionType = item.type === 'question' || item.type === 'past_question'

  // stage-42(B3, §4.3) — 검토 단계 본문 열람·편집(구 편집기 재사용 금지 — 제목 input · 본문/정답/
  // 해설 textarea만). 편집분은 decisions[index].override에 보관, commit에 그대로 실린다.
  const [bodyOpen, setBodyOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(item.title)
  const [draftContent, setDraftContent] = useState(item.content ?? '')
  const [draftAnswer, setDraftAnswer] = useState(item.answer ?? '')
  const [draftExplanation, setDraftExplanation] = useState(item.explanation ?? '')
  // stage-42(B4-S12) — 항목별 분류 경로 직접 추가.
  const [manualCategoryPath, setManualCategoryPath] = useState('')

  const hasOverride = Boolean(state?.override && Object.keys(state.override).length > 0)
  const effectiveTitle = state?.override?.title ?? item.title
  const effectiveContent = state?.override?.content ?? item.content ?? null
  const effectiveAnswer = state?.override?.answer ?? item.answer ?? null
  const effectiveExplanation = state?.override?.explanation ?? item.explanation ?? null

  function startEditing() {
    setDraftTitle(effectiveTitle)
    setDraftContent(effectiveContent ?? '')
    setDraftAnswer(effectiveAnswer ?? '')
    setDraftExplanation(effectiveExplanation ?? '')
    setEditing(true)
    setBodyOpen(true)
  }

  function saveEdit() {
    if (!state) return
    const override: ImportItemOverride = {}
    if (draftTitle !== item.title) override.title = draftTitle
    if (draftContent !== (item.content ?? '')) override.content = draftContent
    if (isQuestionType) {
      if (draftAnswer !== (item.answer ?? '')) override.answer = draftAnswer
      if (draftExplanation !== (item.explanation ?? '')) override.explanation = draftExplanation
    }
    onUpdateDecision(item.index, { override: Object.keys(override).length > 0 ? override : undefined })
    setEditing(false)
  }

  // 수동으로 추가한 분류 경로(문자열) — LLM 제안(item.suggest_categories)에 없는 문자열 승인만
  // 골라내면 "추가분" 칩으로 다시 렌더할 수 있다(별도 상태 없이 approvedCategoryIds가 단일 출처).
  const manualApprovedPaths = (state?.approvedCategoryIds ?? []).filter(
    (id): id is string => typeof id === 'string' && !item.suggest_categories.some((sc) => sc.path === id),
  )

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={item.status} />
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
          {TYPE_LABEL[item.type] ?? item.type}
        </span>
        <span className="text-sm font-medium text-primary">
          #{item.index} {effectiveTitle}
        </span>
        {hasOverride && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">편집됨</span>
        )}
        <WarningBadges warnings={item.warnings} />
      </div>

      {/* stage-42(B3) — 본문·선택지·정답·해설 열람·편집(오류 항목도 원문 확인은 가능해야 하므로
          error 여부와 무관하게 렌더). */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setBodyOpen((v) => !v)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {bodyOpen ? '본문 접기 ▾' : '본문 보기 ▸'}
        </button>
        {!editing && item.status !== 'error' && (
          <button type="button" onClick={startEditing} className="text-xs font-medium text-accent hover:underline">
            편집
          </button>
        )}
      </div>

      {bodyOpen && !editing && (
        <div className="mb-3 flex flex-col gap-2 rounded border border-border bg-bg p-2">
          <MarkdownView content={effectiveContent} />
          {item.choices && item.choices.length > 0 && (
            <ol className="ml-4 list-decimal text-sm text-primary">
              {item.choices.map((c, i) => (
                <li key={i}>{choiceLabel(c)}</li>
              ))}
            </ol>
          )}
          {isQuestionType && (
            <div>
              <p className="text-xs font-semibold text-muted">정답</p>
              <p className="whitespace-pre-wrap text-sm text-primary">{effectiveAnswer || '(없음)'}</p>
            </div>
          )}
          {isQuestionType && effectiveExplanation && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">해설</p>
              <MarkdownView content={effectiveExplanation} />
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="mb-3 flex flex-col gap-2 rounded border border-accent bg-bg p-2">
          <label className="flex flex-col gap-1 text-xs text-primary">
            제목
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-primary">
            본문(마크다운 원문)
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={8}
              className="rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-primary outline-none focus:border-accent"
            />
          </label>
          {isQuestionType && (
            <>
              <label className="flex flex-col gap-1 text-xs text-primary">
                정답
                <textarea
                  value={draftAnswer}
                  onChange={(e) => setDraftAnswer(e.target.value)}
                  rows={2}
                  className="rounded border border-border bg-surface px-2 py-1 text-sm text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-primary">
                해설(마크다운 원문)
                <textarea
                  value={draftExplanation}
                  onChange={(e) => setDraftExplanation(e.target.value)}
                  rows={4}
                  className="rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-primary outline-none focus:border-accent"
                />
              </label>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border border-border px-3 py-1 text-xs text-primary hover:bg-surface"
            >
              취소
            </button>
            <button
              type="button"
              disabled={draftTitle.trim().length === 0}
              onClick={saveEdit}
              className="rounded bg-accent px-3 py-1 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      )}

      {item.status !== 'error' && hasExclusionWarning(item.warnings) && (
        <p className="mb-2 text-[11px] text-warning">
          경고 항목이라 기본적으로 반입에서 제외됩니다 — 포함하려면 아래에서 명시적으로
          선택하세요.
        </p>
      )}

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

          {/* stage-42(B4-S1/S8/S12) — 제안이 비어도 항상 렌더(무분류 반입 방지). */}
          <div>
            <p className="mb-1 text-xs font-semibold text-muted">분류</p>
            {item.suggest_categories.length === 0 ? (
              <p className="mb-2 text-xs text-muted">
                분류 제안 없음 — 아래에 경로를 입력하면 생성·연결합니다.
              </p>
            ) : (
              <div className="mb-1 flex flex-wrap gap-2">
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
                      {sc.container && (
                        <span
                          className="rounded bg-warning px-1 text-on-accent"
                          title="하위 분류(회차·과목)에 연결하는 편이 좋습니다"
                        >
                          중간 노드
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
            {item.suggest_categories.some((sc) => sc.container) && (
              <p className="mb-1 text-[11px] text-warning">
                ⚠ 자식이 있는 중간 노드 제안은 기본 미체크입니다. 하위 분류(회차·과목)에 연결하는
                편이 커리큘럼·모의고사·인쇄에서 다루기 쉽습니다(막지는 않습니다).
              </p>
            )}

            {manualApprovedPaths.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-2">
                {manualApprovedPaths.map((path) => (
                  <span
                    key={path}
                    className="flex items-center gap-1 rounded border border-accent bg-accent-soft px-2 py-1 text-xs text-accent"
                  >
                    {path}
                    <span className="rounded bg-accent-soft px-1">직접 추가</span>
                    <button
                      type="button"
                      disabled={isSkipped}
                      onClick={() =>
                        onUpdateDecision(item.index, {
                          approvedCategoryIds: toggleValue(state.approvedCategoryIds, path),
                        })
                      }
                      className="text-accent hover:opacity-70 disabled:opacity-50"
                      aria-label={`${path} 분류 추가 취소`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="mt-1 flex flex-col gap-1">
              <CategoryPathField value={manualCategoryPath} onChange={setManualCategoryPath} />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={
                    isSkipped ||
                    !manualCategoryPath ||
                    categoryPathError(manualCategoryPath) != null ||
                    state.approvedCategoryIds.includes(manualCategoryPath)
                  }
                  onClick={() => {
                    onUpdateDecision(item.index, {
                      approvedCategoryIds: [...state.approvedCategoryIds, manualCategoryPath],
                    })
                    setManualCategoryPath('')
                  }}
                  className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
                >
                  경로 추가
                </button>
              </div>
            </div>
          </div>

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
  onBackToQueue,
}: {
  result: ImportCommitResult
  erroredCount: number
  onRestart: () => void
  onBackToQueue: (() => void) | null
}) {
  return (
    <div className="flex flex-col gap-4">
      {result.recovered && (
        <div className="rounded border border-accent bg-accent-soft px-3 py-2 text-sm text-primary">
          만료된 미리보기를 보존본으로 복구해 반입했습니다 — 중복 판정은 반입 시점 DB 기준입니다.
        </div>
      )}

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

      <div className="flex flex-wrap gap-2">
        {onBackToQueue && (
          <button
            type="button"
            onClick={onBackToQueue}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            대기열로 돌아가기
          </button>
        )}
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
