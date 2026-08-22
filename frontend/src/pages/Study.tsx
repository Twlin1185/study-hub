import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import MarkdownView from '../components/MarkdownView'
import InlineRichText from '../components/markdown/InlineRichText'
import ProgressBar from '../components/ProgressBar'
import Stepper from '../components/Stepper'
import type { StepperStep } from '../components/Stepper'
import { api, ApiError } from '../api/client'
import { useStudyTrack, useStudyEvent } from '../api/study'
import { useDocument } from '../api/documents'
import { useSubmitAttempt, useCreateQuizSession } from '../api/quiz'
import { useCategoryTree, useCategoryTreePipeline } from '../api/categories'
import { useQuizSessionStore } from '../stores/quizSession'
import { useFontScale } from '../hooks/useFontScale'
import { useDocStyle } from '../hooks/useDocStyle'
import { findCategory, findNextSiblingId } from '../utils/tree'
import ReportErrorButton from '../components/ReportErrorButton'
import { CIRCLED_DIGITS, formatAnswer } from '../utils/answerFormat'
import type {
  AttemptResponse,
  CategoryStageProgress,
  DocumentType,
  QuizQuestion,
  StudyTrackItem,
} from '../api/types'

// F37 개념 트랙 = 하위 포함, concept+question 인터리브(기출 제외) — 설계 §5.5·§4.12.
const CONCEPT_TRACK_TYPES: DocumentType[] = ['concept', 'question']

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

function isQuestionType(type: string): boolean {
  return type === 'question' || type === 'past_question'
}

// 이번 세션에서 제출한 문제 답안 (완료 화면 정답률·틀린 문제 목록용) — 컴포넌트 로컬 상태.
interface SessionAnswer {
  my_answer: string
  result: AttemptResponse
}

// 설계 §5.5 — 학습 모드. 개념=Markdown, 문제=인라인 퀴즈 카드. 개념 "다음"=complete,
// 문제는 제출해야 다음 활성화. 진입·이동·이탈 시 position 이벤트 전송, 마지막 문서면 완료 화면.
export default function StudyPage() {
  const { categoryId: categoryIdParam } = useParams<{ categoryId: string }>()
  const categoryId = categoryIdParam ? Number(categoryIdParam) : null
  const [searchParams] = useSearchParams()
  const fromStart = searchParams.get('from') === 'start'

  // F37: 개념 트랙은 하위 포함·concept+question(기출 제외) — 설계 §5.5.
  const trackQuery = useStudyTrack(categoryId, { deep: true, types: CONCEPT_TRACK_TYPES })
  const studyEvent = useStudyEvent()

  const items = useMemo<StudyTrackItem[]>(() => trackQuery.data?.items ?? [], [trackQuery.data])

  const [index, setIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  const [session, setSession] = useState<Record<number, SessionAnswer>>({})
  // 집중 모드(F36-⑦) — 화면 로컬 상태(저장 안 함), Esc/토글로 복귀.
  const [focus, setFocus] = useState(false)
  const initRef = useRef<number | null>(null)

  // 집중 모드에서 Esc로 복귀 (설계 §5.5).
  useEffect(() => {
    if (!focus) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFocus(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus])

  // 시작 위치 결정: ?from=start면 처음부터, resume_document_id 있으면 그 위치, 없으면 첫 미완료.
  // categoryId가 바뀔 때만 수행 — 완료/제출 등 다른 갱신으로도 현재 위치를 잃지 않는다.
  useEffect(() => {
    if (!trackQuery.data || categoryId == null) return
    if (initRef.current === categoryId) return
    initRef.current = categoryId
    setFinished(false)
    setSession({})

    const its = trackQuery.data.items
    if (its.length === 0) {
      setIndex(0)
      return
    }
    if (fromStart) {
      setIndex(0)
      return
    }
    const resumeId = trackQuery.data.resume_document_id
    if (resumeId != null) {
      const i = its.findIndex((x) => x.document_id === resumeId)
      if (i >= 0) {
        setIndex(i)
        return
      }
    }
    const firstUndone = its.findIndex((x) => x.status !== 'done')
    setIndex(firstUndone >= 0 ? firstUndone : 0)
  }, [trackQuery.data, categoryId, fromStart])

  const current = !finished ? items[index] : undefined

  // 현재 문서 진입 시 position 이벤트 전송(invalidation 없는 경량 저장, 진도 변화 없음).
  const posRef = useRef<{ cat: number; doc: number } | null>(null)
  useEffect(() => {
    if (categoryId == null || current == null) return
    posRef.current = { cat: categoryId, doc: current.document_id }
    api
      .post('/study/events', { category_id: categoryId, document_id: current.document_id, action: 'position' })
      .catch(() => {})
  }, [categoryId, current?.document_id])

  // 페이지 이탈(unmount) 시에도 마지막 위치 전송.
  useEffect(() => {
    return () => {
      const p = posRef.current
      if (p) {
        api
          .post('/study/events', { category_id: p.cat, document_id: p.doc, action: 'position' })
          .catch(() => {})
      }
    }
  }, [])

  function advance() {
    if (index + 1 >= items.length) {
      setFinished(true)
    } else {
      setIndex(index + 1)
    }
  }

  function goPrev() {
    if (finished) {
      setFinished(false)
      setIndex(Math.max(0, items.length - 1))
      return
    }
    if (index > 0) setIndex(index - 1)
  }

  function handleConceptNext() {
    if (current == null || categoryId == null) return
    if (current.status !== 'done') {
      studyEvent.mutate({ category_id: categoryId, document_id: current.document_id, action: 'complete' })
    }
    advance()
  }

  function recordSession(documentId: number, myAnswer: string, result: AttemptResponse) {
    setSession((prev) => ({ ...prev, [documentId]: { my_answer: myAnswer, result } }))
  }

  // ---- 상태 렌더 ----
  if (categoryId == null) {
    return <p className="p-4 text-sm text-wrong">잘못된 접근입니다.</p>
  }
  if (trackQuery.isLoading) {
    return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  }
  if (trackQuery.isError) {
    return (
      <p className="p-4 text-sm text-wrong">{errMsg(trackQuery.error, '학습 트랙을 불러오지 못했습니다.')}</p>
    )
  }

  const track = trackQuery.data
  const categoryName = track?.category_name ?? ''

  // 연결된 문서가 없는 챕터 안내 (설계 §5.5 엣지 케이스).
  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <Link to="/curriculum" className="mb-3 inline-block text-sm text-muted hover:text-primary">
          ← 커리큘럼
        </Link>
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface p-5">
          <p className="text-sm font-medium text-primary">{categoryName || '이 챕터'}에 연결된 문서가 없습니다.</p>
          <p className="text-sm text-muted">탐색에서 개념·문제를 이 분류에 연결해 학습을 시작하세요.</p>
          <Link
            to={`/explore?category_id=${categoryId}`}
            className="mt-1 rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            탐색으로 이동
          </Link>
        </div>
      </div>
    )
  }

  const doneCount = items.filter((it) => it.status === 'done' || session[it.document_id] != null).length

  if (finished) {
    // 개념 트랙 완료 → 챕터 3단계 여정(문제→기출→최종 완료) — 설계 §5.5, F37.
    return (
      <ChapterJourney
        categoryId={categoryId}
        categoryName={categoryName}
        conceptItems={items}
        conceptSession={session}
        onReviewConcept={goPrev}
      />
    )
  }

  // 집중 모드(F36-⑦): 사이드바(데스크톱)·헤더(모바일)를 덮는 전체화면 오버레이. 모바일 하단 탭바는 유지.
  const wrapperClass = focus
    ? 'fixed inset-0 z-20 overflow-y-auto bg-bg md:z-40'
    : ''

  return (
    <div className={wrapperClass}>
      <div className="mx-auto max-w-xl p-4 pb-28">
        <div className="mb-3 flex items-center justify-between gap-2">
          {focus ? (
            <button type="button" onClick={() => setFocus(false)} className="text-sm text-muted hover:text-primary">
              ✕ 집중 모드 종료
            </button>
          ) : (
            <Link to="/curriculum" className="text-sm text-muted hover:text-primary">
              ← 나가기
            </Link>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm text-muted" title={categoryName}>
              {categoryName}
            </span>
            <button
              type="button"
              onClick={() => setFocus((v) => !v)}
              aria-pressed={focus}
              title={focus ? '집중 모드 종료 (Esc)' : '집중 모드'}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted hover:bg-bg hover:text-primary"
            >
              ⛶
            </button>
          </div>
        </div>

        <div className="mb-4">
          <ProgressBar value={items.length > 0 ? doneCount / items.length : 0} label={`${doneCount}/${items.length}`} />
        </div>

        {current && (
          <StudyCard
            key={current.document_id}
            item={current}
            categoryId={categoryId}
            answered={session[current.document_id]}
            onAnswered={recordSession}
          />
        )}

        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 pb-[env(safe-area-inset-bottom)] md:pb-0">
          <div className="mx-auto flex max-w-xl items-center gap-3 p-3 md:p-0">
            <button
              type="button"
              onClick={goPrev}
              disabled={index === 0}
              className="rounded border border-border bg-surface px-4 py-2.5 text-sm font-medium text-primary hover:bg-bg disabled:opacity-40"
            >
              ◀ 이전
            </button>
            {current && <NextButton item={current} answered={session[current.document_id]} onConceptNext={handleConceptNext} onNext={advance} isLast={index + 1 >= items.length} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// 개념/문제 공통 카드. 개념은 Markdown, 문제는 인라인 퀴즈 카드.
function StudyCard({
  item,
  categoryId,
  answered,
  onAnswered,
}: {
  item: StudyTrackItem
  categoryId: number
  answered: SessionAnswer | undefined
  onAnswered: (documentId: number, myAnswer: string, result: AttemptResponse) => void
}) {
  const docQuery = useDocument(item.document_id)
  // S28(F53 ①·⑤, 설계 §4.26) — 문서 지정값 > 전역 설정(study.font_scale) > 기본 토큰. 로딩 중에도
  // 훅 순서를 지키기 위해 이른 반환보다 앞에서 호출한다.
  const { scale: docScale, fontClassName: docFontClass, bgClassName: docBgClass } = useDocStyle(
    docQuery.data?.style,
  )
  const submitAttempt = useSubmitAttempt()
  const [cardShownAt, setCardShownAt] = useState(() => Date.now())
  // done 문제를 [다시 풀기]로 재도전하는 중인지 — 문서가 바뀌면 초기화(설계 §5.5).
  const [retryMode, setRetryMode] = useState(false)

  useEffect(() => {
    setCardShownAt(Date.now())
    setRetryMode(false)
  }, [item.document_id])

  if (docQuery.isLoading) {
    return <p className="text-sm text-muted">문서를 불러오는 중…</p>
  }
  if (docQuery.isError || !docQuery.data) {
    return <p className="text-sm text-wrong">{errMsg(docQuery.error, '문서를 불러오지 못했습니다.')}</p>
  }

  const doc = docQuery.data
  const question = isQuestionType(item.type)
  // 이미 done인 문제를 재방문한 경우(이번 세션 제출 없음) — [다시 풀기]를 누르기 전까지 잠금.
  // last_attempt가 있으면 이전 풀이를 복원해 보여주고, 없으면(과거 데이터) 안내 문구만 표시.
  const isDoneRevisit = question && item.status === 'done' && answered == null
  const locked = isDoneRevisit && !retryMode
  const lastAttempt = doc.stats.last_attempt

  function handleSelect(choiceIndex: number) {
    if (answered || locked) return
    const myAnswer = String(choiceIndex + 1)
    const timeSpent = Math.max(0, Math.round((Date.now() - cardShownAt) / 1000))
    submitAttempt.mutate(
      {
        document_id: item.document_id,
        category_id: categoryId,
        my_answer: myAnswer,
        time_spent: timeSpent,
        mode: 'study',
      },
      {
        onSuccess: (result) => onAnswered(item.document_id, myAnswer, result),
      },
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {item.doc_no}
          </span>
          <span className="text-xs text-muted">{question ? '문제' : '개념'}</span>
        </div>
        <ReportErrorButton documentId={item.document_id} variant="inline" />
      </div>

      {/* 개념: 본문 Markdown. 문제: 지문만 렌더 — 정답·해설은 제출 후에만 노출(서버 채점 원칙).
          S28 — 이 문서의 본문 렌더 영역에만 문서 스타일 적용(§4.26 ①·④). */}
      <div className={`mb-4 rounded-lg border border-border p-4 ${docBgClass || 'bg-surface'} ${docFontClass}`}>
        <h2 className="mb-2 text-base font-semibold text-primary">{doc.title}</h2>
        {/* docNo = 임베드 순환 검출의 시작점(F43) */}
        <MarkdownView content={doc.content} scale={docScale} docNo={item.doc_no} />
      </div>

      {question && (
        <div className="flex flex-col gap-2">
          {(doc.choices ?? []).map((choice, i) => {
            const value = String(i + 1)
            // 저장된 my_answer/answer는 공백이 섞였을 수 있다(서버는 정규화 비교로 채점) — trim 후 대조.
            const isMine =
              locked && lastAttempt ? lastAttempt.my_answer?.trim() === value : answered?.my_answer === value
            const isCorrectChoice =
              locked && lastAttempt ? doc.answer?.trim() === value : answered != null && answered.result.answer === value
            let stateClass = 'border-border bg-surface text-primary hover:bg-bg'
            if (answered || (locked && lastAttempt)) {
              if (isCorrectChoice) stateClass = 'border-correct bg-correct/10 text-correct'
              else if (isMine) stateClass = 'border-wrong bg-wrong/10 text-wrong'
            }
            return (
              <button
                key={i}
                type="button"
                disabled={answered != null || locked || submitAttempt.isPending}
                onClick={() => handleSelect(i)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${stateClass}`}
              >
                <span className="font-medium">{CIRCLED_DIGITS[i] ?? `${i + 1}.`}</span>
                <InlineRichText content={choice} scale={docScale} />
              </button>
            )
          })}
        </div>
      )}

      {question && locked && lastAttempt && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <p className="mb-2 text-xs font-medium text-muted">이미 완료한 문제 · 이전 풀이</p>
          <p className={`mb-2 text-sm font-semibold ${lastAttempt.is_correct ? 'text-correct' : 'text-wrong'}`}>
            {lastAttempt.is_correct ? '정답입니다' : '오답입니다'}
          </p>
          {doc.explanation != null && (
            <div className={`text-sm text-primary ${docFontClass}`}>
              <span className="font-semibold">해설</span>
              <MarkdownView content={doc.explanation} scale={docScale} />
            </div>
          )}
          <button
            type="button"
            onClick={() => setRetryMode(true)}
            className="mt-3 w-full rounded border border-accent bg-accent-soft px-3 py-2 text-sm font-medium text-accent hover:opacity-90"
          >
            다시 풀기
          </button>
        </div>
      )}

      {question && locked && !lastAttempt && (
        <div className="mt-3">
          <p className="text-sm text-muted">이미 완료한 문제입니다. 다음으로 진행하세요.</p>
          <button
            type="button"
            onClick={() => setRetryMode(true)}
            className="mt-2 w-full rounded border border-accent bg-accent-soft px-3 py-2 text-sm font-medium text-accent hover:opacity-90"
          >
            다시 풀기
          </button>
        </div>
      )}

      {answered && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <p className={`mb-2 text-sm font-semibold ${answered.result.is_correct ? 'text-correct' : 'text-wrong'}`}>
            {answered.result.is_correct ? '정답입니다' : '오답입니다'}
          </p>
          <div className={`text-sm text-primary ${docFontClass}`}>
            <span className="font-semibold">해설</span>
            <MarkdownView content={answered.result.explanation} scale={docScale} />
          </div>
        </div>
      )}
    </div>
  )
}

// 하단 [다음 ▶] — 개념은 항상 활성(complete 처리), 문제는 제출(또는 열람 모드)이어야 활성.
function NextButton({
  item,
  answered,
  onConceptNext,
  onNext,
  isLast,
}: {
  item: StudyTrackItem
  answered: SessionAnswer | undefined
  onConceptNext: () => void
  onNext: () => void
  isLast: boolean
}) {
  const question = isQuestionType(item.type)
  const label = isLast ? '완료 ▶' : '다음 ▶'

  if (!question) {
    return (
      <button
        type="button"
        onClick={onConceptNext}
        className="flex-1 rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
      >
        {label}
      </button>
    )
  }

  // 문제: 이번 세션에서 제출했거나 이미 done(열람 모드)이면 진행 가능.
  const canProceed = answered != null || item.status === 'done'
  return (
    <button
      type="button"
      onClick={onNext}
      disabled={!canProceed}
      className="flex-1 rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
    >
      {canProceed ? label : '문제를 풀어야 진행됩니다'}
    </button>
  )
}

// ---- 챕터 3단계 여정 (설계 §5.5, F37) ----
type JourneyStage = 'concept_done' | 'practice' | 'practice_done' | 'past' | 'final'

interface WrongEntry {
  document_id: number
  title: string
  my_answer: string
  answer: string
}

interface StageResult {
  answered: number
  correct: number
  wrong: WrongEntry[]
}

function accuracyPct(r: StageResult): number | null {
  return r.answered > 0 ? Math.round((r.correct / r.answered) * 100) : null
}

// 개념 트랙 완료 → 문제 → 기출 → 최종 완료. 단계 건너뛰기 가능, 문서 0개 단계 자동 생략.
function ChapterJourney({
  categoryId,
  categoryName,
  conceptItems,
  conceptSession,
  onReviewConcept,
}: {
  categoryId: number
  categoryName: string
  conceptItems: StudyTrackItem[]
  conceptSession: Record<number, SessionAnswer>
  onReviewConcept: () => void
}) {
  const navigate = useNavigate()
  const treeQuery = useCategoryTree()
  const pipelineQuery = useCategoryTreePipeline()
  const createSession = useCreateQuizSession()
  const startQuiz = useQuizSessionStore((s) => s.start)

  const [stage, setStage] = useState<JourneyStage>('concept_done')
  const [practiceResult, setPracticeResult] = useState<StageResult | null>(null)
  const [pastResult, setPastResult] = useState<StageResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 개념 트랙 내 문제(question) 정답 집계
  const conceptResult = useMemo<StageResult>(() => {
    const answered = conceptItems.filter((it) => conceptSession[it.document_id] != null)
    const correct = answered.filter((it) => conceptSession[it.document_id].result.is_correct)
    const wrong: WrongEntry[] = answered
      .filter((it) => !conceptSession[it.document_id].result.is_correct)
      .map((it) => ({
        document_id: it.document_id,
        title: it.title,
        my_answer: conceptSession[it.document_id].my_answer,
        answer: conceptSession[it.document_id].result.answer,
      }))
    return { answered: answered.length, correct: correct.length, wrong }
  }, [conceptItems, conceptSession])

  const stageProgress = useMemo<CategoryStageProgress | null>(() => {
    const node = pipelineQuery.data ? findCategory(pipelineQuery.data, categoryId) : null
    return node?.stage_progress ?? null
  }, [pipelineQuery.data, categoryId])
  // 파이프라인 미로딩 시엔 일단 제공(빈 세션이면 QuizStage가 자동 생략).
  const hasQuestion = stageProgress ? stageProgress.question.total > 0 : true
  const hasPast = stageProgress ? stageProgress.past_question.total > 0 : true

  const nextSiblingId = treeQuery.data ? findNextSiblingId(treeQuery.data, categoryId) : null

  function afterPractice(result: StageResult) {
    setPracticeResult(result)
    if (hasPast) setStage('past')
    else setStage('final')
  }

  function retryAllWrong() {
    const wrongIds = [
      ...conceptResult.wrong,
      ...(practiceResult?.wrong ?? []),
      ...(pastResult?.wrong ?? []),
    ].map((w) => w.document_id)
    const unique = Array.from(new Set(wrongIds))
    if (unique.length === 0) {
      setError('다시 풀 문제가 없습니다.')
      return
    }
    setError(null)
    // 특정 문서 지목 재도전은 sequential + document_ids (설계 §5.8).
    createSession.mutate(
      { category_id: categoryId, mode: 'sequential', count: unique.length, document_ids: unique },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) {
            setError('다시 풀 문제가 없습니다.')
            return
          }
          startQuiz(data.items, 'sequential', categoryId)
          navigate('/quiz/run')
        },
        onError: (e) => setError(errMsg(e, '재도전 세션을 시작하지 못했습니다.')),
      },
    )
  }

  function goNextChapter() {
    if (nextSiblingId != null) navigate(`/study/${nextSiblingId}?from=start`)
    else navigate('/curriculum')
  }

  // ---- 문제 단계 ----
  if (stage === 'practice') {
    return (
      <QuizStage
        key="practice"
        categoryId={categoryId}
        types={['question']}
        heading="챕터 연습문제"
        onExit={() => setStage('concept_done')}
        onComplete={afterPractice}
        onEmpty={() => {
          setPracticeResult({ answered: 0, correct: 0, wrong: [] })
          if (hasPast) setStage('past')
          else setStage('final')
        }}
      />
    )
  }
  if (stage === 'past') {
    return (
      <QuizStage
        key="past"
        categoryId={categoryId}
        types={['past_question']}
        heading="챕터 기출문제"
        onExit={() => setStage(practiceResult ? 'practice_done' : 'concept_done')}
        onComplete={(r) => {
          setPastResult(r)
          setStage('final')
        }}
        onEmpty={() => {
          setPastResult({ answered: 0, correct: 0, wrong: [] })
          setStage('final')
        }}
      />
    )
  }

  // ---- 단계 요약 화면들 ----
  const conceptAcc = accuracyPct(conceptResult)

  if (stage === 'concept_done') {
    return (
      <StageSummary title="개념 학습 완료 🎉" subtitle={categoryName} accuracy={conceptAcc} accuracyLabel="개념 문제 정답률">
        <div className="flex flex-col gap-2">
          {hasQuestion ? (
            <button
              type="button"
              onClick={() => setStage('practice')}
              className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
            >
              문제 풀이로 이어가기 ▶
            </button>
          ) : hasPast ? (
            <button
              type="button"
              onClick={() => setStage('past')}
              className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
            >
              기출로 마무리 ▶
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStage('final')}
              className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
            >
              완료 화면 보기 ▶
            </button>
          )}
          <button
            type="button"
            onClick={onReviewConcept}
            className="w-full rounded border border-border bg-surface px-4 py-2.5 text-sm font-medium text-primary hover:bg-bg"
          >
            개념 다시 보기
          </button>
          {(hasQuestion || hasPast) && (
            <button
              type="button"
              onClick={() => setStage('final')}
              className="w-full rounded border border-border bg-surface px-4 py-2 text-xs font-medium text-muted hover:bg-bg"
            >
              단계 건너뛰고 완료
            </button>
          )}
        </div>
      </StageSummary>
    )
  }

  if (stage === 'practice_done') {
    return (
      <StageSummary
        title="연습문제 완료"
        subtitle={categoryName}
        accuracy={practiceResult ? accuracyPct(practiceResult) : null}
        accuracyLabel="연습문제 정답률"
      >
        <div className="flex flex-col gap-2">
          {hasPast ? (
            <button
              type="button"
              onClick={() => setStage('past')}
              className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
            >
              기출로 마무리 ▶
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStage('final')}
              className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
            >
              완료 화면 보기 ▶
            </button>
          )}
        </div>
      </StageSummary>
    )
  }

  // ---- 최종 완료 화면: 단계별 정답률 Stepper + 틀린 문제 재도전 + 다음 챕터 ----
  const steps: StepperStep[] = [
    { key: 'concept', label: '개념', sublabel: conceptAcc != null ? `${conceptAcc}%` : '—', status: 'done' },
  ]
  if (practiceResult) {
    const acc = accuracyPct(practiceResult)
    steps.push({ key: 'practice', label: '문제', sublabel: acc != null ? `${acc}%` : '—', status: 'done' })
  }
  if (pastResult) {
    const acc = accuracyPct(pastResult)
    steps.push({ key: 'past', label: '기출', sublabel: acc != null ? `${acc}%` : '—', status: 'done' })
  }

  const allWrong = [
    ...conceptResult.wrong,
    ...(practiceResult?.wrong ?? []),
    ...(pastResult?.wrong ?? []),
  ]

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-1 text-xl font-semibold text-primary">챕터 완료 🎉</h1>
      <p className="mb-4 text-sm text-muted">{categoryName}</p>

      <div className="mb-4 rounded-lg border border-border bg-surface p-4">
        <p className="mb-3 text-sm font-semibold text-primary">단계별 정답률</p>
        <Stepper steps={steps} />
      </div>

      {allWrong.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">틀린 문제 ({allWrong.length})</h2>
          <div className="flex flex-col gap-2">
            {allWrong.map((w) => (
              <div key={w.document_id} className="rounded-lg border border-border bg-surface p-3">
                <p className="truncate text-sm text-primary" title={w.title}>
                  {w.title}
                </p>
                <p className="text-xs text-muted">
                  내 답: {formatAnswer(w.my_answer)} · 정답: {formatAnswer(w.answer)}
                </p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={retryAllWrong}
            disabled={createSession.isPending}
            className="mt-3 w-full rounded border border-accent bg-accent-soft px-4 py-2.5 text-sm font-medium text-accent hover:opacity-90 disabled:opacity-50"
          >
            {createSession.isPending ? '준비 중…' : '틀린 문제 다시 풀기'}
          </button>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-wrong">{error}</p>}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={goNextChapter}
          className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          {nextSiblingId != null ? '다음 챕터 ▶' : '커리큘럼으로 ▶'}
        </button>
        <button
          type="button"
          onClick={onReviewConcept}
          className="w-full rounded border border-border bg-surface px-4 py-2.5 text-sm font-medium text-primary hover:bg-bg"
        >
          개념 다시 보기
        </button>
      </div>
    </div>
  )
}

// 단계 요약 카드(공용) — 정답률 타일 + 자식 버튼.
function StageSummary({
  title,
  subtitle,
  accuracy,
  accuracyLabel,
  children,
}: {
  title: string
  subtitle: string
  accuracy: number | null
  accuracyLabel: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-1 text-xl font-semibold text-primary">{title}</h1>
      <p className="mb-4 text-sm text-muted">{subtitle}</p>
      {accuracy != null && (
        <div className="mb-4 rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{accuracy}%</p>
          <p className="text-xs text-muted">{accuracyLabel}</p>
        </div>
      )}
      {children}
    </div>
  )
}

// 인라인 퀴즈 단계 (문제/기출) — quiz/session{types} 로 출제, 결과를 부모로 반환.
function QuizStage({
  categoryId,
  types,
  heading,
  onComplete,
  onEmpty,
  onExit,
}: {
  categoryId: number
  types: DocumentType[]
  heading: string
  onComplete: (result: StageResult) => void
  onEmpty: () => void
  onExit: () => void
}) {
  const createSession = useCreateQuizSession()
  const submitAttempt = useSubmitAttempt()
  const fontScale = useFontScale()

  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, SessionAnswer>>({})
  const [cardShownAt, setCardShownAt] = useState(() => Date.now())
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    createSession.mutate(
      { category_id: categoryId, mode: 'sequential', count: 200, types },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) onEmpty()
          else setQuestions(data.items)
        },
        onError: (e) => setStartError(errMsg(e, '문제를 불러오지 못했습니다.')),
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setCardShownAt(Date.now())
  }, [index])

  function buildResult(map: Record<number, SessionAnswer>): StageResult {
    const list = questions ?? []
    const answered = list.filter((q) => map[q.document_id] != null)
    const correct = answered.filter((q) => map[q.document_id].result.is_correct)
    const wrong: WrongEntry[] = answered
      .filter((q) => !map[q.document_id].result.is_correct)
      .map((q) => ({
        document_id: q.document_id,
        title: q.title,
        my_answer: map[q.document_id].my_answer,
        answer: map[q.document_id].result.answer,
      }))
    return { answered: answered.length, correct: correct.length, wrong }
  }

  function handleSelect(choiceIndex: number) {
    if (!questions) return
    const q = questions[index]
    if (!q || answers[q.document_id] || submitAttempt.isPending) return
    const myAnswer = String(choiceIndex + 1)
    const timeSpent = Math.max(0, Math.round((Date.now() - cardShownAt) / 1000))
    submitAttempt.mutate(
      { document_id: q.document_id, category_id: categoryId, my_answer: myAnswer, time_spent: timeSpent, mode: 'quiz' },
      {
        onSuccess: (result) => setAnswers((prev) => ({ ...prev, [q.document_id]: { my_answer: myAnswer, result } })),
      },
    )
  }

  function next() {
    if (!questions) return
    if (index + 1 >= questions.length) {
      onComplete(buildResult(answers))
    } else {
      setIndex((i) => i + 1)
    }
  }

  if (startError) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <p className="mb-3 text-sm text-wrong">{startError}</p>
        <button
          type="button"
          onClick={onExit}
          className="rounded border border-border bg-surface px-4 py-2 text-sm text-primary hover:bg-bg"
        >
          ← 돌아가기
        </button>
      </div>
    )
  }
  if (!questions) {
    return <p className="p-4 text-sm text-muted">문제를 불러오는 중…</p>
  }

  const q = questions[index]
  const answered = answers[q.document_id]

  return (
    <div className="mx-auto max-w-xl p-4 pb-24">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={onExit} className="text-sm text-muted hover:text-primary">
          ← 돌아가기
        </button>
        <span className="text-sm text-muted">{heading}</span>
      </div>

      <div className="mb-4">
        <ProgressBar value={(index + 1) / questions.length} label={`${index + 1}/${questions.length}`} />
      </div>

      <div className="mb-4 rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-block rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {q.doc_no}
          </span>
          <ReportErrorButton documentId={q.document_id} variant="inline" />
        </div>
        <MarkdownView content={q.content} scale={fontScale} />
      </div>

      <div className="flex flex-col gap-2">
        {(q.choices ?? []).map((choice, i) => {
          const value = String(i + 1)
          const isMine = answered?.my_answer === value
          const isCorrectChoice = answered != null && answered.result.answer === value
          let stateClass = 'border-border bg-surface text-primary hover:bg-bg'
          if (answered) {
            if (isCorrectChoice) stateClass = 'border-correct bg-correct/10 text-correct'
            else if (isMine) stateClass = 'border-wrong bg-wrong/10 text-wrong'
          }
          return (
            <button
              key={i}
              type="button"
              disabled={answered != null || submitAttempt.isPending}
              onClick={() => handleSelect(i)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${stateClass}`}
            >
              <span className="font-medium">{CIRCLED_DIGITS[i] ?? `${i + 1}.`}</span>
              <InlineRichText content={choice} scale={fontScale} />
            </button>
          )
        })}
      </div>

      {answered && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <p className={`mb-2 text-sm font-semibold ${answered.result.is_correct ? 'text-correct' : 'text-wrong'}`}>
            {answered.result.is_correct ? '정답입니다' : '오답입니다'}
          </p>
          <div className="text-sm text-primary">
            <span className="font-semibold">해설</span>
            <MarkdownView content={answered.result.explanation} scale={fontScale} />
          </div>
        </div>
      )}

      {answered && (
        <button
          type="button"
          onClick={next}
          className="mt-4 w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          {index + 1 >= questions.length ? '단계 완료' : '다음'}
        </button>
      )}
    </div>
  )
}
