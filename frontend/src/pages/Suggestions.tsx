import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApplySuggestions, useSuggestions } from '../api/suggestions'
import { ApiError } from '../api/client'
import ImproveInbox from '../components/ImproveInbox'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

type InboxTab = 'classify' | 'improve'

// 설계 §4.9·§4.22 — 제안함. 두 수신함: [분류 연결](기존 — 대기 중 연결 제안 개별/일괄 승인·거절,
// 무변경) / [반입 개선](S20, F46 — 실패 사례·개선 제안·회귀 재검증, ImproveInbox). nav 배지는
// 두 pending 합산(SuggestionsNavBadge — 결정 ①).
export default function SuggestionsPage() {
  const [tab, setTab] = useState<InboxTab>('classify')
  const navigate = useNavigate()
  const suggestionsQuery = useSuggestions()
  const applySuggestions = useApplySuggestions()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)

  const items = suggestionsQuery.data ?? []

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function applyOne(id: number, action: 'approve' | 'reject') {
    setNotice(null)
    applySuggestions.mutate(
      { approve: action === 'approve' ? [id] : [], reject: action === 'reject' ? [id] : [] },
      {
        onSuccess: () => {
          setSelected((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        },
      },
    )
  }

  function applySelected(action: 'approve' | 'reject') {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    setNotice(null)
    applySuggestions.mutate(
      { approve: action === 'approve' ? ids : [], reject: action === 'reject' ? ids : [] },
      {
        onSuccess: () => {
          setSelected(new Set())
          setNotice(action === 'approve' ? `${ids.length}건 승인했습니다.` : `${ids.length}건 거절했습니다.`)
        },
      },
    )
  }

  return (
    <div className={`mx-auto p-4 ${tab === 'improve' ? 'max-w-3xl' : 'max-w-2xl'}`}>
      <h1 className="mb-1 text-xl font-semibold text-primary">제안함</h1>

      <div className="mb-4 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('classify')}
          aria-pressed={tab === 'classify'}
          className={`px-3 py-2 text-sm font-medium ${
            tab === 'classify' ? 'border-b-2 border-accent text-accent' : 'text-muted hover:text-primary'
          }`}
        >
          분류 연결
        </button>
        <button
          type="button"
          onClick={() => setTab('improve')}
          aria-pressed={tab === 'improve'}
          className={`px-3 py-2 text-sm font-medium ${
            tab === 'improve' ? 'border-b-2 border-accent text-accent' : 'text-muted hover:text-primary'
          }`}
        >
          반입 개선
        </button>
      </div>

      {tab === 'improve' && <ImproveInbox />}

      {tab === 'classify' && (
        <>
          <p className="mb-4 text-sm text-muted">
            태그 규칙이 찾아낸 분류 연결 제안입니다. 승인하면 실제로 연결되고, 거절하면 같은 제안이 다시
            올라오지 않습니다.
          </p>

          {suggestionsQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {suggestionsQuery.isError && (
        <p className="text-sm text-wrong">{errMsg(suggestionsQuery.error, '제안 목록을 불러오지 못했습니다.')}</p>
      )}
      {suggestionsQuery.data && items.length === 0 && (
        <p className="text-sm text-muted">대기 중인 제안이 없습니다.</p>
      )}

      {items.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <span className="text-primary">{items.length}건 대기 중 · {selected.size}건 선택</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={selected.size === 0 || applySuggestions.isPending}
              onClick={() => applySelected('reject')}
              className="rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-bg disabled:opacity-40"
            >
              선택 거절
            </button>
            <button
              type="button"
              disabled={selected.size === 0 || applySuggestions.isPending}
              onClick={() => applySelected('approve')}
              className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              선택 승인
            </button>
          </div>
        </div>
      )}

      {applySuggestions.isError && (
        <p className="mb-3 text-sm text-wrong">{errMsg(applySuggestions.error, '처리에 실패했습니다.')}</p>
      )}
      {notice && <p className="mb-3 text-sm text-correct">{notice}</p>}

      <ul className="flex flex-col gap-2">
        {items.map((s) => (
          <li key={s.id} className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1.5"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
              />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => navigate(`/docs/${s.document_id}`)}
                  className="block w-full text-left"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted">{s.doc_no}</span>
                  </div>
                  <p className="truncate text-sm font-medium text-primary">{s.title}</p>
                  <p className="truncate text-xs text-muted">→ {s.category_path}</p>
                  {s.tag_rule_query ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted">규칙: {s.tag_rule_query}</p>
                  ) : (
                    s.tag_rule_id == null && (
                      <p className="mt-0.5 truncate text-[11px] text-muted">규칙: (삭제됨)</p>
                    )
                  )}
                </button>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  disabled={applySuggestions.isPending}
                  onClick={() => applyOne(s.id, 'approve')}
                  className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                >
                  승인
                </button>
                <button
                  type="button"
                  disabled={applySuggestions.isPending}
                  onClick={() => applyOne(s.id, 'reject')}
                  className="rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-bg disabled:opacity-50"
                >
                  거절
                </button>
              </div>
            </div>
          </li>
        ))}
          </ul>
        </>
      )}
    </div>
  )
}
