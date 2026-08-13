import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MarkdownView from '../components/MarkdownView'
import ConfirmDialog from '../components/ConfirmDialog'
import ProgressBar from '../components/ProgressBar'
import BookmarkButton from '../components/BookmarkButton'
import { useQuizSessionStore } from '../stores/quizSession'
import type { QuizAnswerRecord } from '../stores/quizSession'
import { useSubmitAttempt } from '../api/quiz'
import { useUpdateReviewNote } from '../api/reviewNotes'
import { useDocument, useToggleBookmark } from '../api/documents'
import { useSettings } from '../api/settings'
import { useDocStyle } from '../hooks/useDocStyle'
import { MARKDOWN_SCALE_CLASS } from '../utils/docStyle'
import ReportErrorButton from '../components/ReportErrorButton'
import { pickManualRelations } from '../utils/relations'
import { CIRCLED_DIGITS, formatAnswer } from '../utils/answerFormat'
import type { QuizQuestion, WrongReason } from '../api/types'

// 틀린이유 원탭 4버튼 (설계 §5.6, F36-⑤)
const WRONG_REASONS: WrongReason[] = ['개념부족', '실수', '함정', '시간부족']

// 정답 자동 다음 카운트다운 (설계 §5.6, F36-⑥) — 오답은 항상 정지.
const AUTO_ADVANCE_MS = 1500

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

const RELATION_LABEL: Record<string, string> = {
  explains: '설명',
  related: '관련',
  prerequisite: '선행 개념',
}

// 해설 영역의 "관련 개념 바로가기" — quiz/session 응답엔 relations가 없어(서버 채점 원칙, §8)
// 정답 공개 이후 문서 상세를 조회해 relations를 가져온다 (설계 §5.6).
// 파생 embeds 행은 제외한다(설계 §4.19 ⑦ — 관계 목록에 섞어 표시하지 않는다. 공용 필터 사용).
function RelatedConceptLinks({ documentId }: { documentId: number }) {
  const navigate = useNavigate()
  const docQuery = useDocument(documentId)
  const relations = pickManualRelations(docQuery.data?.relations ?? [])
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
  const toggleBookmark = useToggleBookmark()
  const settingsQuery = useSettings()
  const autoAdvanceOn = settingsQuery.data?.['quiz.auto_advance'] === 'on'

  const [exitConfirm, setExitConfirm] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // 정답 자동 다음 카운트다운(남은 ms). null이면 비활성. 아무 키/탭으로 즉시 진행 (F36-⑥).
  const [autoRemain, setAutoRemain] = useState<number | null>(null)
  const autoActiveRef = useRef(false)

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

  // 현재 문제의 북마크 상태(B 단축키용) — quiz/session 응답엔 bookmarked가 없어 문서 상세로 조회.
  const currentDocId = status === 'active' ? (questions[currentIndex]?.document_id ?? null) : null
  const currentDocQuery = useDocument(currentDocId)
  // S28(F53 ①·⑤, 설계 §4.26) — quiz/session 응답(QuizQuestion)엔 style이 없어(서버 채점 원칙과
  // 무관 — 그냥 좁은 스키마) 위에서 이미 조회 중인 문서 상세의 style을 재사용한다(새 조회 0건).
  const { scale: docScale, fontClassName: docFontClass, bgClassName: docBgClass } = useDocStyle(
    currentDocQuery.data?.style,
  )

  function advanceNow() {
    autoActiveRef.current = false
    goNext()
  }

  function toggleCurrentBookmark(docId: number) {
    const bm = currentDocQuery.data?.bookmarked ?? false
    toggleBookmark.mutate({ id: docId, bookmarked: !bm })
  }

  // 키보드 단축키 (설계 §5.6, F36-④): 1~4 보기·Enter 다음·B 북마크. 입력 포커스 중 무시.
  useEffect(() => {
    if (status !== 'active') return
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      const q = questions[currentIndex]
      if (!q) return
      // 자동 다음 카운트다운 중엔 아무 키나 즉시 진행
      if (autoActiveRef.current) {
        e.preventDefault()
        advanceNow()
        return
      }
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        toggleCurrentBookmark(q.document_id)
        return
      }
      const ans = answers[q.document_id]
      if (!ans) {
        if (e.key >= '1' && e.key <= '4') {
          const idx = Number(e.key) - 1
          if (idx < (q.choices?.length ?? 0)) {
            e.preventDefault()
            handleSelect(idx)
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, currentIndex, answers, currentDocQuery.data?.bookmarked])

  // 정답 자동 다음 (설계 §5.6, F36-⑥) — 정답 & 설정 on일 때만. 오답은 항상 정지.
  useEffect(() => {
    const q = questions[currentIndex]
    const ans = q ? answers[q.document_id] : undefined
    if (status !== 'active' || !ans || !ans.result.is_correct || !autoAdvanceOn) {
      autoActiveRef.current = false
      setAutoRemain(null)
      return
    }
    autoActiveRef.current = true
    const start = Date.now()
    setAutoRemain(AUTO_ADVANCE_MS)
    const interval = window.setInterval(() => {
      setAutoRemain(Math.max(0, AUTO_ADVANCE_MS - (Date.now() - start)))
    }, 100)
    const timeout = window.setTimeout(() => {
      autoActiveRef.current = false
      goNext()
    }, AUTO_ADVANCE_MS)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, currentIndex, answers, autoAdvanceOn])

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

      <div className={`mb-4 rounded-lg border border-border p-4 ${docBgClass || 'bg-surface'} ${docFontClass}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-block rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {question.doc_no}
          </span>
          <QuizCardBookmark documentId={question.document_id} />
        </div>
        <MarkdownView content={question.content} scale={docScale} />
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
          // S28(검토 3차 잔여-3) — 보기 버튼도 "본문 렌더 영역"에 포함해 폰트·글자크기만 확장
          // 적용한다. 배경·테두리·글자색(stateClass — 정오 상태 표시)은 그대로 둔다(선택 상태
          // 시각이 우선 — 문서 배경으로 덮지 않는다).
          return (
            <button
              key={i}
              type="button"
              disabled={Boolean(answered) || submitAttempt.isPending}
              onClick={() => handleSelect(i)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${MARKDOWN_SCALE_CLASS[docScale]} ${docFontClass} ${stateClass}`}
            >
              <span className="font-medium">{CIRCLED_DIGITS[i] ?? `${i + 1}.`}</span>
              <span>{choice}</span>
            </button>
          )
        })}
      </div>

      {answered && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className={`text-sm font-semibold ${answered.result.is_correct ? 'text-correct' : 'text-wrong'}`}>
              {answered.result.is_correct ? '정답입니다' : '오답입니다'}
            </p>
            <ReportErrorButton documentId={question.document_id} variant="inline" />
          </div>

          {/* 틀린이유 원탭 (설계 §5.6, F36-⑤) — 오답 & 오답노트 연결 시에만 */}
          {!answered.result.is_correct && answered.result.review_note_id != null && (
            <WrongReasonButtons reviewNoteId={answered.result.review_note_id} updateReviewNote={updateReviewNote} />
          )}

          <div className={`text-sm text-primary ${docFontClass}`}>
            <span className="font-semibold">해설</span>
            <MarkdownView content={answered.result.explanation} scale={docScale} />
          </div>
          <RelatedConceptLinks documentId={question.document_id} />
          <p className="mt-3 text-[11px] text-muted">단축키: 1~4 보기 · Enter 다음 · B 북마크</p>
        </div>
      )}

      {answered && (
        <button
          type="button"
          onClick={advanceNow}
          className="mt-4 w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          {autoRemain != null
            ? `다음 (${(autoRemain / 1000).toFixed(1)}초 · 탭하면 즉시)`
            : currentIndex + 1 >= questions.length
              ? '결과 보기'
              : '다음'}
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

// 틀린이유 원탭 4버튼 (설계 §5.6, F36-⑤) — review_note_id로 PATCH 즉시 기록, 재탭 시 변경.
function WrongReasonButtons({
  reviewNoteId,
  updateReviewNote,
}: {
  reviewNoteId: number
  updateReviewNote: ReturnType<typeof useUpdateReviewNote>
}) {
  const [selected, setSelected] = useState<WrongReason | null>(null)

  function pick(reason: WrongReason) {
    const next = selected === reason ? null : reason
    setSelected(next)
    updateReviewNote.mutate({ id: reviewNoteId, wrong_reason: next })
  }

  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium text-muted">틀린 이유 (오답노트에 바로 기록)</p>
      <div className="flex flex-wrap gap-1.5">
        {WRONG_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => pick(reason)}
            aria-pressed={selected === reason}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              selected === reason
                ? 'border-accent bg-accent text-on-accent'
                : 'border-border bg-surface text-primary hover:bg-bg'
            }`}
          >
            {reason}
          </button>
        ))}
      </div>
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
        내 답: {formatAnswer(answer.my_answer)} · 정답: {formatAnswer(answer.result.answer)}
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
