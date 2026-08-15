// 노트(베타) 목록 — `/notes` (설계 §5.16 "목록", API §4.28 ①·④)
//
// 격리 베타 표면이다: 사이드바·하단 탭바에 오르지 않으며 진입은 설정 화면 실험실 카드 + 직접 URL뿐.
// 색은 전부 토큰(Tailwind 유틸 = tokens.css 변수) — 불변 규칙 5.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ConfirmDialog from '../../components/ConfirmDialog'
import { emptyDocument } from '../schema/blocks'
import {
  parseServerDate,
  useCreateNote,
  useDeleteNote,
  useNotes,
  type NoteListItem,
} from '../api/notes'

const PAGE_SIZE = 50

// 서버 시각은 타임존 표기 없는 UTC naive ISO다 — 반드시 `parseServerDate`로 해석한다
// (`new Date(iso)`는 로컬 시각으로 읽어 KST에서 9시간 어긋난다).
function relativeTime(iso: string): string {
  const parsed = parseServerDate(iso)
  const then = parsed.getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '방금 전'
  if (diff < hour) return `${Math.floor(diff / minute)}분 전`
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`
  return parsed.toLocaleDateString()
}

export default function NoteListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState<NoteListItem | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // 검색 디바운스(§5.16 목록) — 입력마다 요청하지 않는다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const filters = useMemo(() => ({ q, page, size: PAGE_SIZE }), [q, page])
  const notesQuery = useNotes(filters)
  const createNote = useCreateNote()
  const deleteNote = useDeleteNote()

  const items = notesQuery.data?.items ?? []
  const total = notesQuery.data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const onCreate = () => {
    setActionError(null)
    // 빈 노트 = 빈 블록 문서 + 빈 프로젝션(§4.28 ③ — 블록과 프로젝션은 항상 함께 보낸다).
    createNote.mutate(
      { title: '', content_blocks: emptyDocument(), content: '' },
      {
        onSuccess: (note) => navigate(`/notes/${note.id}`),
        onError: (error) => setActionError(error instanceof Error ? error.message : '노트를 만들지 못했습니다'),
      },
    )
  }

  const onDelete = () => {
    if (!pendingDelete) return
    deleteNote.mutate(pendingDelete.id, {
      onSuccess: () => setPendingDelete(null),
      onError: (error) => setActionError(error instanceof Error ? error.message : '노트를 삭제하지 못했습니다'),
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-primary">노트 (베타)</h1>
          <p className="mt-1 text-xs text-muted">
            새 편집기 시험용 저장소입니다 — 기존 문서와 분리돼 있습니다
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          disabled={createNote.isPending}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          새 노트
        </button>
      </header>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="제목·본문 검색"
        className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-primary placeholder:text-muted"
      />

      {actionError && <p className="text-sm text-wrong">{actionError}</p>}
      {notesQuery.isError && (
        <p className="text-sm text-wrong">
          {notesQuery.error instanceof Error ? notesQuery.error.message : '목록을 불러오지 못했습니다'}
        </p>
      )}

      {notesQuery.isLoading ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {q ? '검색 결과가 없습니다' : '아직 노트가 없습니다 — [새 노트]로 시작하세요'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((note) => (
            <li
              key={note.id}
              className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3"
            >
              <Link to={`/notes/${note.id}`} className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-primary">
                    {note.title.trim() || '제목 없음'}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{relativeTime(note.updated_at)}</span>
                </div>
                {note.excerpt && (
                  <p className="mt-1 line-clamp-2 break-all text-xs text-muted">{note.excerpt}</p>
                )}
              </Link>
              <button
                type="button"
                onClick={() => {
                  setActionError(null)
                  setPendingDelete(note)
                }}
                className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted hover:bg-bg hover:text-wrong"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm text-primary">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-border px-2 py-1 disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-xs text-muted">
            {page} / {lastPage}
          </span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            className="rounded border border-border px-2 py-1 disabled:opacity-40"
          >
            다음
          </button>
        </nav>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="노트 삭제"
          message="노트를 삭제할까요? 목록에서 사라집니다."
          confirmLabel="삭제"
          danger
          submitting={deleteNote.isPending}
          onConfirm={onDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
