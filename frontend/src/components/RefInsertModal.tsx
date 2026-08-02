// 참조 삽입 도우미 (설계 §4.19 ⑨ — 최소안).
// 문서 검색 팝업(기존 검색 API 재사용) → 선택 시 커서 위치에 `![[DOC-xxxx]]`(기본 임베드) 또는
// `[[DOC-xxxx]]`(링크 칩) 삽입. WYSIWYG·실시간 미리보기는 만들지 않는다.
import { useEffect, useState } from 'react'
import Modal from './Modal'
import { useSearch } from '../api/search'
import { ApiError } from '../api/client'
import type { DocumentType } from '../api/types'

const TYPE_LABEL: Record<DocumentType, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출',
  flashcard: '카드',
}

type RefMode = 'embed' | 'link'

interface RefInsertModalProps {
  onInsert: (snippet: string) => void
  onClose: () => void
}

function snippetFor(mode: RefMode, docNo: string): string {
  return mode === 'embed' ? `![[${docNo}]]` : `[[${docNo}]]`
}

export default function RefInsertModal({ onInsert, onClose }: RefInsertModalProps) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<RefMode>('embed')

  // 입력 디바운스(300ms) — 타이핑마다 검색 요청을 보내지 않는다.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300)
    return () => clearTimeout(timer)
  }, [input])

  const searchQuery = useSearch(query, '', 1, 20)
  const items = searchQuery.data?.items ?? []

  return (
    <Modal title="참조 삽입" onClose={onClose} widthClass="max-w-lg">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: 'embed', label: '임베드 ![[…]]' },
              { value: 'link', label: '링크 칩 [[…]]' },
            ] as { value: RefMode; label: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={`rounded border px-3 py-1.5 text-xs ${
                mode === opt.value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface text-primary hover:bg-bg'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          문서 검색
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="제목·본문 검색어"
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
        </label>

        <div className="max-h-64 overflow-y-auto rounded border border-border">
          {!query && <p className="p-3 text-sm text-muted">검색어를 입력하세요.</p>}
          {query && searchQuery.isLoading && <p className="p-3 text-sm text-muted">검색 중…</p>}
          {query && searchQuery.isError && (
            <p className="p-3 text-sm text-wrong">
              {searchQuery.error instanceof ApiError ? searchQuery.error.message : '검색에 실패했습니다.'}
            </p>
          )}
          {query && !searchQuery.isLoading && !searchQuery.isError && items.length === 0 && (
            <p className="p-3 text-sm text-muted">일치하는 문서가 없습니다.</p>
          )}
          {items.map((item) => (
            <button
              key={item.document_id}
              type="button"
              onClick={() => {
                onInsert(snippetFor(mode, item.doc_no))
                onClose()
              }}
              className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm text-primary last:border-b-0 hover:bg-bg"
            >
              <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                {TYPE_LABEL[item.type]}
              </span>
              <span className="shrink-0 text-[11px] text-muted">{item.doc_no}</span>
              <span className="truncate">{item.title}</span>
            </button>
          ))}
        </div>

        <p className="text-xs text-muted">
          선택하면 커서 위치에 {mode === 'embed' ? '![[DOC-번호]]' : '[[DOC-번호]]'} 가 삽입됩니다.
        </p>
      </div>
    </Modal>
  )
}
