import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MarkdownView from '../components/MarkdownView'
import ConfirmDialog from '../components/ConfirmDialog'
import ProgressBar from '../components/ProgressBar'
import BookmarkButton from '../components/BookmarkButton'
import { useQuizSessionStore } from '../stores/quizSession'
import type { QuizAnswerRecord } from '../stores/quizSession'
import { useSubmitAttempt } from '../api/quiz'
import { useUpdateReviewNote } from '../api/reviewNotes'
import { useDocument } from '../api/documents'
import type { QuizQuestion } from '../api/types'

const RELATION_LABEL: Record<string, string> = {
  explains: '설명',
  related: '관련',
  prerequisite: '선행 개념',
}

// 해설 영역의 "관련 개념 바로가기" — quiz/session 응답엔 relations가 없어(서버 채점 원칙, §8)
// 정답 공개 이후 문서 상세를 조회해 relations를 가져온다 (설계 §5.6).
function RelatedConceptLinks({ documentId }: { documentId: number }) {
  const navigate = useNavigate()
  const docQuery = useDocument(documentId)
  const relations = docQuery.data?.relations ?? []
  if (relations.length === 0) return null

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-1.5 text-xs font-semibold text-muted">관련 개념</p>
      <div className="flex flex-wrap gap-1.5">
        {relations.map((rel) => (
          <button
            key={`${rel.document_id}-${rel.relation}-${rel.direction}`}
            type="button"
            onClick={() => navigate(`/docs/${rel.document_id}`)}
            className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent hover:opacity-80"
            title={rel.title}
          >
            {RELATION_LABEL[rel.relation] ?? rel.relation} · {rel.title}
          </button>
        ))}
      </div>
    </div>
  )
}

// 퀴즈 카드 북마크 별 — QuizQuestionOut(quiz/session 응답)엔 bookmarked 필드가 없어(백엔드
// schemas/quiz.py와 대조 완료) 문서 상세를 조회해 실제 상태를 표시한다. 낙관적 업데이트는
// useToggleBookmark가 documents 상세 캐시를 직접 갱신하므로 이 조회에도 즉시 반영된다.
function QuizCardBookmark({ documentId }: { documentId: number }) {
  const docQuery = useDocument(documentId)
  return <BookmarkButton documentId={documentId} bookmarked={docQuery.data?.bookmarked ?? false} size="sm" />
}

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 설계 §5.6 — 퀴즈 화면. 문제 카드 선택 즉시 attempts 제출 → 정오 색상 + 해설 노출 → [다음].
// 세션 상태(문항·답안·타이머)는 전역 zustand quizSession 스토어(설계 §7).
export default function QuizRunPage() {
  const navigate = useNavigate()
  const status = useQuizSessionStore((s) => s.status)
  const questions = useQuizSessionStore((s) => s.questions)
  const currentIndex = useQuizSessionStore((s) => s.currentIndex)
  const answers = useQuizSessionStore((s) => s.answers)
  const categoryId = useQuizSessionStore((s) => s.categoryId)
  const startedAt = useQuizSessionStore((s) => s.startedAt)
  const finishedAt = useQuizSessionStore((s) => s.finishedAt)
  const cardShownAt = useQuizSessionStore((s) => s.cardShownAt)
  const recordAnswer = useQuizSessionStore((s) => s.recordAnswer)
  const goNext = useQuizSessionStore((s) => s.goNext)
  const reset = useQuizSessionStore((s) => s.reset)

  const submitAttempt = useSubmitAttempt()
  const updateReviewNote = useUpdateReviewNote()

  const [exitConfirm, setExitConfirm] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // 새로고침/닫기 시 세션 종료 확인 (설계 §5.6 — 진행 중인 세션 이탈은 브라우저 경고)
  useEffect(() => {
    if (status !== 'active') return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [status])

  // 상단 경과 시간 표시 — 1초 tick
  useEffect(() => {
    if (status !== 'active') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [status])

  useEffect(() => {
    if (status === 'idle') {
      navigate('/quiz', { replace: true })
    }
  }, [status, navigate])

  if (status === 'idle') return null

  if (status === 'finished') {
    return (
      <QuizSummary
        questions={questions}
        answers={answers}
        elapsedMs={(finishedAt ?? now) - (startedAt ?? now)}
        updateReviewNote={updateReviewNote}
        onExit={() => {
          reset()
          navigate('/quiz')
        }}
      />
    )
  }

  const question = questions[currentIndex]
  const answered = answers[question.document_id]
  const elapsed = formatElapsed(now - (startedAt ?? now))

  function handleSelect(choiceIndex: number) {
    if (answered) return
    const timeSpent = cardShownAt ? Math.max(0, Math.round((Date.now() - cardShownAt) / 1000)) : 0
    const myAnswer = String(choiceIndex + 1)
    submitAttempt.mutate(
      {
        document_id: question.document_id,
        category_id: categoryId ?? undefined,
        my_answer: myAnswer,
        time_spent: timeSpent,
        mode: 'quiz',
      },
      {
        onSuccess: (result) => {
          recordAnswer(question.document_id, myAnswer, timeSpent, result)
        },
      },
    )
  }

  return (
    <div className="mx-auto max-w-xl p-4 pb-24">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setExitConfirm(true)} className="text-sm text-muted hover:text-primary">
          ✕ 종료
        </button>
        <span className="text-sm text-muted">{elapsed}</span>
      </div>

      <div className="mb-4">
        <ProgressBar
          value={(currentIndex + 1) / questions.length}
          label={`${currentIndex + 1}/${questions.length}`}
        />
      </div>

      <div className="mb-4 rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-block rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {question.doc_no}
          </span>
          <QuizCardBookmark documentId={question.document_id} />
        </div>
        <MarkdownView content={question.content} />
      </div>

      <div className="flex flex-col gap-2">
        {(question.choices ?? []).map((choice, i) => {
          const value = String(i + 1)
          const isMine = answered?.my_answer === value
          const isCorrectChoice = Boolean(answered) && answered.result.answer === value
          let stateClass = 'border-border bg-surface text-primary hover:bg-bg'
          if (answered) {
            if (isCorrectChoice) stateClass = 'border-correct bg-correct/10 text-correct'
            else if (isMine) stateClass = 'border-wrong bg-wrong/10 text-wrong'
          }
          return (
            <button
              key={i}
              type="button"
              disabled={Boolean(answered) || submitAttempt.isPending}
              onClick={() => handleSelect(i)}
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
            <MarkdownView content={answered.result.explanation} />
          </div>
          <RelatedConceptLinks documentId={question.document_id} />
        </div>
      )}

      {answered && (
        <button
          type="button"
          onClick={goNext}
          className="mt-4 w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          {currentIndex + 1 >= questions.length ? '결과 보기' : '다음'}
        </button>
      )}

      {exitConfirm && (
        <ConfirmDialog
          title="퀴즈 종료"
          message="지금 나가면 이번 세션 진행 상황이 사라집니다. 종료할까요?"
          confirmLabel="종료"
          danger
          onClose={() => setExitConfirm(false)}
          onConfirm={() => {
            reset()
            navigate('/quiz')
          }}
        />
      )}
    </div>
  )
}

function QuizSummary({
  questions,
  answers,
  elapsedMs,
  updateReviewNote,
  onExit,
}: {
  questions: QuizQuestion[]
  answers: Record<number, QuizAnswerRecord>
  elapsedMs: number
  updateReviewNote: ReturnType<typeof useUpdateReviewNote>
  onExit: () => void
}) {
  const total = questions.length
  const correctCount = questions.filter((q) => answers[q.document_id]?.result.is_correct).length
  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0
  const wrongQuestions = questions.filter((q) => answers[q.document_id] && !answers[q.document_id].result.is_correct)

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl font-semibold text-primary">퀴즈 결과</h1>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{accuracy}%</p>
          <p className="text-xs text-muted">
            정답률 ({correctCount}/{total})
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{formatElapsed(elapsedMs)}</p>
          <p className="text-xs text-muted">소요 시간</p>
        </div>
      </div>

      {wrongQuestions.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">틀린 문제</h2>
          <div className="flex flex-col gap-2">
            {wrongQuestions.map((q) => (
              <WrongQuestionRow
                key={q.document_id}
                question={q}
                answer={answers[q.document_id]}
                updateReviewNote={updateReviewNote}
              />
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onExit}
        className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
      >
        퀴즈 설정으로
      </button>
    </div>
  )
}

function WrongQuestionRow({
  question,
  answer,
  updateReviewNote,
}: {
  question: QuizQuestion
  answer: QuizAnswerRecord
  updateReviewNote: ReturnType<typeof useUpdateReviewNote>
}) {
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const reviewNoteId = answer.result.review_note_id

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="mb-1 truncate text-sm text-primary" title={question.title}>
        {question.title}
      </p>
      <p className="mb-2 text-xs text-muted">
        내 답: {answer.my_answer} · 정답: {answer.result.answer}
      </p>
      {reviewNoteId != null ? (
        <div className="flex gap-1.5">
          <input
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setSaved(false)
            }}
            placeholder="오답노트 메모…"
            className="flex-1 rounded border border-border bg-bg px-2 py-1.5 text-xs text-primary outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() =>
              updateReviewNote.mutate({ id: reviewNoteId, note }, { onSuccess: () => setSaved(true) })
            }
            className="shrink-0 rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
          >
            {saved ? '저장됨' : '저장'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">오답노트 연결 없음</p>
      )}
    </div>
  )
}
