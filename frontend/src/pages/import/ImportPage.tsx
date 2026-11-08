import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useImportCommit } from '../../api/import'
import { fetchConvertJob, useConvertedPreview } from '../../api/convert'
import { importRunKeys, useAdoptLegacy } from '../../api/importRuns'
import { fetchImportRequest } from '../../api/fetch'
import { llmJobsKey, useDismissLlmJob } from '../../api/llm'
import { ApiError } from '../../api/client'
import { useImportRuns, useStartImportRuns } from '../../hooks/useImportRuns'
import { clearLegacyKeys, hasLegacyKeys, readLegacyEntries } from '../../utils/legacyQueueAdopt'
import Stepper from '../../components/Stepper'
import ConfirmDialog from '../../components/ConfirmDialog'
import type { StepperStep } from '../../components/Stepper'
import type { SplitInitialSource } from '../../components/SplitImportWizard'
import type {
  ImportCommitResult,
  ImportDecision,
  ImportPreviewResponse,
  FetchAdapterId,
  ImportRun,
  SplitEnqueueJobItem,
} from '../../api/types'
import NewImportPanel from './NewImportPanel'
import type { EntryMode, SplitContext } from './NewImportPanel'
import PreviewStep from './PreviewStep'
import ResultStep from './ResultStep'
import RunList, { RunSummaryLine } from './RunList'
import { buildInitialDecisions, errMsg } from './importShared'
import type { ItemDecisionState, WizardStep } from './importShared'

// 반입 화면(설계 §5.9 [S56]) — 첫 화면 = 반입 건 목록(서버 정본) + [새 반입] 접힘/펼침. 미리보기 ②·결과 ③는
// 무변(PreviewStep·ResultStep 파일 분리만). 라우트 /import 1개 + 쿼리 ?mode=(answer_key|split_import) ·
// ?split_id= · ?run=(딥링크 — 카드 스크롤 + 강조).

const STEP_ORDER: WizardStep[] = ['select', 'preview', 'result']
const STEP_LABELS: Record<WizardStep, string> = {
  select: '소스 선택',
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

const HIGHLIGHT_MS = 8000

export default function ImportPage() {
  const qc = useQueryClient()
  // S22(설계 §4.24 ⓓ) — 작업 센터 [화면으로 이동]이 `?mode=answer_key`로 답지 위저드를 곧바로 연다.
  const [searchParams, setSearchParams] = useSearchParams()
  const modeParam = searchParams.get('mode')
  // S23(§4.25 — 작업 센터 딥링크) split_id가 있으면 위저드가 GET으로 그 분할안을 이어 받는다(1 릴리스 유지).
  const splitIdParam = searchParams.get('split_id')
  const runParamRaw = searchParams.get('run')
  const runParam = runParamRaw && /^\d+$/.test(runParamRaw) ? Number(runParamRaw) : null

  const [entryMode, setEntryMode] = useState<EntryMode>(() => {
    if (modeParam === 'answer_key') return 'answer_key'
    if (modeParam === 'split_import') return 'split_import'
    return 'convert'
  })
  // 이미 이 라우트에 있는 상태에서 딥링크 쿼리만 바뀌는 경우 대응(useState 초기값은 마운트 시 1회만 읽힌다).
  useEffect(() => {
    if (modeParam === 'answer_key') {
      setEntryMode('answer_key')
      setPanelOverride(true)
    }
    if (modeParam === 'split_import') {
      setEntryMode('split_import')
      setPanelOverride(true)
    }
  }, [modeParam])

  const runs = useImportRuns(runParam)

  // [새 반입] 패널 접힘/펼침 — 사용자가 직접 정하기 전에는 "run 0건이면 펼침, 1건 이상이면 접힘".
  const [panelOverride, setPanelOverride] = useState<boolean | null>(() =>
    modeParam === 'answer_key' || modeParam === 'split_import' ? true : null,
  )
  const panelOpen = panelOverride ?? (!runs.isLoading && !runs.isError && runs.total === 0)
  const [panelNotice, setPanelNotice] = useState<string | null>(null)

  // 분할 재진입 컨텍스트 — run 1건의 split_id·source_url·category_path에서 파생(종전 앵커 state 대체).
  const [splitCtx, setSplitCtx] = useState<SplitContext | null>(null)
  const [splitSourceJobId, setSplitSourceJobId] = useState<string | null>(null)
  const [splitExpiredNotice, setSplitExpiredNotice] = useState<string | null>(null)
  const dismissJobMutation = useDismissLlmJob()

  // 새 카드 강조 — 시작 성공(run_id) · ?run= 딥링크.
  const [highlightIds, setHighlightIds] = useState<number[]>(runParam != null ? [runParam] : [])
  useEffect(() => {
    if (runParam != null) setHighlightIds((prev) => (prev.includes(runParam) ? prev : [...prev, runParam]))
  }, [runParam])
  useEffect(() => {
    if (highlightIds.length === 0) return
    const timer = window.setTimeout(() => setHighlightIds([]), HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [highlightIds])

  // ---- 레거시 큐 이관(1회) ----
  const adoptMutation = useAdoptLegacy()
  const [adoptNotice, setAdoptNotice] = useState<string | null>(null)
  const adoptTriedRef = useRef(false)
  useEffect(() => {
    if (adoptTriedRef.current || !hasLegacyKeys()) return
    adoptTriedRef.current = true
    const entries = readLegacyEntries()
    if (entries.length === 0) {
      clearLegacyKeys()
      return
    }
    adoptMutation.mutate(
      { entries },
      {
        onSuccess: (res) => {
          clearLegacyKeys()
          if (res.created > 0) setAdoptNotice(`이전 대기열 ${res.created}건을 반입 건 목록으로 옮겼습니다.`)
        },
        // 실패 시 키 유지 — 다음 진입에서 재시도.
        onError: (e) => console.warn('이전 대기열 이관에 실패했습니다(다음 진입에 재시도):', e),
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 미리보기 ② / 결과 ③ 상태(무변) ----
  const [step, setStep] = useState<WizardStep>('select')
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  // 미리보기가 변환 잡(run 카드·사이트 반입)에서 왔는가 — 디스크 보존본이 있는 경우에만
  // [변환 JSON 내려받기]가 의미를 갖는다(직접 올린 JSON은 서버가 보존하지 않는다, §4.3).
  const [previewFromJob, setPreviewFromJob] = useState(false)
  const [decisions, setDecisions] = useState<Record<number, ItemDecisionState>>({})
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null)
  const [result, setResult] = useState<ImportCommitResult | null>(null)
  const [erroredCount, setErroredCount] = useState(0)

  // 카드 [검토] — preview_id로 미리보기를 열어 기존 ②단계에 그대로 합류시킨다.
  const [reviewRunId, setReviewRunId] = useState<number | null>(null)
  const [reviewPreviewId, setReviewPreviewId] = useState<string | null>(null)
  const awaitingReview = useRef(false)
  const reviewQuery = useConvertedPreview(reviewPreviewId)
  // [검토] 시점에 잡에서 best-effort로 읽어 온 notes(§4.13 — notes는 GET /api/convert/{job_id} 소관).
  const pendingReviewNotes = useRef<string[]>([])
  const [previewNotes, setPreviewNotes] = useState<string[]>([])

  const commitMutation = useImportCommit()

  // 반입 완료(result) 상태에서 지나온 단계를 클릭하면 결과가 버려지는 파괴적 복귀 — 확인 후 재시작.
  const [confirmRestart, setConfirmRestart] = useState(false)

  useEffect(() => {
    // 목록에서 [검토]를 눌러 기다리는 중일 때만 미리보기로 넘어간다 — 결과 화면에서 백그라운드
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
    setReviewRunId(null)
    // 커밋 없이 돌아와도 서버 상태(복구 이벤트 등)를 새로 읽는다.
    qc.invalidateQueries({ queryKey: importRunKeys.all })
  }

  function resetWizard() {
    backToSelect()
    setEntryMode('convert')
    setPanelOverride(true)
    setResult(null)
    setErroredCount(0)
  }

  // 반입 건 목록으로 돌아가기 — 다음 건을 이어서 검토한다(§5.9 F40-②).
  function backToList() {
    backToSelect()
    setResult(null)
    setErroredCount(0)
    setPanelOverride(false)
  }

  function applyPreview(data: ImportPreviewResponse, fromJob = false, notes: string[] = []) {
    setPreview(data)
    setPreviewFromJob(fromJob)
    setPreviewNotes(notes)
    setDecisions(buildInitialDecisions(data.items))
    setExpiredNotice(null)
    setStep('preview')
  }

  async function handleReview(run: ImportRun, previewId: string) {
    // 답지 run은 매칭 미리보기(§4.20)가 반입 preview(§4.3)와 다른 경로라 답지 위저드로 보낸다.
    if (run.kind === 'answer_key') {
      setEntryMode('answer_key')
      setPanelOverride(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    let notes: string[] = []
    if (run.job_id) {
      try {
        notes = (await fetchConvertJob(run.job_id)).notes ?? []
      } catch {
        notes = [] // 잡이 TTL로 사라졌어도 미리보기는 보존본에서 복구된다 — notes만 생략.
      }
    }
    awaitingReview.current = true
    pendingReviewNotes.current = notes
    setReviewRunId(run.id)
    setReviewPreviewId(previewId)
    // 같은 preview를 다시 여는 경우 캐시된 응답이 즉시 반환된다(refetch는 백그라운드).
    if (reviewPreviewId === previewId && reviewQuery.data) {
      awaitingReview.current = false
      applyPreview(reviewQuery.data, true, notes)
    }
  }

  // too_large [분할 반입](§4.25 진입점) — URL run은 source_url 자동, 파일 run은 위저드 'source' 단계에서
  // 파일을 다시 고른다. run에 split_id가 이미 있으면 원본을 다시 묻지 않고 그 분할안을 이어서 연다.
  function handleSplitImport(run: ImportRun) {
    let initialSource: SplitInitialSource | null = null
    if (!run.split_id && run.kind === 'convert_url' && run.source_url) {
      initialSource = { kind: 'url', url: run.source_url }
    }
    setSplitExpiredNotice(null)
    setSplitSourceJobId(run.job_id)
    setSplitCtx({
      runId: run.id,
      resumeSplitId: run.split_id,
      initialSource,
      commonPath: run.category_path,
    })
    setEntryMode('split_import')
    setPanelOverride(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // [다시 시도] = 새 run. URL run은 저장된 source_url로 재제출, 그 외(파일·사이트·JSON·답지)는 서버가 원본을
  // 보관하지 않아 [새 반입] 패널을 열어 다시 고르게 안내한다(서버 재시도 API 0).
  const retrier = useStartImportRuns()
  async function handleRetry(run: ImportRun) {
    if (run.kind === 'convert_url' && run.source_url) {
      const outcome = await retrier.startUrl(run.source_url, run.category_path)
      if (outcome.runIds.length > 0) setHighlightIds(outcome.runIds)
      if (outcome.failures.length > 0) {
        setEntryMode('url')
        setPanelNotice(outcome.failures[0].message)
        setPanelOverride(true)
      }
      return
    }
    // 사이트 반입 — 서버가 보존한 시작 요청(fetch_request)으로 새 run을 재제출한다. 없으면 아래 패널 안내 폴백.
    const fr = run.summary.fetch_request
    if (run.kind === 'fetch' && fr?.adapter && fr.cert_ref && fr.exam_ref) {
      try {
        const res = await fetchImportRequest({
          adapter: fr.adapter as FetchAdapterId,
          cert_ref: fr.cert_ref,
          exam_ref: fr.exam_ref,
          exam_key: fr.exam_key ?? undefined,
        })
        handleStarted(res.run_id != null ? [res.run_id] : [])
      } catch (e) {
        setEntryMode('fetch')
        setPanelNotice(errMsg(e, '다시 시도를 시작하지 못했습니다.'))
        setPanelOverride(true)
      }
      return
    }
    const modeByKind: Record<ImportRun['kind'], EntryMode> = {
      convert_file: 'convert',
      convert_url: 'url',
      fetch: 'fetch',
      json_upload: 'json',
      answer_key: 'answer_key',
    }
    setEntryMode(modeByKind[run.kind])
    setPanelNotice(
      run.kind === 'fetch'
        ? '사이트 반입은 회차를 다시 선택해 시작해 주세요.'
        : '원본 파일은 서버가 다시 읽을 수 없습니다 — 파일을 다시 선택해 시작해 주세요.',
    )
    setPanelOverride(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleStarted(runIds: number[]) {
    qc.invalidateQueries({ queryKey: importRunKeys.all })
    qc.invalidateQueries({ queryKey: llmJobsKey })
    setPanelNotice(null)
    setPanelOverride(false)
    if (runIds.length > 0) setHighlightIds(runIds)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function leaveAnswerKey() {
    // 딥링크(?mode=answer_key)로 들어왔다 나갈 때 파라미터를 지워, 작업 센터 [화면으로 이동]으로 같은 URL에
    // 재진입해도 modeParam 변화가 생겨 답지 화면이 다시 열린다.
    if (searchParams.has('mode')) {
      const next = new URLSearchParams(searchParams)
      next.delete('mode')
      setSearchParams(next, { replace: true })
    }
    setEntryMode('convert')
    qc.invalidateQueries({ queryKey: importRunKeys.all })
  }

  function closeSplit() {
    setSplitCtx(null)
    setSplitSourceJobId(null)
    setEntryMode('convert')
  }

  function handleSplitEnqueued(_jobs: SplitEnqueueJobItem[], _splitId: string) {
    // 조각 진행·검토 대기는 서버 run이 추적한다(조각 k/N 카드) — 위저드를 닫고 목록으로 합류.
    const runId = splitCtx?.runId ?? null
    closeSplit()
    qc.invalidateQueries({ queryKey: importRunKeys.all })
    qc.invalidateQueries({ queryKey: llmJobsKey })
    setPanelOverride(false)
    if (runId != null) setHighlightIds([runId])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleSplitStarted(_splitId: string, runId?: number) {
    qc.invalidateQueries({ queryKey: importRunKeys.all })
    if (runId != null) {
      setSplitCtx((prev) => (prev ? { ...prev, runId } : prev))
      setHighlightIds([runId])
    }
    // stage-42(B2-1, 결정 ①) — [분할 반입]이 성공적으로 시작됐으니 원 실패 convert 잡을 작업 센터 목록에서
    // 지운다. 실패해도 분할 진행 자체를 막을 이유는 아니므로 콘솔 경고만 남긴다.
    if (splitSourceJobId) {
      const jobId = splitSourceJobId
      setSplitSourceJobId(null)
      dismissJobMutation.mutate(jobId, {
        onError: (e) => console.warn('실패 잡 정리에 실패했습니다(무시):', e),
      })
    }
  }

  function handleSplitExpired() {
    // split이 서버에서 만료(404 — TTL 1h·디스크 최근 20건 초과)됐다.
    setSplitExpiredNotice(
      '분할 작업 정보를 더 이상 확인할 수 없습니다(만료됨) — [분할 반입]을 다시 눌러 새로 시작해 주세요.',
    )
  }

  // ?mode=split_import(&split_id=) 레거시 딥링크 — run 컨텍스트가 없으면 쿼리에서 파생한다(1 릴리스 유지).
  const effectiveSplit: SplitContext | null =
    splitCtx ??
    (entryMode === 'split_import'
      ? { runId: null, resumeSplitId: splitIdParam, initialSource: null, commonPath: null }
      : null)

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
    reviewQuery.isError && reviewRunId != null
      ? {
          runId: reviewRunId,
          message: errMsg(
            reviewQuery.error,
            '미리보기를 불러오지 못했습니다. 보존 만료 시 다시 반입하세요.',
          ),
        }
      : null

  const showSimpleStepper = step !== 'select' || (panelOpen && entryMode !== 'fetch' && entryMode !== 'answer_key' && entryMode !== 'split_import')

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-primary">반입</h1>
        {step === 'select' && panelOpen && entryMode !== 'answer_key' && entryMode !== 'split_import' && (
          <button
            type="button"
            onClick={() => setEntryMode('answer_key')}
            className="text-xs text-accent hover:underline"
          >
            답지·해설지로 정답 채우기 →
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        기출 원본(파일·URL·사이트)을 반입 JSON으로 변환해 미리보기에서 확인한 뒤 DB에 적재합니다. 이미 변환된 JSON도 넣을 수 있습니다.
      </p>

      {showSimpleStepper && (
        <div className="mb-5">
          <StepIndicator step={step} onNavigate={handleStepNavigate} />
        </div>
      )}

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

      {adoptNotice && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded border border-accent bg-accent-soft px-3 py-2 text-sm text-primary">
          <span>{adoptNotice}</span>
          <button
            type="button"
            onClick={() => setAdoptNotice(null)}
            className="shrink-0 text-xs text-muted hover:text-primary"
          >
            닫기
          </button>
        </div>
      )}

      {expiredNotice && (
        <div className="mb-4 rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
          {expiredNotice}
        </div>
      )}

      {/* 분할 만료 안내(사용자 실사용 피드백 반영, §4.25) */}
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
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <RunSummaryLine reviewReady={runs.reviewReadyCount} inProgress={runs.inProgressCount} />
            <button
              type="button"
              aria-expanded={panelOpen}
              onClick={() => {
                setPanelNotice(null)
                setPanelOverride(!panelOpen)
              }}
              className="ml-auto rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
            >
              {panelOpen ? '새 반입 닫기' : '새 반입'}
            </button>
          </div>

          {panelOpen && (
            <NewImportPanel
              mode={entryMode}
              onModeChange={setEntryMode}
              notice={panelNotice}
              inProgressCount={runs.inProgressCount}
              split={effectiveSplit}
              onLeaveAnswerKey={leaveAnswerKey}
              onStarted={handleStarted}
              onPreview={(data, fromJob, notes) => applyPreview(data, fromJob, notes)}
              onSplitCancel={closeSplit}
              onSplitEnqueued={handleSplitEnqueued}
              onSplitStarted={handleSplitStarted}
              onSplitExpired={handleSplitExpired}
            />
          )}

          <RunList
            data={runs}
            highlightIds={highlightIds}
            scrollToId={runParam}
            reviewingPreviewId={reviewPreviewId}
            reviewError={reviewError}
            retrying={retrier.starting}
            onReview={handleReview}
            onSplitImport={handleSplitImport}
            onRetry={handleRetry}
          />
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="flex flex-col gap-4">
          <BackToListBar runs={runs} onBackToList={backToList} />
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
          <BackToListBar runs={runs} onBackToList={backToList} />
          <ResultStep
            result={result}
            erroredCount={erroredCount}
            onRestart={resetWizard}
            onBackToQueue={backToList}
          />
        </div>
      )}
    </div>
  )
}

// preview·result 단계에서 유지되는 접힌 요약 — 목록이 살아 있음을 잊지 않게 한다(검토 대기·진행 중이 있을 때만).
function BackToListBar({
  runs,
  onBackToList,
}: {
  runs: { reviewReadyCount: number; inProgressCount: number }
  onBackToList: () => void
}) {
  if (runs.reviewReadyCount === 0 && runs.inProgressCount === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <RunSummaryLine reviewReady={runs.reviewReadyCount} inProgress={runs.inProgressCount} />
      <button
        type="button"
        onClick={onBackToList}
        className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
      >
        반입 건 목록
      </button>
    </div>
  )
}
