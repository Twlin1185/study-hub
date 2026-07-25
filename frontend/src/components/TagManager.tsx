import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeleteTag, useMergeTags, useRenameTag, useSimilarTags, useTags } from '../api/tags'
import { ApiError } from '../api/client'
import type { Tag, TagSimilarPair } from '../api/types'
import ConfirmDialog from './ConfirmDialog'
import Modal from './Modal'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 409(중복·사용 중)는 사용자에게 "병합을 사용하세요"로 안내한다(설계 §5.11).
function renameErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) return '같은 이름의 태그가 이미 있습니다. 병합을 사용하세요.'
  return errMsg(e, '이름 변경에 실패했습니다.')
}

type SortKey = 'name' | 'usage'

// 설계 §5.11, F38 — 태그 관리자(병합 "도구"를 관리 "화면"으로 승격).
export default function TagManager() {
  const tagsQuery = useTags()
  const similarQuery = useSimilarTags()
  const mergeTags = useMergeTags()
  const renameTag = useRenameTag()
  const deleteTag = useDeleteTag()

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('usage')
  const [notice, setNotice] = useState<string | null>(null)
  // 유사쌍 "무시" — 세션 내 숨김만(저장 안 함, 과설계 방지).
  const [ignoredPairs, setIgnoredPairs] = useState<Set<string>>(new Set())
  const [mergeTarget, setMergeTarget] = useState<Tag | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)

  const tags = tagsQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : [...tags]
    list.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : b.usage_count - a.usage_count || a.name.localeCompare(b.name),
    )
    return list
  }, [tags, search, sort])

  const visiblePairs = (similarQuery.data ?? []).filter((p) => !ignoredPairs.has(pairKey(p)))

  function handleRename(tag: Tag, name: string, onDone: (err: string | null) => void) {
    const trimmed = name.trim()
    if (!trimmed || trimmed === tag.name) {
      onDone(null)
      return
    }
    renameTag.mutate(
      { id: tag.id, name: trimmed },
      {
        onSuccess: () => onDone(null),
        onError: (e) => onDone(renameErrorMessage(e)),
      },
    )
  }

  function doMerge(fromId: number, toId: number, label: string) {
    mergeTags.mutate(
      { from_id: fromId, to_id: toId },
      {
        onSuccess: () => {
          setNotice(label)
          setMergeTarget(null)
        },
        onError: (e) => setNotice(errMsg(e, '병합에 실패했습니다.')),
      },
    )
  }

  return (
    <section className="mb-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-primary">태그 관리자</h2>
      <p className="mb-3 text-xs text-muted">
        태그 이름 변경·병합·삭제와 유사(오타 의심) 태그 정리를 한 곳에서 처리합니다.
      </p>

      {notice && <p className="mb-3 text-sm text-correct">{notice}</p>}

      {/* 유사 태그 제안 */}
      {visiblePairs.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning bg-accent-soft p-3">
          <h3 className="mb-2 text-xs font-semibold text-primary">유사 태그 제안</h3>
          <ul className="flex flex-col gap-2">
            {visiblePairs.map((pair) => (
              <SimilarPairRow
                key={pairKey(pair)}
                pair={pair}
                merging={mergeTags.isPending}
                onMerge={(fromId, toId, keepName) =>
                  doMerge(fromId, toId, `『${keepName}』(으)로 병합했습니다.`)
                }
                onIgnore={() => setIgnoredPairs((prev) => new Set(prev).add(pairKey(pair)))}
              />
            ))}
          </ul>
        </div>
      )}

      {/* 검색·정렬 */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="태그 검색…"
          className="flex-1 rounded border border-border bg-bg px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
        />
        <div className="flex gap-1">
          {(['usage', 'name'] as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
              className={`rounded border px-2.5 py-1.5 text-xs ${
                sort === key ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-muted'
              }`}
            >
              {key === 'usage' ? '사용 수순' : '이름순'}
            </button>
          ))}
        </div>
      </div>

      {tagsQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {tagsQuery.isError && <p className="text-sm text-wrong">태그를 불러오지 못했습니다.</p>}
      {tagsQuery.data && filtered.length === 0 && <p className="text-sm text-muted">태그가 없습니다.</p>}

      <ul className="flex flex-col divide-y divide-border">
        {filtered.map((tag) => (
          <TagRow
            key={tag.id}
            tag={tag}
            onRename={handleRename}
            onMerge={() => setMergeTarget(tag)}
            onDelete={() => setDeleteTarget(tag)}
          />
        ))}
      </ul>

      {mergeTarget && (
        <MergeTargetModal
          source={mergeTarget}
          tags={tags}
          merging={mergeTags.isPending}
          onClose={() => setMergeTarget(null)}
          onConfirm={(toId, keepName) =>
            doMerge(mergeTarget.id, toId, `『${mergeTarget.name}』을(를) 『${keepName}』(으)로 병합했습니다.`)
          }
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="태그 삭제"
          message={`『${deleteTarget.name}』 태그를 삭제할까요? (미사용 태그만 삭제됩니다)`}
          confirmLabel="삭제"
          danger
          submitting={deleteTag.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() =>
            deleteTag.mutate(deleteTarget.id, {
              onSuccess: () => {
                setNotice(`『${deleteTarget.name}』을(를) 삭제했습니다.`)
                setDeleteTarget(null)
              },
              onError: (e) => {
                setNotice(errMsg(e, '삭제에 실패했습니다 (사용 중인 태그는 병합으로 정리하세요).'))
                setDeleteTarget(null)
              },
            })
          }
        />
      )}
    </section>
  )
}

function pairKey(pair: TagSimilarPair): string {
  const [x, y] = [pair.a.id, pair.b.id].sort((m, n) => m - n)
  return `${x}-${y}`
}

function SimilarPairRow({
  pair,
  merging,
  onMerge,
  onIgnore,
}: {
  pair: TagSimilarPair
  merging: boolean
  onMerge: (fromId: number, toId: number, keepName: string) => void
  onIgnore: () => void
}) {
  const reasonLabel = pair.reason === 'space' ? '공백 차이' : pair.reason === 'case' ? '대소문자 차이' : '오타 의심'
  return (
    <li className="flex flex-col gap-2 rounded border border-border bg-surface p-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-primary">
        『{pair.a.name}』({pair.a.doc_count}) ↔ 『{pair.b.name}』({pair.b.doc_count})
        <span className="ml-1 text-xs text-muted">· {reasonLabel}</span>
      </span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={merging}
          onClick={() => onMerge(pair.b.id, pair.a.id, pair.a.name)}
          className="rounded border border-accent bg-accent-soft px-2 py-1 text-xs font-medium text-accent hover:opacity-90 disabled:opacity-50"
        >
          『{pair.a.name}』 남기기
        </button>
        <button
          type="button"
          disabled={merging}
          onClick={() => onMerge(pair.a.id, pair.b.id, pair.b.name)}
          className="rounded border border-accent bg-accent-soft px-2 py-1 text-xs font-medium text-accent hover:opacity-90 disabled:opacity-50"
        >
          『{pair.b.name}』 남기기
        </button>
        <button
          type="button"
          onClick={onIgnore}
          className="rounded border border-border px-2 py-1 text-xs text-muted hover:bg-bg"
        >
          무시
        </button>
      </div>
    </li>
  )
}

function TagRow({
  tag,
  onRename,
  onMerge,
  onDelete,
}: {
  tag: Tag
  onRename: (tag: Tag, name: string, onDone: (err: string | null) => void) => void
  onMerge: () => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tag.name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const ruleUsed = (tag.rule_count ?? 0) > 0
  const deletable = tag.usage_count === 0 && !ruleUsed

  function submit() {
    setSaving(true)
    setError(null)
    onRename(tag, name, (err) => {
      setSaving(false)
      if (err) {
        setError(err)
      } else {
        setEditing(false)
      }
    })
  }

  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      {editing ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={saving}
              onClick={submit}
              className="shrink-0 rounded bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setName(tag.name)
                setError(null)
              }}
              className="shrink-0 rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-bg"
            >
              취소
            </button>
          </div>
          {error && <p className="text-xs text-wrong">{error}</p>}
        </div>
      ) : (
        <>
          <Link
            to={`/explore?tag=${encodeURIComponent(tag.name)}`}
            className="min-w-0 flex-1 truncate text-primary hover:underline"
            title="사용 문서 보기"
          >
            #{tag.name}
          </Link>
          <span className="shrink-0 text-xs text-muted">{tag.usage_count}개</span>
          {ruleUsed && (
            <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
              규칙 {tag.rule_count}
            </span>
          )}
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg"
            >
              이름 변경
            </button>
            <button
              type="button"
              onClick={onMerge}
              className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg"
            >
              병합
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={!deletable}
              title={deletable ? undefined : '사용 중이거나 규칙이 참조하는 태그는 삭제할 수 없습니다. 병합으로 정리하세요.'}
              className="rounded border border-border px-2 py-1 text-xs text-wrong hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              삭제
            </button>
          </div>
        </>
      )}
    </li>
  )
}

function MergeTargetModal({
  source,
  tags,
  merging,
  onClose,
  onConfirm,
}: {
  source: Tag
  tags: Tag[]
  merging: boolean
  onClose: () => void
  onConfirm: (toId: number, keepName: string) => void
}) {
  const [toId, setToId] = useState('')
  const target = tags.find((t) => String(t.id) === toId)

  return (
    <Modal title={`『${source.name}』 병합`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-primary">
          『{source.name}』({source.usage_count}개)의 문서 연결을 다른 태그로 합칩니다. 원래 태그는 사라집니다
          (되돌릴 수 없음).
        </p>
        <label className="flex flex-col gap-1 text-sm">
          남길 태그
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          >
            <option value="">태그 선택…</option>
            {tags
              .filter((t) => t.id !== source.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.name} ({t.usage_count})
                </option>
              ))}
          </select>
        </label>
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
            disabled={!target || merging}
            onClick={() => target && onConfirm(target.id, target.name)}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            병합
          </button>
        </div>
      </div>
    </Modal>
  )
}
