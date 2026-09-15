// 통합 휴지통 — `/trash` (설계 §5.17·§4.32, S52 — D8-구현 · F61)
//
// 상시 내비 자리를 쓰지 않는 저빈도 유지보수 표면(진입 = 설정 데이터 그룹 카드). 탭 3개
// [문서]/[노트]/[이미지]는 로컬 상태(URL 쿼리 보존 0). 색은 전부 토큰 클래스(불변 규칙 5).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import { ApiError } from '../api/client'
import { useRestoreDocument } from '../api/documents'
import type { DocumentListItem, DocumentType } from '../api/types'
import {
  useMoveImagesToTrash,
  useRestoreImagesFromTrash,
  useTrashDocuments,
  useTrashImages,
  useTrashNotes,
} from '../api/trash'
import { parseServerDate, useRestoreNote, type NoteListItem } from '../editor2/api/notes'

const PAGE_SIZE = 50

const TYPE_LABEL: Record<DocumentType, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출',
  flashcard: '카드',
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

function formatDateTime(iso: string): string {
  const parsed = parseServerDate(iso)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

type TrashTab = 'documents' | 'notes' | 'images'

const TABS: { id: TrashTab; label: string }[] = [
  { id: 'documents', label: '문서' },
  { id: 'notes', label: '노트' },
  { id: 'images', label: '이미지' },
]

export default function TrashPage() {
  const [tab, setTab] = useState<TrashTab>('documents')

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-lg font-bold text-primary">휴지통</h1>
        <p className="mt-1 text-xs text-muted">
          삭제한 문서·노트를 복원하거나, 안 쓰는 이미지를 정리합니다
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`rounded-t px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-b-2 border-accent text-accent'
                : 'text-muted hover:text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'documents' && <TrashDocumentsTab />}
      {tab === 'notes' && <TrashNotesTab />}
      {tab === 'images' && <TrashImagesTab />}
    </div>
  )
}

function Pagination({
  page,
  lastPage,
  onChange,
}: {
  page: number
  lastPage: number
  onChange: (page: number) => void
}) {
  if (lastPage <= 1) return null
  return (
    <nav className="flex items-center justify-center gap-3 text-sm text-primary">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
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
        onClick={() => onChange(Math.min(lastPage, page + 1))}
        className="rounded border border-border px-2 py-1 disabled:opacity-40"
      >
        다음
      </button>
    </nav>
  )
}

function TrashDocumentsTab() {
  const [page, setPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const query = useTrashDocuments({ page, size: PAGE_SIZE })
  const restoreDocument = useRestoreDocument()

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function onRestore(doc: DocumentListItem) {
    setActionError(null)
    setNotice(null)
    restoreDocument.mutate(doc.id, {
      onSuccess: () => setNotice('복원했습니다 — 탐색에서 확인'),
      onError: (e) => setActionError(errMsg(e, '복원에 실패했습니다.')),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {notice && <p className="text-sm text-correct">{notice}</p>}
      {actionError && <p className="text-sm text-wrong">{actionError}</p>}
      {query.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {query.isError && (
        <p className="text-sm text-wrong">{errMsg(query.error, '목록을 불러오지 못했습니다.')}</p>
      )}
      {!query.isLoading && items.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          휴지통이 비어 있습니다
        </p>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-2 font-medium">제목</th>
                <th className="py-2 pr-2 font-medium">타입</th>
                <th className="py-2 pr-2 font-medium">삭제 시각</th>
                <th className="py-2 pr-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => (
                <tr key={doc.id} className="border-b border-border">
                  <td className="max-w-[200px] truncate py-2 pr-2">
                    <Link to={`/docs/${doc.id}`} className="text-accent hover:underline">
                      {doc.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-2">
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                      {TYPE_LABEL[doc.type] ?? doc.type}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-2 text-xs text-muted">
                    {formatDateTime(doc.updated_at)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <button
                      type="button"
                      onClick={() => onRestore(doc)}
                      disabled={restoreDocument.isPending}
                      className="shrink-0 rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg disabled:opacity-50"
                    >
                      복원
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} lastPage={lastPage} onChange={setPage} />
    </div>
  )
}

function TrashNotesTab() {
  const [page, setPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const query = useTrashNotes({ page, size: PAGE_SIZE })
  const restoreNote = useRestoreNote()

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function onRestore(note: NoteListItem) {
    setActionError(null)
    setNotice(null)
    restoreNote.mutate(note.id, {
      onSuccess: () => setNotice('복원했습니다'),
      onError: (e) => setActionError(errMsg(e, '복원에 실패했습니다.')),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {notice && <p className="text-sm text-correct">{notice}</p>}
      {actionError && <p className="text-sm text-wrong">{actionError}</p>}
      {query.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {query.isError && (
        <p className="text-sm text-wrong">{errMsg(query.error, '목록을 불러오지 못했습니다.')}</p>
      )}
      {!query.isLoading && items.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          휴지통이 비어 있습니다
        </p>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-2 font-medium">제목</th>
                <th className="py-2 pr-2 font-medium">삭제 시각</th>
                <th className="py-2 pr-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((note) => (
                <tr key={note.id} className="border-b border-border">
                  <td className="max-w-[220px] truncate py-2 pr-2">
                    <Link to={`/notes/${note.id}`} className="text-accent hover:underline">
                      {note.title.trim() || '제목 없음'}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-2 text-xs text-muted">
                    {formatDateTime(note.updated_at)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <button
                      type="button"
                      onClick={() => onRestore(note)}
                      disabled={restoreNote.isPending}
                      className="shrink-0 rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg disabled:opacity-50"
                    >
                      복원
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} lastPage={lastPage} onChange={setPage} />
    </div>
  )
}

function TrashImagesTab() {
  const query = useTrashImages()
  const moveToTrash = useMoveImagesToTrash()
  const restoreFromTrash = useRestoreImagesFromTrash()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmMove, setConfirmMove] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  const report = query.data
  const orphans = report?.orphans ?? []
  const trashed = report?.trashed ?? []

  function toggle(filename: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename)
      else next.add(filename)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === orphans.length ? new Set() : new Set(orphans.map((o) => o.filename))))
  }

  function onScan() {
    setActionError(null)
    setSelected(new Set())
    query.refetch().catch(() => {
      /* isError로 렌더 — 여기서는 무시 */
    })
  }

  function onConfirmMove() {
    setActionError(null)
    const filenames = Array.from(selected)
    moveToTrash.mutate(filenames, {
      onSuccess: (result) => {
        setSummary(`이동 ${result.moved} · 건너뜀 ${result.skipped}`)
        setSelected(new Set())
        setConfirmMove(false)
        query.refetch().catch(() => {})
      },
      onError: (e) => setActionError(errMsg(e, '이미지를 휴지통으로 옮기지 못했습니다.')),
    })
  }

  function onRestoreOne(filename: string) {
    setActionError(null)
    restoreFromTrash.mutate([filename], {
      onSuccess: (result) => {
        setSummary(`되돌리기 ${result.restored} · 건너뜀 ${result.skipped}`)
        query.refetch().catch(() => {})
      },
      onError: (e) => setActionError(errMsg(e, '이미지를 되돌리지 못했습니다.')),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-border bg-surface p-3 text-xs text-muted">
        <p>앱은 이미지를 지우지 않습니다. 고아 이미지를 휴지통 폴더로 옮겨 두면, 최종 삭제는 탐색기에서 아래 폴더를 비우세요.</p>
        {report && (
          <p className="mt-1">
            휴지통 폴더: <code className="rounded bg-bg px-1 text-primary">{report.trash_dir}</code>
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onScan}
        disabled={query.isFetching}
        className="w-fit rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
      >
        {query.isFetching ? '스캔 중…' : '고아 이미지 스캔'}
      </button>

      {summary && <p className="text-sm text-correct">{summary}</p>}
      {actionError && <p className="text-sm text-wrong">{actionError}</p>}
      {query.isError && (
        <p className="text-sm text-wrong">{errMsg(query.error, '스캔에 실패했습니다.')}</p>
      )}

      {report && (
        <>
          <p className="text-xs text-muted">
            전체 {report.total_files} · 참조 중 {report.referenced} · 고아 {orphans.length} · 최근 7일 제외{' '}
            {report.recent_skipped}
          </p>

          {orphans.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
              고아 이미지가 없습니다
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg"
                >
                  전체 선택
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmMove(true)}
                  className="rounded bg-wrong px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                >
                  휴지통으로 이동
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="py-2 pr-2 font-medium" />
                      <th className="py-2 pr-2 font-medium">미리보기</th>
                      <th className="py-2 pr-2 font-medium">파일명</th>
                      <th className="py-2 pr-2 font-medium">크기</th>
                      <th className="py-2 pr-2 font-medium">수정일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphans.map((img) => (
                      <tr key={img.filename} className="border-b border-border">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={selected.has(img.filename)}
                            onChange={() => toggle(img.filename)}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <img
                            src={`/images/${img.filename}`}
                            loading="lazy"
                            alt=""
                            className="h-12 w-12 rounded border border-border object-cover"
                          />
                        </td>
                        <td className="max-w-[200px] truncate py-2 pr-2 text-xs text-primary">{img.filename}</td>
                        <td className="whitespace-nowrap py-2 pr-2 text-xs text-muted">{formatBytes(img.bytes)}</td>
                        <td className="whitespace-nowrap py-2 pr-2 text-xs text-muted">
                          {formatDateTime(img.modified_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h2 className="mt-2 text-sm font-semibold text-primary">휴지통 폴더 목록</h2>
          {trashed.length === 0 ? (
            <p className="text-xs text-muted">휴지통 폴더가 비어 있습니다</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[400px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 pr-2 font-medium">파일명</th>
                    <th className="py-2 pr-2 font-medium">크기</th>
                    <th className="py-2 pr-2 font-medium">수정일</th>
                    <th className="py-2 pr-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {trashed.map((img) => (
                    <tr key={img.filename} className="border-b border-border">
                      <td className="max-w-[200px] truncate py-2 pr-2 text-xs text-primary">{img.filename}</td>
                      <td className="whitespace-nowrap py-2 pr-2 text-xs text-muted">{formatBytes(img.bytes)}</td>
                      <td className="whitespace-nowrap py-2 pr-2 text-xs text-muted">
                        {formatDateTime(img.modified_at)}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <button
                          type="button"
                          onClick={() => onRestoreOne(img.filename)}
                          disabled={restoreFromTrash.isPending}
                          className="shrink-0 rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg disabled:opacity-50"
                        >
                          되돌리기
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {confirmMove && (
        <ConfirmDialog
          title="휴지통으로 이동"
          message={`${selected.size}개를 휴지통 폴더로 옮길까요? 파일은 지워지지 않습니다`}
          confirmLabel="이동"
          danger
          submitting={moveToTrash.isPending}
          onClose={() => setConfirmMove(false)}
          onConfirm={onConfirmMove}
        />
      )}
    </div>
  )
}
