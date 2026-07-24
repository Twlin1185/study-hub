import { useState } from 'react'
import { useCategoryTree } from '../api/categories'
import {
  useCreateTagRule,
  useDeleteTagRule,
  useScanTagRule,
  useTagRules,
  useUnlinkTagRule,
  useUpdateTagRule,
} from '../api/tagRules'
import type { TagRule, TagRuleMode } from '../api/types'
import { ApiError } from '../api/client'
import { flattenCategories } from '../utils/tree'
import ConfirmDialog from './ConfirmDialog'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

const MODE_LABEL: Record<TagRuleMode, string> = {
  auto: '자동 연결',
  suggest: '제안함에 올리기',
}

// 설계 §4.9, §5.11 — 태그 자동 분류 규칙(F21) 관리. 설정 화면에 배치(§4.9 "설정 또는 탐색 내
// 규칙 관리" 중 설정 선택 — 백업·태그 병합 등 S6 관리 도구가 모두 설정 화면에 모이는 관례를 따름).
export default function TagRuleManager() {
  const rulesQuery = useTagRules()
  const treeQuery = useCategoryTree()
  const createRule = useCreateTagRule()
  const updateRule = useUpdateTagRule()
  const deleteRule = useDeleteTagRule()
  const scanRule = useScanTagRule()
  const unlinkRule = useUnlinkTagRule()

  const flatCategories = flattenCategories(treeQuery.data ?? [])

  const [tagQuery, setTagQuery] = useState('')
  const [targetCategoryId, setTargetCategoryId] = useState('')
  const [mode, setMode] = useState<TagRuleMode>('suggest')
  const [formError, setFormError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmUnlink, setConfirmUnlink] = useState<TagRule | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TagRule | null>(null)

  function resetForm() {
    setTagQuery('')
    setTargetCategoryId('')
    setMode('suggest')
    setEditingId(null)
    setFormError(null)
  }

  function handleEdit(rule: TagRule) {
    setEditingId(rule.id)
    setTagQuery(rule.tag_query)
    setTargetCategoryId(String(rule.category_id))
    setMode(rule.mode)
    setFormError(null)
  }

  function handleSubmit() {
    if (!tagQuery.trim()) {
      setFormError('태그 조건을 입력하세요 (예: 정규화 또는 정규화 OR 이상현상).')
      return
    }
    if (!targetCategoryId) {
      setFormError('연결할 분류를 선택하세요.')
      return
    }
    setFormError(null)
    const body = { tag_query: tagQuery.trim(), category_id: Number(targetCategoryId), mode }

    if (editingId != null) {
      updateRule.mutate(
        { id: editingId, ...body },
        {
          onSuccess: () => {
            resetForm()
            setNotice('규칙을 수정했습니다.')
          },
          onError: (e) => setFormError(errMsg(e, '수정에 실패했습니다.')),
        },
      )
    } else {
      createRule.mutate(body, {
        onSuccess: () => {
          resetForm()
          setNotice('규칙을 추가했습니다. 기존 문서에도 적용하려면 "일괄 스캔"을 눌러 주세요.')
        },
        onError: (e) => setFormError(errMsg(e, '규칙 생성에 실패했습니다.')),
      })
    }
  }

  return (
    <section className="mb-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-primary">태그 자동 분류 규칙</h2>
      <p className="mb-3 text-xs text-muted">
        태그 조건에 맞는 문서를 지정한 분류에 자동 연결하거나(자동 연결), 제안함에 올려 승인 후
        연결합니다(제안). 태그 조건은 단일 태그 또는 "A OR B" 결합만 지원합니다(AND·괄호 없음).
      </p>

      <div className="mb-4 flex flex-col gap-2 rounded border border-border bg-bg p-3">
        <label className="flex flex-col gap-1 text-sm">
          태그 조건
          <input
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder="예: 정규화 OR 이상현상"
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          연결할 분류
          <select
            value={targetCategoryId}
            onChange={(e) => setTargetCategoryId(e.target.value)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          >
            <option value="">분류 선택…</option>
            {flatCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {'　'.repeat(c.depth)}
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 text-sm text-primary">
          {(['suggest', 'auto'] as TagRuleMode[]).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="radio" name="tag-rule-mode" checked={mode === m} onChange={() => setMode(m)} />
              {MODE_LABEL[m]}
            </label>
          ))}
        </div>

        {formError && <p className="text-sm text-wrong">{formError}</p>}

        <div className="flex justify-end gap-2">
          {editingId != null && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
            >
              취소
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createRule.isPending || updateRule.isPending}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {editingId != null ? '수정 저장' : '+ 규칙 추가'}
          </button>
        </div>
      </div>

      {notice && <p className="mb-2 text-xs text-correct">{notice}</p>}

      {rulesQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {rulesQuery.isError && <p className="text-sm text-wrong">규칙을 불러오지 못했습니다.</p>}

      {rulesQuery.data && rulesQuery.data.length === 0 && (
        <p className="text-sm text-muted">등록된 규칙이 없습니다.</p>
      )}

      <ul className="flex flex-col gap-2">
        {(rulesQuery.data ?? []).map((rule) => (
          <li key={rule.id} className="rounded border border-border bg-bg px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-primary">
                  <span className="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                    {MODE_LABEL[rule.mode]}
                  </span>
                  {rule.tag_query}
                </p>
                <p className="truncate text-xs text-muted">
                  → {rule.category_path ?? `분류 #${rule.category_id}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => scanRule.mutate(rule.id, { onSuccess: (r) => setNotice(`제안 ${r.created}건 생성됨`) })}
                  disabled={scanRule.isPending}
                  className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
                >
                  일괄 스캔
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(rule)}
                  className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmUnlink(rule)}
                  className="rounded border border-border px-2 py-1 text-xs text-warning hover:bg-surface"
                >
                  연결 해제
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(rule)}
                  className="rounded border border-border px-2 py-1 text-xs text-wrong hover:bg-surface"
                >
                  삭제
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {confirmUnlink && (
        <ConfirmDialog
          title="규칙 연결 일괄 해제"
          message={`"${confirmUnlink.tag_query}" 규칙이 연결한 문서들을 모두 분류에서 해제할까요? 규칙 자체와 문서는 삭제되지 않습니다.`}
          confirmLabel="해제"
          danger
          submitting={unlinkRule.isPending}
          onClose={() => setConfirmUnlink(null)}
          onConfirm={() =>
            unlinkRule.mutate(confirmUnlink.id, {
              onSuccess: (r) => {
                setNotice(`${r.unlinked}건 연결 해제됨`)
                setConfirmUnlink(null)
              },
            })
          }
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="규칙 삭제"
          message={`"${confirmDelete.tag_query}" 규칙을 삭제할까요? 이미 연결된 문서·이력은 유지됩니다.`}
          confirmLabel="삭제"
          danger
          submitting={deleteRule.isPending}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() =>
            deleteRule.mutate(confirmDelete.id, {
              onSuccess: () => setConfirmDelete(null),
            })
          }
        />
      )}
    </section>
  )
}
