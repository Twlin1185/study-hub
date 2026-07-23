import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCategoryTree } from '../api/categories'
import { useReviewNotes, useUpdateReviewNote } from '../api/reviewNotes'
import { useCreateQuizSession } from '../api/quiz'
import { useQuizSessionStore } from '../stores/quizSession'
import type { ReviewNote, WrongReason } from '../api/types'
import { findCategory } from '../utils/tree'
import { groupByCategoryPath, type TopGroup } from '../utils/reviewNoteGroups'
import { ApiError } from '../api/client'
import CategoryScopePicker from '../components/CategoryScopePicker'

const WRONG_REASONS: WrongReason[] = ['개념부족', '실수', '함정', '시간부족']

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §5.8 — 오답노트. 필터(분류 범위·틀린이유·해결여부) + 분류 계층 그룹 리스트 —
// 카드 = 문제 요약, 내 메모 인라인 편집, 틀린이유 태그 선택, [극복] 토글, [재도전].
// 상단 일괄 [재도전] = quiz/session{mode:'wrong_only'} (현재 필터 분류 전체).
// 카드별 개별 [재도전] = quiz/session{mode:'sequential', document_ids:[해당 문서]} — 누른 그 문제만 출제.
// wrong_only는 미해결 오답노트 조인이라 극복(resolved) 처리된 문제·오답노트 없는 문서는 0문항이
// 되므로, 특정 문서를 지목하는 재도전(오답노트 개별·약점 위젯)은 sequential + document_ids로 지정한다.
export default function ReviewNotesPage() {
  const navigate = useNavigate()
  const treeQuery = useCategoryTree()
  const start = useQuizSessionStore((s) => s.start)
  const createSession = useCreateQuizSession()

  const [resolvedFilter, setResolvedFilter] = useState<'' | 'unresolved' | 'resolved'>('unresolved')
  const [reasonFilter, setReasonFilter] = useState<WrongReason | ''>('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  const filters = {
    resolved: resolvedFilter === '' ? undefined : resolvedFilter === 'resolved',
    wrong_reason: reasonFilter || undefined,
    category_id: categoryId ?? undefined,
    page: 1,
    size: 200,
  }

  const notesQuery = useReviewNotes(filters)
  const updateNote = useUpdateReviewNote()

  const scopeNode = categoryId != null ? findCategory(treeQuery.data ?? [], categoryId) : null
  const groups = useMemo(() => groupByCategoryPath(notesQuery.data?.items ?? []), [notesQuery.data])

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

      <div className="mb-3 flex flex-wrap gap-2">
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

        <button
          type="button"
          onClick={() => setScopeOpen((v) => !v)}
          className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-primary hover:bg-bg"
        >
          분류 범위: {scopeNode ? scopeNode.name : '전체'} (하위 포함) {scopeOpen ? '▾' : '▸'}
        </button>
      </div>

      {/* 퀴즈 설정과 동일한 범위 선택 트리 공용 컴포넌트 — 선택한 범위의 하위 전체 포함(§4.6). */}
      {scopeOpen && treeQuery.data && (
        <div className="mb-3">
          <CategoryScopePicker
            nodes={treeQuery.data}
            selectedId={categoryId}
            onSelect={(id) => {
              setCategoryId(id)
              setScopeOpen(false)
            }}
          />
        </div>
      )}

      {notesQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {notesQuery.isError && (
        <p className="text-sm text-wrong">{errMsg(notesQuery.error, '오답노트를 불러오지 못했습니다.')}</p>
      )}
      {notesQuery.data && notesQuery.data.items.length === 0 && (
        <p className="text-sm text-muted">조건에 맞는 오답노트가 없습니다.</p>
      )}

      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <TopGroupSection key={group.header} group={group} updateNote={updateNote} />
        ))}
      </div>
    </div>
  )
}

function TopGroupSection({
  group,
  updateNote,
}: {
  group: TopGroup
  updateNote: ReturnType<typeof useUpdateReviewNote>
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <section className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-primary">
          <span className="text-muted">{expanded ? '▾' : '▸'}</span>
          {group.header}
        </span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
          {group.count}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {group.subgroups.map((sub) => (
            <div key={sub.subheading} className="flex flex-col gap-2">
              {sub.subheading !== group.header && (
                <h3 className="text-xs font-semibold text-muted">{sub.subheading}</h3>
              )}
              {sub.notes.map((note) => (
                <ReviewNoteCard key={note.id} note={note} onUpdate={updateNote} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
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
    // 특정 문서 지목 재도전은 sequential + document_ids (설계 §5.8) — wrong_only는 미해결
    // 오답노트 조인이라 극복 처리된 문제는 0문항이 되어버린다.
    createSession.mutate(
      { mode: 'sequential', count: 1, document_ids: [note.document_id] },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) {
            setError('재도전할 문제를 찾지 못했습니다.')
            return
          }
          start(data.items, 'sequential', null)
          navigate('/quiz/run')
        },
        onError: () => setError('재도전을 시작하지 못했습니다.'),
      },
    )
  }

  return (
    <div className="rounded-lg border border-border bg-bg p-3">
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
          className="flex-1 rounded border border-border bg-surface px-2 py-1.5 text-xs text-primary outline-none focus:border-accent"
        />
      </div>

      {error && <p className="mb-2 text-xs text-wrong">{error}</p>}

      <button
        type="button"
        onClick={handleRetryOne}
        disabled={createSession.isPending}
        className="rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
      >
        재도전
      </button>
    </div>
  )
}
