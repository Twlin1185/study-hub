import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSearch } from '../api/search'
import { ApiError } from '../api/client'
import type { DocumentType } from '../api/types'
import { safeSnippetHtml } from '../utils/snippet'

const TYPE_LABEL: Record<DocumentType, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출',
  flashcard: '카드',
}

const PAGE_SIZE = 30

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §4.9(v1.5), §5 — 검색 결과 화면. 타입 배지·스니펫(하이라이트) 통합, 클릭 시 문서 상세
// 이동. 응답은 §3 페이지 봉투({items, total, page, size}).
export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const q = searchParams.get('q') ?? ''
  const typeParam = (searchParams.get('type') as DocumentType | null) ?? ''
  const page = Number(searchParams.get('page') ?? '1') || 1

  const [input, setInput] = useState(q)

  const searchQuery = useSearch(q, typeParam, page, PAGE_SIZE)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const next = new URLSearchParams(searchParams)
    if (input.trim()) next.set('q', input.trim())
    else next.delete('q')
    next.delete('page')
    setSearchParams(next)
  }

  function setType(type: DocumentType | '') {
    const next = new URLSearchParams(searchParams)
    if (type) next.set('type', type)
    else next.delete('type')
    next.delete('page')
    setSearchParams(next)
  }

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(nextPage))
    setSearchParams(next)
  }

  const total = searchQuery.data?.total ?? 0
  const hasMore = page * PAGE_SIZE < total

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-xl font-semibold text-primary">검색</h1>

      <form onSubmit={handleSubmit} className="mb-3 flex gap-2">
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="제목·본문·해설·태그 검색…"
          className="flex-1 rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
        >
          검색
        </button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['', 'concept', 'question', 'past_question', 'flashcard'] as const).map((t) => (
          <button
            key={t || 'all'}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              typeParam === t ? 'bg-accent text-on-accent' : 'bg-surface text-muted hover:bg-bg'
            }`}
          >
            {t ? TYPE_LABEL[t] : '전체'}
          </button>
        ))}
      </div>

      {!q && <p className="text-sm text-muted">검색어를 입력하세요.</p>}

      {q && searchQuery.isLoading && <p className="text-sm text-muted">검색 중…</p>}
      {q && searchQuery.isError && (
        <p className="text-sm text-wrong">{errMsg(searchQuery.error, '검색에 실패했습니다.')}</p>
      )}
      {q && searchQuery.data && searchQuery.data.items.length === 0 && (
        <p className="text-sm text-muted">"{q}"에 대한 검색 결과가 없습니다.</p>
      )}

      {q && searchQuery.data && total > 0 && (
        <p className="mb-2 text-xs text-muted">총 {total}건</p>
      )}

      <ul className="flex flex-col gap-2">
        {(searchQuery.data?.items ?? []).map((item) => (
          <li key={item.document_id}>
            <button
              type="button"
              onClick={() => navigate(`/docs/${item.document_id}`)}
              className="block w-full rounded-lg border border-border bg-surface p-3 text-left hover:bg-bg"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                  {TYPE_LABEL[item.type] ?? item.type}
                </span>
                <span className="text-xs text-muted">{item.doc_no}</span>
              </div>
              <p className="mb-1 text-sm font-medium text-primary">{item.title}</p>
              {/* mark 태그만 남기고 나머지는 이스케이프한 안전한 스니펫 (utils/snippet.ts) */}
              <p
                className="text-xs text-muted [&_mark]:rounded [&_mark]:bg-accent-soft [&_mark]:px-0.5 [&_mark]:text-accent"
                dangerouslySetInnerHTML={{ __html: safeSnippetHtml(item.snippet) }}
              />
            </button>
          </li>
        ))}
      </ul>

      {q && searchQuery.data && total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg disabled:opacity-40"
          >
            ← 이전
          </button>
          <span className="text-xs text-muted">{page} 페이지</span>
          <button
            type="button"
            disabled={!hasMore}
            onClick={() => goToPage(page + 1)}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg disabled:opacity-40"
          >
            다음 →
          </button>
        </div>
      )}
    </div>
  )
}
