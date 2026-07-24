import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import MarkdownView from '../components/MarkdownView'
import ProgressBar from '../components/ProgressBar'
import { api, ApiError } from '../api/client'
import { useStudyTrack, useStudyEvent } from '../api/study'
import { useDocument } from '../api/documents'
import { useSubmitAttempt, useCreateQuizSession } from '../api/quiz'
import { useCategoryTree } from '../api/categories'
import { useQuizSessionStore } from '../stores/quizSession'
import { findNextSiblingId } from '../utils/tree'
import ReportErrorButton from '../components/ReportErrorButton'
import type { AttemptResponse, StudyTrackItem } from '../api/types'

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

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

  const trackQuery = useStudyTrack(categoryId)
  const studyEvent = useStudyEvent()

  const items = useMemo<StudyTrackItem[]>(() => trackQuery.data?.items ?? [], [trackQuery.data])

  const [index, setIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  const [session, setSession] = useState<Record<number, SessionAnswer>>({})
  const initRef = useRef<number | null>(null)

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
    return (
      <ChapterComplete
        categoryId={categoryId}
        categoryName={categoryName}
        items={items}
        session={session}
        onReview={goPrev}
      />
    )
  }

  return (
    <div className="mx-auto max-w-xl p-4 pb-28">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link to="/curriculum" className="text-sm text-muted hover:text-primary">
          ← 나가기
        </Link>
        <span className="truncate text-sm text-muted" title={categoryName}>
          {categoryName}
        </span>
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

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
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

      {/* 개념: 본문 Markdown. 문제: 지문만 렌더 — 정답·해설은 제출 후에만 노출(서버 채점 원칙). */}
      <div className="mb-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-base font-semibold text-primary">{doc.title}</h2>
        <MarkdownView content={doc.content} />
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
                <span>{choice}</span>
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
            <div className="text-sm text-primary">
              <span className="font-semibold">해설</span>
              <MarkdownView content={doc.explanation} />
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
          <div className="text-sm text-primary">
            <span className="font-semibold">해설</span>
            <MarkdownView content={answered.result.explanation} />
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

// 챕터 완료 화면 — 이번 세션 정답률 + 틀린 문제 + [지금 다시 풀기] + [다음 챕터 ▶].
function ChapterComplete({
  categoryId,
  categoryName,
  items,
  session,
  onReview,
}: {
  categoryId: number
  categoryName: string
  items: StudyTrackItem[]
  session: Record<number, SessionAnswer>
  onReview: () => void
}) {
  const navigate = useNavigate()
  const treeQuery = useCategoryTree()
  const createSession = useCreateQuizSession()
  const startQuiz = useQuizSessionStore((s) => s.start)
  const [error, setError] = useState<string | null>(null)

  const answeredItems = items.filter((it) => session[it.document_id] != null)
  const correctCount = answeredItems.filter((it) => session[it.document_id].result.is_correct).length
  const answeredCount = answeredItems.length
  const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null
  const wrongItems = answeredItems.filter((it) => !session[it.document_id].result.is_correct)

  const nextSiblingId = treeQuery.data ? findNextSiblingId(treeQuery.data, categoryId) : null

  function retryWrong() {
    setError(null)
    createSession.mutate(
      { category_id: categoryId, mode: 'wrong_only', count: Math.max(wrongItems.length, 1) },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) {
            setError('다시 풀 문제가 없습니다.')
            return
          }
          startQuiz(data.items, 'wrong_only', categoryId)
          navigate('/quiz/run')
        },
        onError: (e) => setError(errMsg(e, '재도전 세션을 시작하지 못했습니다.')),
      },
    )
  }

  function goNextChapter() {
    if (nextSiblingId != null) {
      navigate(`/study/${nextSiblingId}?from=start`)
    } else {
      navigate('/curriculum')
    }
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-1 text-xl font-semibold text-primary">챕터 완료 🎉</h1>
      <p className="mb-4 text-sm text-muted">{categoryName}</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{accuracy != null ? `${accuracy}%` : '-'}</p>
          <p className="text-xs text-muted">
            이번 세션 정답률{answeredCount > 0 ? ` (${correctCount}/${answeredCount})` : ''}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{items.length}</p>
          <p className="text-xs text-muted">완료한 문서</p>
        </div>
      </div>

      {answeredCount === 0 && (
        <p className="mb-4 text-sm text-muted">이번 세션에 새로 푼 문제가 없습니다.</p>
      )}

      {wrongItems.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">틀린 문제 ({wrongItems.length})</h2>
          <div className="flex flex-col gap-2">
            {wrongItems.map((it) => (
              <div key={it.document_id} className="rounded-lg border border-border bg-surface p-3">
                <p className="truncate text-sm text-primary" title={it.title}>
                  {it.title}
                </p>
                <p className="text-xs text-muted">
                  내 답: {session[it.document_id].my_answer} · 정답: {session[it.document_id].result.answer}
                </p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={retryWrong}
            disabled={createSession.isPending}
            className="mt-3 w-full rounded border border-accent bg-accent-soft px-4 py-2.5 text-sm font-medium text-accent hover:opacity-90 disabled:opacity-50"
          >
            {createSession.isPending ? '준비 중…' : '지금 다시 풀기'}
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
          onClick={onReview}
          className="w-full rounded border border-border bg-surface px-4 py-2.5 text-sm font-medium text-primary hover:bg-bg"
        >
          다시 보기
        </button>
      </div>
    </div>
  )
}
