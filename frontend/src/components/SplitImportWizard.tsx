import { useEffect, useMemo, useRef, useState } from 'react'
import EngineSelect from './EngineSelect'
import Stepper from './Stepper'
import type { StepperStep } from './Stepper'
import LlmJobProgress from './LlmJobProgress'
import LlmErrorInfoView from './LlmErrorInfo'
import LlmLimitBanner from './LlmLimitBanner'
import CategoryPathField, { categoryPathError, normalizeCategoryPath } from './CategoryPathField'
import { useJobRecovery } from '../hooks/useJobRecovery'
import { jobUnavailable } from '../api/convert'
import { useSplitAnalyze, useSplitEnqueue, useSplitStatus, useStartSplit } from '../api/split'
import { ApiError } from '../api/client'
import type {
  LlmEngine,
  SplitChunk,
  SplitConfidence,
  SplitEnqueueJobItem,
  SplitFallback,
  SplitReuseInfo,
  SplitStartResponse,
} from '../api/types'

// 설계 §4.25(S23, F49) — 대용량 원본 LLM 분할 반입 위저드. 5단계 컨셉(계획서 §14 F49) 중
// 0단계(추출)는 원본 확보 시 즉시·자동으로 수행되고(이 컴포넌트의 'source'→분석 진입), 1~3단계를
// 이 컴포넌트가 담당한다(4단계 조각별 미리보기 승인은 기존 ImportQueue→반입 preview 화면이
// 그대로 담당 — 신규 진행 UI 없음, 체크리스트). 전자동 반입 없음(R7) — 분할안 확인(2단계)과
// 비용 확인(3단계)은 생략할 수 없다.

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

const MAX_CHUNK_CHARS = 200000

// 위저드 내부 조각 표현 — 인접 [합치기]로 원본 조각 여러 개를 한 행(그룹)으로 묶는다. 그룹
// 배열은 항상 원문 순서를 그대로 유지하는 파티션이라(중간 삽입·삭제 없음, 병합만 허용) 배열상
// 이웃이 곧 원문상 이웃이다 — "인접 구간만 합치기 가능"(서버 제약, §4.25)을 화면에서 별도로
// 검증할 필요가 없다.
interface ChunkGroup {
  ids: string[]
  label: string
  head: string
  chars: number
  approxTokens: number
  assumed: boolean
  selected: boolean
  // category_path 초안 — 공통 상위 경로(commonPath) 뒤에 붙는 하위 조각(기본값 = 서버 label,
  // §4.25 세칙 "조각 라벨은 category_path 초안으로만 쓰인다").
  pathSuffix: string
}

function toGroups(chunks: SplitChunk[]): ChunkGroup[] {
  return chunks.map((c) => ({
    ids: [c.chunk_id],
    label: c.label,
    head: c.head,
    chars: c.chars,
    approxTokens: c.estimate.approx_input_tokens,
    assumed: c.estimate.assumed,
    selected: true,
    // stage-42(B2-2, §4.25 ②) — 접미 기본값은 빈 문자열(모든 조각이 공통 경로 하나로 모인다).
    // 종전 `c.label`은 조각 라벨(예: "… 1/2")의 `/`가 분류 2단으로 쪼개져 조각마다 엉뚱한
    // 분류를 만드는 결함이었다 — "접미 추가" 입력은 그대로 두되 비우면 공통 경로만 쓰인다.
    pathSuffix: '',
  }))
}

type Step = 'source' | 'analyze' | 'chunks' | 'cost'

const STEP_ORDER: Step[] = ['source', 'analyze', 'chunks', 'cost']
const STEP_LABELS: Record<Step, string> = {
  source: '원본',
  analyze: '구조 분석',
  chunks: '분할안 확인',
  cost: '비용 확인',
}

export type SplitInitialSource = { kind: 'file'; file: File } | { kind: 'url'; url: string }

// stage-42(B2-2, §4.25 ②) — 라벨·접미의 경로 구분자(`/`)는 분류 2단으로 잘못 쪼개진다.
function sanitizePathSuffix(s: string): string {
  return s.replace(/\//g, '-')
}

interface SplitImportWizardProps {
  // too_large 오류에서 곧장 넘어온 경우(§4.25 진입점) — 있으면 마운트 즉시 분할 시작을 시도한다.
  initialSource?: SplitInitialSource | null
  // 작업 센터 딥링크·새로고침 복원(§4.24 ⑤, §4.25 ㉳) — 이미 만들어진 분할안을 이어서 연다.
  resumeSplitId?: string | null
  // stage-42(B2-2, §4.25 ②) — 원 항목의 categoryPath를 공통 상위 경로 초기값으로 넘긴다(분할
  // 조각이 기본값 그대로도 원 항목과 같은 분류 경로 하나로 모이게).
  initialCommonPath?: string | null
  onCancel: () => void
  // splitId(두 번째 인자, stage-reviewer 표적 확인 [관찰 (a)]) — 호출부가 이 split_id를 가진
  // 큐 항목 "전부"를 정리할 수 있게 함께 넘긴다(같은 split을 재사용한 두 앵커가 남아 같은
  // 조각을 중복 투입하는 엣지 차단 — 단일 anchorEntryId 제거로는 못 막는다).
  onEnqueued: (jobs: SplitEnqueueJobItem[], splitId: string) => void
  // 재진입 앵커(사용자 실사용 피드백 반영) — split_id를 확보(POST 성공·재사용 선택 포함)할
  // 때마다 알려 호출부가 출발점이 된 too_large 항목에 이 id를 심게 한다("분할 진행 중" 전환).
  onSplitStarted?: (splitId: string) => void
  // split이 서버에서 만료(404 — TTL 1h·디스크 최근 20건 초과)된 채로 재진입했을 때 알린다 —
  // 호출부가 앵커 항목의 split_id를 지워 원래 실패 상태로 되돌린다([분할 반입] 재시도 가능).
  onSplitExpired?: () => void
}

export default function SplitImportWizard({
  initialSource,
  resumeSplitId,
  initialCommonPath,
  onCancel,
  onEnqueued,
  onSplitStarted,
  onSplitExpired,
}: SplitImportWizardProps) {
  const [step, setStep] = useState<Step>(resumeSplitId || initialSource ? 'analyze' : 'source')
  const [splitId, setSplitId] = useState<string | null>(resumeSplitId ?? null)
  const [startResult, setStartResult] = useState<SplitStartResponse | null>(null)
  const [reusePrompt, setReusePrompt] = useState(false)
  const [manualFile, setManualFile] = useState<File | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [engine, setEngine] = useState<LlmEngine>('auto')
  const [model, setModel] = useState<string | null>(null)
  const [agreedAnalyze, setAgreedAnalyze] = useState(false)
  const [recoveredNotice, setRecoveredNotice] = useState(false)
  const [groups, setGroups] = useState<ChunkGroup[]>([])
  const [commonPath, setCommonPath] = useState(initialCommonPath ?? '')
  const [agreedCost, setAgreedCost] = useState(false)

  const startMutation = useStartSplit()
  const analyzeMutation = useSplitAnalyze()
  const enqueueMutation = useSplitEnqueue()
  // 'chunks'·'cost' 단계에서는 더 이상 원격 상태가 필요 없다(분할안은 로컬 groups로 이미
  // 확정) — 폴링은 'analyze' 단계에만 켠다.
  const statusQuery = useSplitStatus(splitId, step === 'analyze')

  const startedRef = useRef(false)

  // stage-reviewer 재수정(2026-08-04, [경미-3]) — confidence:'ok'이고 균등 분할 폴백도 아니면
  // 정밀 분석 카드 없이 곧장 분할안 확인으로 진행한다. 재사용 여부를 아직 고르지 않았으면
  // (reuse 있음) 그 선택이 항상 우선한다.
  function shouldAutoAdvance(data: {
    reuse?: SplitReuseInfo | null
    confidence: SplitConfidence
    fallback?: SplitFallback | null
  }): boolean {
    return !data.reuse && data.confidence === 'ok' && data.fallback !== 'even_split'
  }

  function applyStart(data: SplitStartResponse) {
    setStartResult(data)
    setSplitId(data.split_id)
    setGroups(toGroups(data.chunks))
    setReusePrompt(Boolean(data.reuse))
    setStep(shouldAutoAdvance(data) ? 'chunks' : 'analyze')
    // 재진입 앵커(사용자 실사용 피드백 반영) — split_id를 확보한 즉시 호출부에 알려 too_large
    // 항목을 "분할 진행 중"으로 전환한다(위저드를 닫아도 이 id로 이어서 열 수 있게).
    onSplitStarted?.(data.split_id)
  }

  // 진입 시 원본이 이미 있으면(too_large [분할 반입]) 곧바로 분할 시작을 시도한다 — 재마운트당
  // 1회만(파일 선택창을 다시 열 필요 없음).
  useEffect(() => {
    if (startedRef.current || resumeSplitId || !initialSource) return
    startedRef.current = true
    startMutation.mutate(initialSource, { onSuccess: applyStart })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 공용 재진입 복원(§4.24 ⑤, §4.25 ㉳) — splitId를 이미 알면 ref까지 맞춰 매칭하고, 아직
  // 모르면(딥링크에 split_id가 없는 answer_key 관례와 동일) kind만으로 매칭한다.
  useJobRecovery({
    kind: 'split_analyze',
    enabled: step === 'analyze',
    matchRef: splitId ? (ref) => ref.split_id === splitId : undefined,
    onRecovered: (job) => {
      const recoveredId = job.ref?.split_id
      if (recoveredId && recoveredId !== splitId) setSplitId(recoveredId)
      setRecoveredNotice(true)
    },
  })

  // 원격 상태 반영 — (a) 딥링크·재사용 선택 등으로 splitId만 있고 groups가 아직 없을 때 초기
  // 채움, (b) 정밀 분석 완료('analyzed') 시 갱신본으로 **무조건** 대체 후 확인 단계로(§4.25 —
  // "chunks가 갱신본으로 대체" — stage-reviewer 재수정([중요-1] ②)으로 `groups.length===0`
  // 가드를 완료 분기에서 제거했다: 이미 휴리스틱 groups가 채워진 상태에서 분석이 끝나도 유료
  // 갱신본을 버리지 않는다), (c) confidence:'ok'·비폴백이면 카드 없이 자동으로 다음 단계로.
  useEffect(() => {
    if (step !== 'analyze' || !statusQuery.data) return
    const data = statusQuery.data
    if (groups.length === 0) {
      setGroups(toGroups(data.chunks))
    }
    if (data.status === 'analyzed') {
      setGroups(toGroups(data.chunks))
      setStep('chunks')
      return
    }
    if (data.status === 'ready' && !reusePrompt && shouldAutoAdvance(data)) {
      setStep('chunks')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, statusQuery.data, groups.length, reusePrompt])

  function handleManualSubmit() {
    if (manualFile) {
      startMutation.mutate({ kind: 'file', file: manualFile }, { onSuccess: applyStart })
    } else if (manualUrl.trim()) {
      startMutation.mutate({ kind: 'url', url: manualUrl.trim() }, { onSuccess: applyStart })
    }
  }

  function handleUseReuse() {
    if (!startResult?.reuse) return
    const reuseId = startResult.reuse.split_id
    setSplitId(reuseId)
    setReusePrompt(false)
    // 재사용 대상은 다른 split이다 — 방금 만든 split의 POST 응답을 정보원으로 계속 쓰면
    // 엉뚱한 confidence·estimate가 보인다(아래 `info` 파생값이 GET 결과로 넘어가게 비운다).
    setStartResult(null)
    setGroups([]) // 재사용 split의 GET 상태로 다시 채운다(비용 0 — 새로 분석하지 않는다).
    // 앵커도 재사용 대상 split_id로 갈아 끼운다(방금 만든 split이 아니라 이 id로 이어서 열려야).
    onSplitStarted?.(reuseId)
  }

  function handleUseFresh() {
    setReusePrompt(false)
  }

  function handleStartAnalyze() {
    if (!splitId) return
    // 시작 직후 상태 응답은 아직 'ready'일 수 있어(폴링 간격 전) 즉시 한 번 다시 조회해
    // 'running'으로의 전환을 놓치지 않는다(refetchInterval은 현재 데이터가 running일 때만
    // 스스로 도는 관례라, 최초 전환은 수동으로 밀어줘야 한다).
    analyzeMutation.mutate({ splitId, engine, model: model ?? undefined }, { onSuccess: () => statusQuery.refetch() })
  }

  function handleSkipAnalyze() {
    // confidence:'ok'(또는 사용자가 그냥 넘기기로 한 경우) — 정밀 분석 없이 휴리스틱 분할안으로.
    if (groups.length === 0) return
    setStep('chunks')
  }

  function toggleSelected(index: number) {
    setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, selected: !g.selected } : g)))
  }

  function updateSuffix(index: number, value: string) {
    setGroups((prev) =>
      prev.map((g, i) => (i === index ? { ...g, pathSuffix: sanitizePathSuffix(value) } : g)),
    )
  }

  // [합치기] — 인접한 두 그룹만 하나로 합친다(경계 문자 편집 없음, 과설계 기각 확정). 병합 결과가
  // 조각당 상한(200,000자)을 넘으면 거부한다(§4.25 ㉮ — 서버와 동일 규칙을 화면에서 선반영).
  function mergeWithNext(index: number) {
    setGroups((prev) => {
      const a = prev[index]
      const b = prev[index + 1]
      if (!a || !b) return prev
      if (a.chars + b.chars > MAX_CHUNK_CHARS) return prev
      const merged: ChunkGroup = {
        ids: [...a.ids, ...b.ids],
        label: sanitizePathSuffix(`${a.label} + ${b.label}`),
        head: a.head,
        chars: a.chars + b.chars,
        approxTokens: a.approxTokens + b.approxTokens,
        assumed: a.assumed || b.assumed,
        // [합치기]는 pathSuffix를 그대로 두라는 세칙(§4.25) — a쪽 값을 유지한다.
        selected: a.selected || b.selected,
        pathSuffix: a.pathSuffix,
      }
      const next = [...prev]
      next.splice(index, 2, merged)
      return next
    })
  }

  const pathForGroup = (g: ChunkGroup) =>
    normalizeCategoryPath([commonPath, g.pathSuffix].filter(Boolean).join('/'))
  const pathError =
    categoryPathError(commonPath) ??
    groups.map((g) => categoryPathError(pathForGroup(g))).find((e) => e != null) ??
    null

  const selectedGroups = useMemo(() => groups.filter((g) => g.selected), [groups])
  const totalTokens = selectedGroups.reduce((sum, g) => sum + g.approxTokens, 0)
  const anyAssumed = selectedGroups.some((g) => g.assumed)

  function handleEnqueue() {
    if (!splitId || selectedGroups.length === 0) return
    const selections = selectedGroups.map((g) => g.ids)
    // category_paths 키는 각 선택 그룹의 대표 chunk_id(그룹의 첫 원소)로 보낸다 — 계약 해석
    // 지점(최종 보고 참고, api/types.ts SplitEnqueueRequest 주석과 동일 근거).
    const categoryPaths: Record<string, string> = {}
    for (const g of selectedGroups) {
      const path = pathForGroup(g)
      if (path) categoryPaths[g.ids[0]] = path
    }
    enqueueMutation.mutate(
      {
        splitId,
        selections,
        categoryPaths: Object.keys(categoryPaths).length > 0 ? categoryPaths : undefined,
      },
      { onSuccess: (data) => onEnqueued(data.jobs, splitId) },
    )
  }

  const currentIndex = STEP_ORDER.indexOf(step)
  const steps: StepperStep[] = STEP_ORDER.map((key, i) => ({
    key,
    label: STEP_LABELS[key],
    status: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
  }))

  const analyzeUnavailable = step === 'analyze' ? jobUnavailable(statusQuery) : null
  // stage-reviewer 재수정(2026-08-04, [중요-1]) — 백엔드 확정값은 'analyzing'/'analyzed'다
  // (ConvertJobStatus의 'running'/'done'이 아니다).
  const analyzeRunning = statusQuery.data?.status === 'analyzing'
  const analyzeFailed = statusQuery.data?.status === 'error'
  const analyzeCancelled = statusQuery.data?.status === 'cancelled'
  const awaitingRemote = step === 'analyze' && groups.length === 0 && !reusePrompt && !analyzeUnavailable

  // 재진입 앵커 만료(사용자 실사용 피드백 반영) — GET이 404(TTL 1h·디스크 최근 20건 초과로
  // 소멸)면 앵커를 원래 실패 상태로 되돌리라고 호출부에 1회만 알린다(재마운트당 1회 — 폴링은
  // 꺼져 있어(retry:false) 반복 호출 위험은 없지만 방어적으로 ref로 막는다).
  const splitExpiredNotifiedRef = useRef(false)
  useEffect(() => {
    if (analyzeUnavailable === 'lost' && !splitExpiredNotifiedRef.current) {
      splitExpiredNotifiedRef.current = true
      onSplitExpired?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzeUnavailable])

  // [경미-1] 재수정 — GET도 split_id·source_chars·confidence·analyze_estimate·reuse·fallback을
  // 함께 내려주므로, 딥링크·재사용 복원 세션(startResult가 없는 세션)에서도 이 값들로 정밀 분석
  // 제안(견적 확인 포함)을 구성한다. 신선한 POST 응답이 있으면 그걸 우선한다(같은 splitId를
  // 가리키는 한 더 먼저 확보한 값이라 화면 깜빡임이 없다).
  const info = startResult ?? statusQuery.data ?? null
  // [경미-3] 재수정 — confidence:'ok'이고 균등 분할 폴백이 아니면 카드를 아예 보여주지 않는다
  // (§5.15 계약). uncertain이거나 fallback:'even_split'일 때만 정밀 분석을 제안한다.
  const showAnalyzeSuggestion = info != null && (info.confidence === 'uncertain' || info.fallback === 'even_split')

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-primary">분할 반입</h2>
        <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-primary">
          닫기
        </button>
      </div>

      <Stepper steps={steps} size="sm" />

      {step === 'source' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            분할할 원본을 선택하세요(파일 또는 URL 중 하나) — 20만 자를 넘는 원본만 분할이
            의미가 있습니다. 이 단계는 LLM을 호출하지 않습니다(비용 0).
          </p>
          <label className="flex flex-col gap-1 text-sm text-primary">
            원본 파일
            <input
              type="file"
              onChange={(e) => {
                setManualFile(e.target.files?.[0] ?? null)
                setManualUrl('')
              }}
              className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-primary">
            또는 URL
            <input
              type="url"
              value={manualUrl}
              onChange={(e) => {
                setManualUrl(e.target.value)
                setManualFile(null)
              }}
              placeholder="https://example.com/2023-기출.pdf"
              className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
            />
          </label>
          {startMutation.isError && (
            <p className="text-sm text-wrong">{errMsg(startMutation.error, '분할 시작에 실패했습니다.')}</p>
          )}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
            >
              취소
            </button>
            <button
              type="button"
              disabled={(!manualFile && !manualUrl.trim()) || startMutation.isPending}
              onClick={handleManualSubmit}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              {startMutation.isPending ? '분석 중…' : '다음: 구조 분석'}
            </button>
          </div>
        </div>
      )}

      {step === 'analyze' && (
        <div className="flex flex-col gap-3">
          {recoveredNotice && <p className="text-xs text-accent">진행 중이던 정밀 분석 작업을 복원했습니다.</p>}

          {awaitingRemote && <p className="text-sm text-muted">불러오는 중…</p>}

          {reusePrompt && startResult?.reuse && (
            <div className="flex flex-col gap-2 rounded border border-accent bg-accent-soft p-3 text-sm text-primary">
              <p>같은 원본으로 이미 만든 분할안이 있습니다.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUseReuse}
                  className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
                >
                  기존 분할안 재사용 (비용 0)
                </button>
                <button
                  type="button"
                  onClick={handleUseFresh}
                  className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                >
                  새로 분석
                </button>
              </div>
            </div>
          )}

          {!reusePrompt && info && (
            <div className="rounded border border-border bg-bg p-3 text-sm">
              <p className="text-primary">
                원본 {info.source_chars.toLocaleString()}자 · 조각 {groups.length}개(휴리스틱)
              </p>
              {info.fallback === 'even_split' && (
                <p className="mt-1 text-xs text-warning">
                  구조를 찾지 못해 임시로 균등 분할했습니다 — 정밀 분석을 권장합니다.
                </p>
              )}
              {info.fallback !== 'even_split' && (
                <p className="mt-1 text-xs text-muted">
                  {info.confidence === 'ok'
                    ? '경계가 뚜렷해 정밀 분석 없이 진행할 수 있습니다.'
                    : '경계가 불확실합니다 — 정밀 분석을 권장합니다(강제는 아닙니다).'}
                </p>
              )}
            </div>
          )}

          {!reusePrompt && (analyzeRunning || analyzeMutation.isPending) && (
            <LlmJobProgress progress={statusQuery.data?.progress} includeDownloading={false} />
          )}

          {analyzeUnavailable && (
            <div className="rounded border border-warning bg-accent-soft p-3 text-sm text-primary">
              {analyzeUnavailable === 'lost'
                ? '진행 상황을 더 이상 확인할 수 없습니다 — 처음부터 다시 시도해 주세요.'
                : '서버에 연결하지 못했습니다 — 서버를 켠 뒤 다시 확인해 주세요.'}
            </div>
          )}

          {analyzeFailed && <LlmErrorInfoView errorInfo={statusQuery.data?.error_info} legacyError={null} />}

          {analyzeCancelled && <p className="text-sm text-muted">정밀 분석이 취소되었습니다.</p>}

          {/* [경미-3] confidence:'ok'(비폴백)면 카드 자체를 보여주지 않는다 — §5.15 계약, 카드
              없이 다음 스텝으로 넘어가는 흐름은 위 이펙트(shouldAutoAdvance)가 자동 처리한다.
              [경미-1] 견적(analyze_estimate)은 이제 GET 응답에도 동봉되므로(딥링크·재사용 복원
              세션 포함) `info`(POST 우선, 없으면 GET)만 있으면 제안 카드를 구성할 수 있다. */}
          {!reusePrompt &&
            !analyzeRunning &&
            !analyzeMutation.isPending &&
            !analyzeFailed &&
            !analyzeCancelled &&
            !analyzeUnavailable && (
            <div className="flex flex-col gap-3">
              {showAnalyzeSuggestion && info && (
                <div className="flex flex-col gap-3 rounded border border-border bg-bg p-3">
                  <LlmLimitBanner />
                  <p className="text-xs text-muted">
                    예상 입력 토큰 약 {info.analyze_estimate.approx_input_tokens.toLocaleString()}
                    {info.analyze_estimate.assumed && ' (가정치)'}
                  </p>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted">사용 엔진</p>
                    <EngineSelect value={engine} onChange={setEngine} modelValue={model} onModelChange={setModel} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-primary">
                    <input
                      type="checkbox"
                      checked={agreedAnalyze}
                      onChange={(e) => setAgreedAnalyze(e.target.checked)}
                    />
                    위 예상 사용량을 확인했습니다.
                  </label>
                  {analyzeMutation.isError && (
                    <p className="text-sm text-wrong">
                      {errMsg(analyzeMutation.error, '정밀 분석 시작에 실패했습니다.')}
                    </p>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!agreedAnalyze}
                      onClick={handleStartAnalyze}
                      className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                    >
                      LLM 정밀 분석 시작
                    </button>
                  </div>
                </div>
              )}
              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={groups.length === 0}
                  onClick={handleSkipAnalyze}
                  className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg disabled:opacity-50"
                >
                  정밀 분석 없이 분할안 확인
                </button>
              </div>
            </div>
          )}

          {/* analyzeUnavailable(사용자 실사용 피드백 반영) — 만료(404)로 앵커를 되돌린 뒤에도
              사용자가 직접 닫아야 원래 실패 상태([분할 반입] 재시도)를 확인할 수 있다.
              stage-reviewer 표적 확인([관찰-B 본체]) — analyzeFailed/analyzeCancelled여도
              서버에 유효한 휴리스틱 groups가 남아 있으면(정밀 분석 이전에 이미 확보한 분할안,
              §4.25 ⓐ "휴리스틱안은 서버 이력 보존") 그걸 버리지 않고 곧장 분할안 확인으로 넘어갈
              길을 열어 둔다 — 실패·취소가 dead end가 되지 않게. */}
          {(analyzeFailed || analyzeCancelled || analyzeUnavailable) && (
            <div className="flex justify-between">
              <button
                type="button"
                onClick={onCancel}
                className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
              >
                닫기
              </button>
              {(analyzeFailed || analyzeCancelled) && groups.length > 0 && (
                <button
                  type="button"
                  onClick={handleSkipAnalyze}
                  className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
                >
                  정밀 분석 없이 분할안 확인
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'chunks' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            변환에 포함할 조각을 고르고, 인접한 조각은 [다음과 합치기]로 하나로 묶을 수 있습니다 —
            조각 다듬기는 선택·합치기만 가능합니다(경계 문자를 직접 편집할 수는 없습니다).
          </p>

          <CategoryPathField value={commonPath} onChange={setCommonPath} sharedNotice={groups.length > 1} />

          <div className="flex flex-col gap-2">
            {groups.map((g, i) => {
              const next = groups[i + 1]
              const mergeExceeds = next != null && g.chars + next.chars > MAX_CHUNK_CHARS
              return (
                <div key={g.ids.join('-')} className="rounded border border-border bg-bg p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <input type="checkbox" checked={g.selected} onChange={() => toggleSelected(i)} />
                    <span className="text-sm font-medium text-primary">{g.label}</span>
                    <span className="text-xs text-muted">{g.chars.toLocaleString()}자</span>
                    {next != null && (
                      <button
                        type="button"
                        disabled={mergeExceeds}
                        onClick={() => mergeWithNext(i)}
                        title={
                          mergeExceeds
                            ? `합치면 조각당 상한(${MAX_CHUNK_CHARS.toLocaleString()}자)을 넘습니다.`
                            : '다음 조각과 합치기'
                        }
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-primary hover:bg-surface disabled:opacity-40"
                      >
                        다음과 합치기
                      </button>
                    )}
                  </div>
                  <p className="mb-2 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{g.head}</p>
                  <label className="flex flex-col gap-1 text-xs text-primary">
                    분류 경로 초안(선택)
                    <input
                      type="text"
                      value={g.pathSuffix}
                      onChange={(e) => updateSuffix(i, e.target.value)}
                      className="rounded border border-border bg-surface px-2 py-1 text-xs text-primary outline-none focus:border-accent"
                    />
                    <span className="text-[11px] text-muted">{pathForGroup(g) || '분류 경로 지정 안 함'}</span>
                  </label>
                </div>
              )
            })}
          </div>

          {pathError && <p className="text-sm text-warning">{pathError}</p>}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
            >
              취소
            </button>
            <button
              type="button"
              disabled={selectedGroups.length === 0 || pathError != null}
              onClick={() => setStep('cost')}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              다음: 비용 확인 ({selectedGroups.length}개 선택)
            </button>
          </div>
        </div>
      )}

      {step === 'cost' && (
        <div className="flex flex-col gap-3">
          <div className="rounded border border-border bg-bg p-3 text-sm">
            <p className="text-primary">선택 {selectedGroups.length}조각</p>
            <p className="mt-1 text-xs text-muted">
              예상 입력 토큰 합계(단순 합산) 약 {totalTokens.toLocaleString()}
              {anyAssumed && ' (일부 가정치)'}
            </p>
          </div>

          <LlmLimitBanner />

          <label className="flex items-center gap-2 text-sm text-primary">
            <input type="checkbox" checked={agreedCost} onChange={(e) => setAgreedCost(e.target.checked)} />
            위 예상 사용량을 확인했습니다.
          </label>

          {enqueueMutation.isError && (
            <p className="text-sm text-wrong">{errMsg(enqueueMutation.error, '변환 시작에 실패했습니다.')}</p>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep('chunks')}
              className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
            >
              ← 뒤로
            </button>
            <button
              type="button"
              disabled={!agreedCost || enqueueMutation.isPending}
              onClick={handleEnqueue}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              {enqueueMutation.isPending ? '시작 중…' : `선택 ${selectedGroups.length}조각 변환 시작`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
