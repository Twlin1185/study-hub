import { useState } from 'react'
import { useMergeTags, useTags } from '../api/tags'
import { ApiError } from '../api/client'
import ConfirmDialog from './ConfirmDialog'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §4.9, §5.11 — 오타 태그 병합 도구. from 태그를 to 태그로 합치고 원래 태그 연결은 사라진다.
export default function TagMergeTool() {
  const tagsQuery = useTags()
  const mergeTags = useMergeTags()

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const tags = tagsQuery.data ?? []
  const fromTag = tags.find((t) => String(t.id) === fromId)
  const toTag = tags.find((t) => String(t.id) === toId)

  function handleRequestMerge() {
    setError(null)
    if (!fromId || !toId) {
      setError('병합할 두 태그를 모두 선택하세요.')
      return
    }
    if (fromId === toId) {
      setError('서로 다른 태그를 선택하세요.')
      return
    }
    setConfirming(true)
  }

  return (
    <section className="mb-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-primary">태그 병합</h2>
      <p className="mb-3 text-xs text-muted">
        오타·중복 태그를 하나로 합칩니다. "이 태그"의 문서 연결이 모두 "저 태그"로 옮겨지고
        원래 태그는 사라집니다 (되돌릴 수 없음).
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        >
          <option value="">이 태그 (합쳐질 태그)…</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name} ({t.usage_count})
            </option>
          ))}
        </select>
        <span className="shrink-0 text-sm text-muted">→</span>
        <select
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        >
          <option value="">저 태그 (남을 태그)…</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name} ({t.usage_count})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleRequestMerge}
          disabled={mergeTags.isPending}
          className="shrink-0 rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          병합
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-wrong">{error}</p>}
      {notice && <p className="mt-2 text-sm text-correct">{notice}</p>}

      {confirming && fromTag && toTag && (
        <ConfirmDialog
          title="태그 병합"
          message={`#${fromTag.name} (${fromTag.usage_count}건)을(를) #${toTag.name}로 합칠까요? 되돌릴 수 없습니다.`}
          confirmLabel="병합"
          danger
          submitting={mergeTags.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={() =>
            mergeTags.mutate(
              { from_id: Number(fromId), to_id: Number(toId) },
              {
                onSuccess: () => {
                  setConfirming(false)
                  setNotice(`#${fromTag.name}을(를) #${toTag.name}로 병합했습니다.`)
                  setFromId('')
                  setToId('')
                },
                onError: (e) => {
                  setConfirming(false)
                  setError(errMsg(e, '병합에 실패했습니다.'))
                },
              },
            )
          }
        />
      )}
    </section>
  )
}
