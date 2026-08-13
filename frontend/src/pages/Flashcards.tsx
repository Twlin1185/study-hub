import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import MarkdownView from '../components/MarkdownView'
import FlipCard from '../components/FlipCard'
import ProgressBar from '../components/ProgressBar'
import { useSrsToday } from '../api/srs'
import { useSrsAnswer } from '../api/srs'
import { useDocument, useDocuments } from '../api/documents'
import { useDocStyle } from '../hooks/useDocStyle'
import { ApiError } from '../api/client'
import {
  FLASHCARD_Q_DONT_KNOW,
  FLASHCARD_Q_KNOW,
  useFlashcardSessionStore,
} from '../stores/flashcardSession'
import type { FlashcardCard, PendingJudgment } from '../stores/flashcardSession'
import { formatAnswer } from '../utils/answerFormat'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §5.7 플래시카드 모드. 범위(category_id) 지정 시 해당 분류의 flashcard 문서, 없으면 오늘의
// 복습 큐에서 flashcard 타입만. 판정은 srs/answer (풀이 기록 없는 SM-2 갱신).
export default function FlashcardsPage() {
  const [params] = useSearchParams()
  const categoryIdParam = params.get('category_id')
  const categoryId = categoryIdParam != null ? Number(categoryIdParam) : null

  // 범위 모드: 분류의 flashcard 문서 목록. 큐 모드: 오늘의 복습 큐(flashcard 필터).
  const docsQuery = useDocuments(
    categoryId != null
      ? { category_id: categoryId, deep: true, type: 'flashcard', size: 200 }
      : { size: 1 },
  )
  const todayQuery = useSrsToday()

  const usingScope = categoryId != null
  const isLoading = usingScope ? docsQuery.isLoading : todayQuery.isLoading
  const isError = usingScope ? docsQuery.isError : todayQuery.isError
  const error = usingScope ? docsQuery.error : todayQuery.error

  const cards: FlashcardCard[] = usingScope
    ? (docsQuery.data?.items ?? []).map((d) => ({
        document_id: d.id,
        doc_no: d.doc_no,
        type: d.type,
        title: d.title,
        embedded: false,
      }))
    : (todayQuery.data ?? [])
        .filter((it) => it.type === 'flashcard')
        .map((it) => ({
          document_id: it.document_id,
          doc_no: it.doc_no,
          type: it.type,
          title: it.title,
          // srs 큐 항목은 뒤집기용 answer·explanation을 직접 실어준다(§4.7) — 재조회 불필요.
          embedded: true,
          content: it.content,
          answer: it.answer,
          explanation: it.explanation,
        }))

  const status = useFlashcardSessionStore((s) => s.status)
  const start = useFlashcardSessionStore((s) => s.start)
  const reset = useFlashcardSessionStore((s) => s.reset)

  // 데이터가 준비되면 세션 시작(한 번). 언마운트 시 리셋해 다음 진입에서 새 큐로 시작.
  useEffect(() => {
    if (status === 'idle' && !isLoading && cards.length > 0) {
      start(cards)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isLoading, cards.length])

  useEffect(() => {
    return () => reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (isLoading) {
    return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  }
  if (isError) {
    return <p className="p-4 text-sm text-wrong">{errMsg(error, '플래시카드를 불러오지 못했습니다.')}</p>
  }
  if (cards.length === 0) {
    return (
      <EmptyState
        message={
          usingScope
            ? '이 범위에 플래시카드가 없습니다.'
            : '오늘 복습할 플래시카드가 없습니다.'
        }
      />
    )
  }

  return <FlashcardSession />
}

function EmptyState({ message }: { message: string }) {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-md p-4">
      <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-5">
        <p className="text-sm text-primary">{message}</p>
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

function FlashcardSession() {
  const navigate = useNavigate()
  const status = useFlashcardSessionStore((s) => s.status)
  const cards = useFlashcardSessionStore((s) => s.cards)
  const index = useFlashcardSessionStore((s) => s.index)
  const flipped = useFlashcardSessionStore((s) => s.flipped)
  const results = useFlashcardSessionStore((s) => s.results)
  const flip = useFlashcardSessionStore((s) => s.flip)
  const grade = useFlashcardSessionStore((s) => s.grade)
  const undo = useFlashcardSessionStore((s) => s.undo)
  const pending = useFlashcardSessionStore((s) => s.pending)
  const clearPending = useFlashcardSessionStore((s) => s.clearPending)
  const reset = useFlashcardSessionStore((s) => s.reset)

  const srsAnswer = useSrsAnswer()
  const [error, setError] = useState<string | null>(null)

  // 전송 지연 확정(설계 §4.12 F36-⑧) — 미전송 판정을 서버로 보낸다.
  function flush(p: PendingJudgment | null) {
    if (p) srsAnswer.mutate({ document_id: p.document_id, q: p.q })
  }

  const card = cards[index]
  // srs 큐 경로(embedded)는 콘텐츠가 이미 있으므로 조회하지 않는다. 범위 경로만 documents/{id} 조회.
  const needsFetch = card != null && !card.embedded
  const docQuery = useDocument(needsFetch ? card.document_id : null)
  const content = card?.embedded ? card.content : docQuery.data?.content
  const answer = card?.embedded ? card.answer : docQuery.data?.answer
  const explanation = card?.embedded ? card.explanation : docQuery.data?.explanation
  const cardLoading = needsFetch && docQuery.isLoading
  // S28(F53 ①·⑤, 설계 §4.26) — embedded 큐 항목(SRS 큐가 콘텐츠를 직접 실어줌)은 documents 조회
  // 자체를 하지 않으므로 style도 알 수 없다(전역 상속). 범위 경로만 문서 지정 스타일을 적용한다.
  const { scale: docScale, fontClassName: docFontClass, bgClassName: docBgClass } = useDocStyle(
    card?.embedded ? null : docQuery.data?.style,
  )

  // 전송 지연 방식(F36-⑧): 판정은 즉시 기록·진행하되, 서버 확정은 "다음 카드 진입"에 미룬다.
  // 직전 pending을 먼저 확정 전송한 뒤 새 판정으로 교체 — 새 판정은 undo(미전송 취소) 가능.
  function handleGrade(q: number) {
    if (!card) return
    setError(null)
    flush(pending)
    grade(q)
  }

  function handleUndo() {
    undo()
  }

  // 완료 화면 이탈 시 미확정 판정을 확정 전송한다 (검토 지시 2 — 완료 화면 진입 즉시 flush하지 않음).
  function leaveHome() {
    flush(useFlashcardSessionStore.getState().pending)
    clearPending()
    reset()
    navigate('/')
  }

  // 세션 이탈(라우팅 등 unmount) 시 미확정 판정을 빠짐없이 확정 전송 — 마지막 카드 누락 방지.
  useEffect(() => {
    return () => {
      const p = useFlashcardSessionStore.getState().pending
      if (p) srsAnswer.mutate({ document_id: p.document_id, q: p.q })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 키보드: 스페이스=뒤집기, ←=모른다(q1), →=안다(q4) (설계 §5.7)
  useEffect(() => {
    if (status !== 'active') return
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        flip()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleGrade(FLASHCARD_Q_DONT_KNOW)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleGrade(FLASHCARD_Q_KNOW)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, index, flipped, srsAnswer.isPending])

  if (status === 'finished') {
    const knew = Object.values(results).filter((q) => q >= 3).length
    const didnt = Object.values(results).filter((q) => q < 3).length
    return (
      <div className="mx-auto max-w-md p-4">
        <h1 className="mb-4 text-xl font-semibold text-primary">플래시카드 완료</h1>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-surface p-4 text-center">
            <p className="text-2xl font-semibold text-correct">{knew}</p>
            <p className="text-xs text-muted">안다</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4 text-center">
            <p className="text-2xl font-semibold text-wrong">{didnt}</p>
            <p className="text-xs text-muted">모른다</p>
          </div>
        </div>
        {/* 마지막 판정 되돌리기 (검토 지시 2) — 완료 화면에서 미전송 취소, 마지막 카드로 복귀 */}
        {pending != null && (
          <button
            type="button"
            onClick={handleUndo}
            className="mb-3 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg"
          >
            ↩ 마지막 판정 되돌리기
          </button>
        )}
        <button
          type="button"
          onClick={leaveHome}
          className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          홈으로
        </button>
      </div>
    )
  }

  if (!card) return null

  const remaining = cards.length - index

  const front = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{card.doc_no}</span>
        <span className="text-xs text-muted">앞면</span>
      </div>
      <div className={`flex flex-1 flex-col justify-center ${docFontClass}`}>
        {cardLoading ? (
          <p className="text-sm text-muted">불러오는 중…</p>
        ) : (
          <MarkdownView content={content ?? card.title} scale={docScale} />
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted">탭 / 스페이스로 뒤집기</p>
    </>
  )

  const back = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{card.doc_no}</span>
        <span className="text-xs text-muted">뒷면</span>
      </div>
      <div className={`flex flex-1 flex-col justify-center gap-2 overflow-y-auto ${docFontClass}`}>
        {answer && (
          <p className="text-sm text-primary">
            <span className="font-semibold">정답: </span>
            {formatAnswer(answer)}
          </p>
        )}
        <MarkdownView content={explanation ?? content ?? '내용 없음'} scale={docScale} />
      </div>
      <p className="mt-3 text-center text-xs text-muted">← 모른다 · 안다 →</p>
    </>
  )

  return (
    <div className="mx-auto max-w-md p-4 pb-24">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            // 이탈 전 미전송 판정 확정(실제 판정한 카드는 세션 종료로 확정, §5.7).
            flush(pending)
            reset()
            navigate('/')
          }}
          className="text-sm text-muted hover:text-primary"
        >
          ✕ 종료
        </button>
        <span className="text-sm text-muted">남은 {remaining}장</span>
      </div>

      <div className="mb-4">
        <ProgressBar value={cards.length > 0 ? index / cards.length : 0} label={`${index}/${cards.length}`} />
      </div>

      <FlipCard
        flipped={flipped}
        front={front}
        back={back}
        onFlip={flip}
        onSwipeLeft={() => handleGrade(FLASHCARD_Q_DONT_KNOW)}
        onSwipeRight={() => handleGrade(FLASHCARD_Q_KNOW)}
        frontBgClassName={docBgClass}
        backBgClassName={docBgClass}
      />

      {error && <p className="mt-3 text-center text-sm text-wrong">{error}</p>}

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={() => handleGrade(FLASHCARD_Q_DONT_KNOW)}
          className="flex-1 rounded-lg border border-wrong px-4 py-3 text-sm font-medium text-wrong hover:bg-wrong/10"
        >
          모른다
        </button>
        <button
          type="button"
          onClick={() => handleGrade(FLASHCARD_Q_KNOW)}
          className="flex-1 rounded-lg border border-correct px-4 py-3 text-sm font-medium text-correct hover:bg-correct/10"
        >
          안다
        </button>
      </div>

      {/* 판정 undo 1회 (설계 §5.7, F36-⑧) — 직전 판정 미전송 취소, 서버 롤백 없음 */}
      {pending != null && (
        <button
          type="button"
          onClick={handleUndo}
          className="mt-3 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg"
        >
          ↩ 직전 판정 되돌리기
        </button>
      )}
    </div>
  )
}
