import { useMemo, useState } from 'react'
import Modal from './Modal'
import { useDocuments } from '../api/documents'
import type { RelationType } from '../api/types'

const RELATION_OPTIONS: { value: RelationType; label: string }[] = [
  { value: 'explains', label: '설명한다 (explains)' },
  { value: 'related', label: '관련 있음 (related)' },
  { value: 'prerequisite', label: '선행 개념 (prerequisite)' },
]

interface AddRelationModalProps {
  documentId: number
  excludeIds: number[]
  onSubmit: (toDocumentId: number, relation: RelationType) => void
  onClose: () => void
  submitting?: boolean
  errorMessage?: string | null
}

// 검색 API(S6) 도입 전까지 문서 목록을 불러와 제목·doc_no 클라이언트 필터로 대체한다 — 최종 보고 참고.
export default function AddRelationModal({
  documentId,
  excludeIds,
  onSubmit,
  onClose,
  submitting,
  errorMessage,
}: AddRelationModalProps) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [relation, setRelation] = useState<RelationType>('related')

  const documentsQuery = useDocuments({ page: 1, size: 200 })

  const candidates = useMemo(() => {
    const items = documentsQuery.data?.items ?? []
    const excluded = new Set([documentId, ...excludeIds])
    const q = query.trim().toLowerCase()
    return items
      .filter((d) => !excluded.has(d.id))
      .filter((d) => !q || d.title.toLowerCase().includes(q) || d.doc_no.toLowerCase().includes(q))
      .slice(0, 30)
  }, [documentsQuery.data, query, documentId, excludeIds])

  return (
    <Modal title="관련 문서 연결" onClose={onClose} widthClass="max-w-lg">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          문서 검색 (제목·doc_no)
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색어 입력…"
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
        </label>

        <div className="max-h-56 overflow-y-auto rounded border border-border">
          {documentsQuery.isLoading && <p className="p-3 text-sm text-muted">불러오는 중…</p>}
          {candidates.length === 0 && !documentsQuery.isLoading && (
            <p className="p-3 text-sm text-muted">일치하는 문서가 없습니다.</p>
          )}
          {candidates.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelectedId(d.id)}
              className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 ${
                selectedId === d.id ? 'bg-accent-soft text-accent' : 'text-primary hover:bg-bg'
              }`}
            >
              <span className="shrink-0 text-[11px] text-muted">{d.doc_no}</span>
              <span className="truncate">{d.title}</span>
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          관계 종류
          <select
            value={relation}
            onChange={(e) => setRelation(e.target.value as RelationType)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          >
            {RELATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {errorMessage && <p className="text-sm text-wrong">{errorMessage}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            취소
          </button>
          <button
            type="button"
            disabled={submitting || selectedId == null}
            onClick={() => selectedId != null && onSubmit(selectedId, relation)}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            연결
          </button>
        </div>
      </div>
    </Modal>
  )
}
