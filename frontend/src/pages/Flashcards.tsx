import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import MarkdownView from '../components/MarkdownView'
import FlipCard from '../components/FlipCard'
import ProgressBar from '../components/ProgressBar'
import { useSrsToday } from '../api/srs'
import { useSrsAnswer } from '../api/srs'
import { useDocument, useDocuments } from '../api/documents'
import { ApiError } from '../api/client'
import {
  FLASHCARD_Q_DONT_KNOW,
  FLASHCARD_Q_KNOW,
  useFlashcardSessionStore,
} from '../stores/flashcardSession'
import type { FlashcardCard } from '../stores/flashcardSession'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

function formatAnswer(answer: string | null | undefined): string {
  if (!answer || !answer.trim()) return '-'
  const trimmed = answer.trim()
  if (/^[1-9]$/.test(trimmed)) return `${CIRCLED_DIGITS[Number(trimmed) - 1] ?? trimmed} (${trimmed})`
  return trimmed
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
  const reset = useFlashcardSessionStore((s) => s.reset)

  const srsAnswer = useSrsAnswer()
  const [error, setError] = useState<string | null>(null)

  const card = cards[index]
  // srs 큐 경로(embedded)는 콘텐츠가 이미 있으므로 조회하지 않는다. 범위 경로만 documents/{id} 조회.
  const needsFetch = card != null && !card.embedded
  const docQuery = useDocument(needsFetch ? card.document_id : null)
  const content = card?.embedded ? card.content : docQuery.data?.content
  const answer = card?.embedded ? card.answer : docQuery.data?.answer
  const explanation = card?.embedded ? card.explanation : docQuery.data?.explanation
  const cardLoading = needsFetch && docQuery.isLoading

  function handleGrade(q: number) {
    if (!card || srsAnswer.isPending) return
    setError(null)
    // 규칙4: srs/answer는 낙관적 대상 아님 → mutation 성공 후 다음 카드로 진행.
    srsAnswer.mutate(
      { document_id: card.document_id, q },
      {
        onSuccess: () => grade(q),
        onError: (e) => setError(errMsg(e, '판정 저장에 실패했습니다. 다시 시도하세요.')),
      },
    )
  }

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
        <button
          type="button"
          onClick={() => {
            reset()
            navigate('/')
          }}
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
      <div className="flex flex-1 flex-col justify-center">
        {cardLoading ? (
          <p className="text-sm text-muted">불러오는 중…</p>
        ) : (
          <MarkdownView content={content ?? card.title} />
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
      <div className="flex flex-1 flex-col justify-center gap-2 overflow-y-auto">
        {answer && (
          <p className="text-sm text-primary">
            <span className="font-semibold">정답: </span>
            {formatAnswer(answer)}
          </p>
        )}
        <MarkdownView content={explanation ?? content ?? '내용 없음'} />
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
        disabled={srsAnswer.isPending}
      />

      {error && <p className="mt-3 text-center text-sm text-wrong">{error}</p>}

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={() => handleGrade(FLASHCARD_Q_DONT_KNOW)}
          disabled={srsAnswer.isPending}
          className="flex-1 rounded-lg border border-wrong px-4 py-3 text-sm font-medium text-wrong hover:bg-wrong/10 disabled:opacity-50"
        >
          모른다
        </button>
        <button
          type="button"
          onClick={() => handleGrade(FLASHCARD_Q_KNOW)}
          disabled={srsAnswer.isPending}
          className="flex-1 rounded-lg border border-correct px-4 py-3 text-sm font-medium text-correct hover:bg-correct/10 disabled:opacity-50"
        >
          안다
        </button>
      </div>
    </div>
  )
}
