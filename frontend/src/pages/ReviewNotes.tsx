import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCategoryTree } from '../api/categories'
import { useReviewNotes, useUpdateReviewNote } from '../api/reviewNotes'
import { useCreateQuizSession } from '../api/quiz'
import { useQuizSessionStore } from '../stores/quizSession'
import type { ReviewNote, WrongReason } from '../api/types'
import { flattenCategories } from '../utils/tree'
import { ApiError } from '../api/client'

const WRONG_REASONS: WrongReason[] = ['개념부족', '실수', '함정', '시간부족']

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §5.8 — 오답노트. 필터(틀린이유·분류·해결여부) + 리스트(메모 인라인 편집·틀린이유 태그·극복 토글·재도전).
// 상단 일괄 [재도전] = quiz/session{mode:'wrong_only'} (현재 필터 분류 전체).
// 카드별 개별 [재도전] = quiz/session{mode:'wrong_only', document_ids:[해당 문서]} — 누른 그 문제만 출제.
export default function ReviewNotesPage() {
  const navigate = useNavigate()
  const treeQuery = useCategoryTree()
  const start = useQuizSessionStore((s) => s.start)
  const createSession = useCreateQuizSession()

  const [resolvedFilter, setResolvedFilter] = useState<'' | 'unresolved' | 'resolved'>('unresolved')
  const [reasonFilter, setReasonFilter] = useState<WrongReason | ''>('')
  const [categoryFilter, setCategoryFilter] = useState<number | ''>('')
  const [retryError, setRetryError] = useState<string | null>(null)

  const filters = {
    resolved: resolvedFilter === '' ? undefined : resolvedFilter === 'resolved',
    wrong_reason: reasonFilter || undefined,
    category_id: categoryFilter === '' ? undefined : categoryFilter,
    page: 1,
    size: 100,
  }

  const notesQuery = useReviewNotes(filters)
  const updateNote = useUpdateReviewNote()
  const flatCategories = flattenCategories(treeQuery.data ?? [])

  function handleRetryAll() {
    setRetryError(null)
    createSession.mutate(
      { category_id: filters.category_id, mode: 'wrong_only', count: 50 },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) {
            setRetryError('재도전할 오답 문제가 없습니다.')
            return
          }
          start(data.items, 'wrong_only', filters.category_id ?? null)
          navigate('/quiz/run')
        },
        onError: (e) => setRetryError(errMsg(e, '재도전 세션을 시작하지 못했습니다.')),
      },
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-primary">오답노트</h1>
        <button
          type="button"
          onClick={handleRetryAll}
          disabled={createSession.isPending}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          재도전
        </button>
      </div>

      {retryError && <p className="mb-3 text-sm text-wrong">{retryError}</p>}

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={resolvedFilter}
          onChange={(e) => setResolvedFilter(e.target.value as typeof resolvedFilter)}
          className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-primary"
        >
          <option value="">전체</option>
          <option value="unresolved">미해결</option>
          <option value="resolved">해결됨</option>
        </select>

        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value as WrongReason | '')}
          className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-primary"
        >
          <option value="">모든 틀린 이유</option>
          {WRONG_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value ? Number(e.target.value) : '')}
          className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-primary"
        >
          <option value="">모든 분류</option>
          {flatCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {'　'.repeat(c.depth)}
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {notesQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {notesQuery.isError && (
        <p className="text-sm text-wrong">{errMsg(notesQuery.error, '오답노트를 불러오지 못했습니다.')}</p>
      )}
      {notesQuery.data && notesQuery.data.items.length === 0 && (
        <p className="text-sm text-muted">조건에 맞는 오답노트가 없습니다.</p>
      )}

      <div className="flex flex-col gap-3">
        {(notesQuery.data?.items ?? []).map((note) => (
          <ReviewNoteCard key={note.id} note={note} onUpdate={updateNote} />
        ))}
      </div>
    </div>
  )
}

function ReviewNoteCard({ note, onUpdate }: { note: ReviewNote; onUpdate: ReturnType<typeof useUpdateReviewNote> }) {
  const navigate = useNavigate()
  const start = useQuizSessionStore((s) => s.start)
  const createSession = useCreateQuizSession()
  const [noteText, setNoteText] = useState(note.note ?? '')
  const [error, setError] = useState<string | null>(null)

  function handleRetryOne() {
    setError(null)
    createSession.mutate(
      { mode: 'wrong_only', count: 1, document_ids: [note.document_id] },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) {
            setError('재도전할 문제를 찾지 못했습니다.')
            return
          }
          start(data.items, 'wrong_only', null)
          navigate('/quiz/run')
        },
        onError: () => setError('재도전을 시작하지 못했습니다.'),
      },
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
            {note.document.doc_no}
          </span>
          <button
            type="button"
            onClick={() => navigate(`/docs/${note.document.id}`)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {note.document.title}
          </button>
        </div>
        <label className="flex shrink-0 items-center gap-1 text-xs text-primary">
          <input
            type="checkbox"
            checked={note.is_resolved}
            onChange={(e) => onUpdate.mutate({ id: note.id, is_resolved: e.target.checked })}
          />
          극복
        </label>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {WRONG_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onUpdate.mutate({ id: note.id, wrong_reason: note.wrong_reason === r ? null : r })}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              note.wrong_reason === r ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="mb-2 flex gap-1.5">
        <input
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={() => {
            if (noteText !== (note.note ?? '')) {
              onUpdate.mutate({ id: note.id, note: noteText })
            }
          }}
          placeholder="메모…"
          className="flex-1 rounded border border-border bg-bg px-2 py-1.5 text-xs text-primary outline-none focus:border-accent"
        />
      </div>

      {error && <p className="mb-2 text-xs text-wrong">{error}</p>}

      <button
        type="button"
        onClick={handleRetryOne}
        disabled={createSession.isPending}
        className="rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-bg disabled:opacity-50"
      >
        재도전
      </button>
    </div>
  )
}
