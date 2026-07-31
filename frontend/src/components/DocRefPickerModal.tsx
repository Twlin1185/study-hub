import { useMemo, useState } from 'react'
import Modal from './Modal'
import { useDocuments } from '../api/documents'

export type DocRefInsertKind = 'embed' | 'link'

interface DocRefPickerModalProps {
  excludeId?: number | null
  onInsert: (snippet: string) => void
  onClose: () => void
}

// 설계 §4.19 ①, stage-17 §4 — DocEditor "참조 삽입 도우미"의 문서 검색 팝업.
// AddRelationModal의 검색 팝업 패턴을 그대로 재사용(검색 API 도입 전까지 목록 + 클라이언트
// 필터) — 선택 시 임베드(`![[DOC-xxxx]]`) 또는 링크(`[[DOC-xxxx|표시명]]`) 스니펫을 돌려주고,
// 실제 삽입(커서 위치)은 호출부(DocEditor)가 담당한다.
export default function DocRefPickerModal({ excludeId, onInsert, onClose }: DocRefPickerModalProps) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [kind, setKind] = useState<DocRefInsertKind>('embed')

  const documentsQuery = useDocuments({ page: 1, size: 200 })

  const candidates = useMemo(() => {
    const items = documentsQuery.data?.items ?? []
    const q = query.trim().toLowerCase()
    return items
      .filter((d) => d.id !== excludeId)
      .filter((d) => !q || d.title.toLowerCase().includes(q) || d.doc_no.toLowerCase().includes(q))
      .slice(0, 30)
  }, [documentsQuery.data, query, excludeId])

  const selected = candidates.find((d) => d.id === selectedId) ?? null

  function handleInsert() {
    if (!selected) return
    const snippet = kind === 'embed' ? `![[${selected.doc_no}]]` : `[[${selected.doc_no}|${selected.title}]]`
    onInsert(snippet)
    onClose()
  }

  return (
    <Modal title="문서 참조 삽입" onClose={onClose} widthClass="max-w-lg">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setKind('embed')}
            className={`flex-1 rounded border px-3 py-1.5 ${
              kind === 'embed' ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
            }`}
          >
            임베드 <span className="text-[11px] text-muted">![[DOC-xxxx]]</span>
          </button>
          <button
            type="button"
            onClick={() => setKind('link')}
            className={`flex-1 rounded border px-3 py-1.5 ${
              kind === 'link' ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
            }`}
          >
            링크 <span className="text-[11px] text-muted">[[DOC-xxxx|표시명]]</span>
          </button>
        </div>
        <p className="text-xs text-muted">
          {kind === 'embed'
            ? '대상 문서 본문이 이 자리에 카드로 펼쳐집니다.'
            : '대상 문서 상세로 이동하는 링크 칩이 삽입됩니다.'}
        </p>

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
            disabled={selectedId == null}
            onClick={handleInsert}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            삽입
          </button>
        </div>
      </div>
    </Modal>
  )
}
