import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MarkdownView from '../components/MarkdownView'
import FlipCard from '../components/FlipCard'
import ProgressBar from '../components/ProgressBar'
import ConfirmDialog from '../components/ConfirmDialog'
import { useSrsToday, useSrsAnswer, useSrsSummary } from '../api/srs'
import { useContinueList } from '../api/study'
import { useSubmitAttempt } from '../api/quiz'
import { useStreak } from '../api/stats'
import { useFontScale } from '../hooks/useFontScale'
import { ApiError } from '../api/client'
import type { FontScale } from '../api/types'
import { FLASHCARD_Q_DONT_KNOW, FLASHCARD_Q_KNOW } from '../stores/flashcardSession'
import type { AttemptResponse, DocumentType, SrsQueueItem } from '../api/types'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

function isQuestionLike(type: DocumentType): boolean {
  return type === 'question' || type === 'past_question'
}

function formatAnswer(answer: string | null | undefined): string {
  if (!answer || !answer.trim()) return '-'
  const trimmed = answer.trim()
  if (/^[1-9]$/.test(trimmed)) return `${CIRCLED_DIGITS[Number(trimmed) - 1] ?? trimmed} (${trimmed})`
  return trimmed
}

interface QuizAnswerRecord {
  my_answer: string
  result: AttemptResponse
}

// stage-5 복습 세션 (혼합 큐). srs/today를 순서대로 소화 —
// question/past_question은 퀴즈 카드 + attempts(mode:'review'), concept/flashcard는 뒤집기 카드 + srs/answer.
// 큐 항목이 카드 콘텐츠(content/choices/answer/explanation)를 직접 실어주므로 별도 조회 없이 렌더한다.
// 세션은 이 페이지의 지역 상태로만 관리(지정된 zustand 스토어 3개 외 신규 스토어 도입 회피).
export default function ReviewPage() {
  const todayQuery = useSrsToday()
  const items = todayQuery.data ?? []

  if (todayQuery.isLoading) {
    return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  }
  if (todayQuery.isError) {
    return <p className="p-4 text-sm text-wrong">{errMsg(todayQuery.error, '복습 큐를 불러오지 못했습니다.')}</p>
  }
  if (items.length === 0) {
    return <ReviewEmpty />
  }

  return <ReviewSession items={items} />
}

function ReviewEmpty() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-md p-4">
      <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-5">
        <p className="text-sm font-medium text-primary">오늘 복습할 항목이 없습니다.</p>
        <p className="text-sm text-muted">문제를 풀거나 플래시카드를 판정하면 복습 큐가 채워집니다.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          홈으로
        </button>
      </div>
    </div>
  )
}

function ReviewSession({ items: itemsProp }: { items: SrsQueueItem[] }) {
  const navigate = useNavigate()
  const submitAttempt = useSubmitAttempt()
  const srsAnswer = useSrsAnswer()
  const fontScale = useFontScale()

  // 세션 중 attempts/srs.answer가 srs/today를 무효화→재조회하면 items가 뒤바뀔 수 있으므로
  // 세션 시작 시점의 큐를 한 번만 스냅샷해 순서를 고정한다.
  const [items] = useState(itemsProp)

  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [finished, setFinished] = useState(false)
  const [exitConfirm, setExitConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quizAnswers, setQuizAnswers] = useState<Record<number, QuizAnswerRecord>>({})
  const [flipResults, setFlipResults] = useState<Record<number, number>>({})

  // 뒤집기 카드 판정 전송 지연 + undo (설계 §5.7, F36-⑧). ref=로직 · state=UI 갱신용 미러.
  const pendingFlipRef = useRef<{ document_id: number; q: number; index: number } | null>(null)
  const [pendingFlip, setPendingFlipState] = useState<{ document_id: number; q: number; index: number } | null>(null)
  function setPendingFlip(p: { document_id: number; q: number; index: number } | null) {
    pendingFlipRef.current = p
    setPendingFlipState(p)
  }
  function flushFlip() {
    const p = pendingFlipRef.current
    if (p) {
      srsAnswer.mutate({ document_id: p.document_id, q: p.q })
      setPendingFlip(null)
    }
  }

  // 세션 이탈(라우팅 등 unmount) 시 미확정 판정을 빠짐없이 확정 전송 (검토 지시 2).
  useEffect(() => {
    return () => {
      const p = pendingFlipRef.current
      if (p) srsAnswer.mutate({ document_id: p.document_id, q: p.q })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cardShownAtRef = useRef<number>(Date.now())
  useEffect(() => {
    cardShownAtRef.current = Date.now()
    setFlipped(false)
    setError(null)
  }, [index])

  const current = items[index]
  const isQuestion = current ? isQuestionLike(current.type) : false
  const answered = current ? quizAnswers[current.document_id] : undefined

  function advance() {
    if (index + 1 >= items.length) {
      setFinished(true)
    } else {
      setIndex((i) => i + 1)
    }
  }

  function handleSelectQuiz(choiceIndex: number) {
    if (!current || answered || submitAttempt.isPending) return
    // 퀴즈 카드로 진입했으니 직전 뒤집기 판정이 남아있으면 확정 전송.
    flushFlip()
    const myAnswer = String(choiceIndex + 1)
    const timeSpent = Math.max(0, Math.round((Date.now() - cardShownAtRef.current) / 1000))
    submitAttempt.mutate(
      { document_id: current.document_id, my_answer: myAnswer, time_spent: timeSpent, mode: 'review' },
      {
        onSuccess: (result) =>
          setQuizAnswers((prev) => ({ ...prev, [current.document_id]: { my_answer: myAnswer, result } })),
        onError: (e) => setError(errMsg(e, '제출에 실패했습니다.')),
      },
    )
  }

  // 전송 지연(F36-⑧): 판정은 즉시 기록·진행, 서버 확정은 다음 카드 진입/세션 종료로 미룬다.
  // 마지막 카드도 지연 — 완료 화면에서 undo 가능, 이탈 시 확정(검토 지시 2).
  function handleJudgeFlip(q: number) {
    if (!current) return
    setError(null)
    flushFlip() // 직전 pending 확정 전송
    setFlipResults((prev) => ({ ...prev, [current.document_id]: q }))
    setPendingFlip({ document_id: current.document_id, q, index })
    if (index + 1 >= items.length) {
      setFinished(true)
    } else {
      setIndex((i) => i + 1)
    }
  }

  function handleUndoFlip() {
    const p = pendingFlipRef.current
    if (!p) return
    setFlipResults((prev) => {
      const next = { ...prev }
      delete next[p.document_id]
      return next
    })
    setPendingFlip(null)
    setFlipped(false)
    setFinished(false) // 완료 화면에서 되돌리면 마지막 카드로 복귀 (검토 지시 2)
    setIndex(p.index)
  }

  // 키보드: 뒤집기 카드에서만 스페이스=뒤집기, ←=모른다, →=안다 (§5.7과 동일 규약)
  useEffect(() => {
    if (finished || isQuestion) return
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        setFlipped((v) => !v)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleJudgeFlip(FLASHCARD_Q_DONT_KNOW)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleJudgeFlip(FLASHCARD_Q_KNOW)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, isQuestion, index, srsAnswer.isPending])

  if (finished) {
    return (
      <ReviewSummary
        items={items}
        quizAnswers={quizAnswers}
        flipResults={flipResults}
        canUndo={pendingFlip != null}
        onUndo={handleUndoFlip}
        onBeforeLeave={flushFlip}
      />
    )
  }
  if (!current) return null

  return (
    <div className="mx-auto max-w-xl p-4 pb-24">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setExitConfirm(true)} className="text-sm text-muted hover:text-primary">
          ✕ 종료
        </button>
        <span className="text-sm text-muted">남은 {items.length - index}개</span>
      </div>

      <div className="mb-4">
        <ProgressBar value={index / items.length} label={`${index + 1}/${items.length}`} />
      </div>

      {/* 미확정 뒤집기 판정이 남은 채 퀴즈 카드로 넘어온 경우 — 제출 전까지 되돌리기 노출 (검토 지시 1) */}
      {isQuestion && pendingFlip != null && (
        <button
          type="button"
          onClick={handleUndoFlip}
          className="mb-3 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg"
        >
          ↩ 이전 판정 되돌리기
        </button>
      )}

      {isQuestion ? (
        <QuizReviewCard
          item={current}
          answered={answered}
          pending={submitAttempt.isPending}
          fontScale={fontScale}
          onSelect={handleSelectQuiz}
          onNext={advance}
        />
      ) : (
        <FlipReviewCard
          key={current.document_id}
          item={current}
          flipped={flipped}
          fontScale={fontScale}
          onFlip={() => setFlipped((v) => !v)}
          onJudge={handleJudgeFlip}
          canUndo={pendingFlip != null}
          onUndo={handleUndoFlip}
        />
      )}

      {error && <p className="mt-3 text-center text-sm text-wrong">{error}</p>}

      {exitConfirm && (
        <ConfirmDialog
          title="복습 종료"
          message="지금 나가면 남은 항목은 다음에 다시 나타납니다. 종료할까요?"
          confirmLabel="종료"
          danger
          onClose={() => setExitConfirm(false)}
          onConfirm={() => {
            flushFlip()
            navigate('/')
          }}
        />
      )}
    </div>
  )
}

function QuizReviewCard({
  item,
  answered,
  pending,
  fontScale,
  onSelect,
  onNext,
}: {
  item: SrsQueueItem
  answered: QuizAnswerRecord | undefined
  pending: boolean
  fontScale: FontScale
  onSelect: (choiceIndex: number) => void
  onNext: () => void
}) {
  return (
    <>
      <div className="mb-4 rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-block rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {item.doc_no}
          </span>
          {item.has_review_note && (
            <span className="inline-block rounded bg-wrong/10 px-2 py-0.5 text-xs font-medium text-wrong">
              오답노트
            </span>
          )}
        </div>
        <MarkdownView content={item.content} scale={fontScale} />
      </div>

      <div className="flex flex-col gap-2">
        {(item.choices ?? []).map((choice, i) => {
          const value = String(i + 1)
          const isMine = answered?.my_answer === value
          const isCorrectChoice = answered !== undefined && answered.result.answer === value
          let stateClass = 'border-border bg-surface text-primary hover:bg-bg'
          if (answered) {
            if (isCorrectChoice) stateClass = 'border-correct bg-correct/10 text-correct'
            else if (isMine) stateClass = 'border-wrong bg-wrong/10 text-wrong'
          }
          return (
            <button
              key={i}
              type="button"
              disabled={Boolean(answered) || pending}
              onClick={() => onSelect(i)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${stateClass}`}
            >
              <span className="font-medium">{CIRCLED_DIGITS[i] ?? `${i + 1}.`}</span>
              <span>{choice}</span>
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
          onClick={onNext}
          className="mt-4 w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          다음
        </button>
      )}
    </>
  )
}

function FlipReviewCard({
  item,
  flipped,
  fontScale,
  onFlip,
  onJudge,
  canUndo,
  onUndo,
}: {
  item: SrsQueueItem
  flipped: boolean
  fontScale: FontScale
  onFlip: () => void
  onJudge: (q: number) => void
  canUndo: boolean
  onUndo: () => void
}) {
  // 큐 항목이 콘텐츠를 직접 실어준다(§4.7) — 별도 documents/{id} 조회 없이 렌더.
  const isConcept = item.type === 'concept'

  const front = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{item.doc_no}</span>
        <span className="text-xs text-muted">{isConcept ? '개념' : '플래시카드'} · 앞면</span>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        {isConcept ? (
          <p className="text-base font-medium text-primary">{item.title}</p>
        ) : (
          <MarkdownView content={item.content ?? item.title} scale={fontScale} />
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted">탭 / 스페이스로 뒤집기</p>
    </>
  )

  const back = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{item.doc_no}</span>
        <span className="text-xs text-muted">뒷면</span>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2 overflow-y-auto">
        {item.answer && !isConcept && (
          <p className="text-sm text-primary">
            <span className="font-semibold">정답: </span>
            {formatAnswer(item.answer)}
          </p>
        )}
        <MarkdownView
          content={isConcept ? (item.content ?? '내용 없음') : (item.explanation ?? item.content ?? '내용 없음')}
          scale={fontScale}
        />
      </div>
      <p className="mt-3 text-center text-xs text-muted">← 모른다 · 안다 →</p>
    </>
  )

  return (
    <>
      <FlipCard
        flipped={flipped}
        front={front}
        back={back}
        onFlip={onFlip}
        onSwipeLeft={() => onJudge(FLASHCARD_Q_DONT_KNOW)}
        onSwipeRight={() => onJudge(FLASHCARD_Q_KNOW)}
      />
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={() => onJudge(FLASHCARD_Q_DONT_KNOW)}
          className="flex-1 rounded-lg border border-wrong px-4 py-3 text-sm font-medium text-wrong hover:bg-wrong/10"
        >
          모른다
        </button>
        <button
          type="button"
          onClick={() => onJudge(FLASHCARD_Q_KNOW)}
          className="flex-1 rounded-lg border border-correct px-4 py-3 text-sm font-medium text-correct hover:bg-correct/10"
        >
          안다
        </button>
      </div>
      {/* 판정 undo 1회 (설계 §5.7, F36-⑧) — 직전 판정 미전송 취소 */}
      {canUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="mt-3 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg"
        >
          ↩ 직전 판정 되돌리기
        </button>
      )}
    </>
  )
}

function ReviewSummary({
  items,
  quizAnswers,
  flipResults,
  canUndo,
  onUndo,
  onBeforeLeave,
}: {
  items: SrsQueueItem[]
  quizAnswers: Record<number, QuizAnswerRecord>
  flipResults: Record<number, number>
  canUndo: boolean
  onUndo: () => void
  onBeforeLeave: () => void
}) {
  const navigate = useNavigate()
  const summaryQuery = useSrsSummary()
  const continueQuery = useContinueList()
  const streakQuery = useStreak()

  // 완료 화면 이탈 시 미확정 마지막 판정을 확정 전송 (검토 지시 2).
  function leave(to: string) {
    onBeforeLeave()
    navigate(to)
  }
  const quizItems = items.filter((it) => isQuestionLike(it.type))
  const flipItems = items.filter((it) => !isQuestionLike(it.type))
  const quizCorrect = quizItems.filter((it) => quizAnswers[it.document_id]?.result.is_correct).length
  const quizDone = quizItems.filter((it) => quizAnswers[it.document_id]).length
  const flipKnew = flipItems.filter((it) => (flipResults[it.document_id] ?? 0) >= 3).length
  const flipDone = flipItems.filter((it) => flipResults[it.document_id] != null).length

  const tomorrowDue = summaryQuery.data?.tomorrow_due
  const nextCard = continueQuery.data?.[0] ?? null

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl font-semibold text-primary">복습 완료 🎉</h1>
      <div className="mb-4 grid grid-cols-2 gap-3">
        {quizItems.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-4 text-center">
            <p className="text-2xl font-semibold text-primary">
              {quizCorrect}/{quizDone}
            </p>
            <p className="text-xs text-muted">문제 정답</p>
          </div>
        )}
        {flipItems.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-4 text-center">
            <p className="text-2xl font-semibold text-primary">
              {flipKnew}/{flipDone}
            </p>
            <p className="text-xs text-muted">카드 안다</p>
          </div>
        )}
      </div>

      {/* 오늘의 마무리 (설계 §5.7, F36-③ + S10 F26 연계) — 스트릭 배지와 내일 예고를 나란히.
          streak 데이터는 서버 파생값을 그대로 표시만 한다(재계산 금지). */}
      {(tomorrowDue != null || streakQuery.data) && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {streakQuery.data && streakQuery.data.current_streak > 0 && (
            <div className="rounded-lg border border-border bg-accent-soft p-4 text-center">
              <p className="text-sm text-accent">
                <span className="font-semibold">{streakQuery.data.current_streak}일</span> 연속 학습 중
              </p>
              {streakQuery.data.today.goal_met && (
                <p className="mt-1 text-xs font-medium text-correct">오늘 목표 달성</p>
              )}
            </div>
          )}
          {tomorrowDue != null && (
            <div className="rounded-lg border border-border bg-accent-soft p-4 text-center">
              <p className="text-sm text-accent">
                내일 <span className="font-semibold">{tomorrowDue}개</span> 복습 예정
              </p>
            </div>
          )}
        </div>
      )}

      {/* 마지막 판정 되돌리기 (검토 지시 2) — 완료 화면 진입 즉시 flush하지 않고 여기서 취소 가능 */}
      {canUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="mb-3 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg"
        >
          ↩ 마지막 판정 되돌리기
        </button>
      )}

      <div className="flex flex-col gap-2">
        {/* 이어하기로 계속 (설계 §5.7, F36-③) — daily_start 여정 후반부 */}
        {nextCard && (
          <button
            type="button"
            onClick={() => leave(`/study/${nextCard.category_id}`)}
            className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            이어하기로 계속 ▶
          </button>
        )}
        <button
          type="button"
          onClick={() => leave('/')}
          className={`w-full rounded px-4 py-2.5 text-sm font-medium ${
            nextCard
              ? 'border border-border bg-surface text-primary hover:bg-bg'
              : 'bg-accent text-on-accent hover:opacity-90'
          }`}
        >
          홈으로
        </button>
      </div>
    </div>
  )
}
