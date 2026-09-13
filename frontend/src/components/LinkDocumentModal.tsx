import { useState } from 'react'
import Modal from './Modal'
import type { CategoryNode } from '../api/types'
import { flattenCategories } from '../utils/tree'

interface LinkDocumentModalProps {
  allNodes: CategoryNode[]
  onSubmit: (categoryId: number, localNote: string) => void
  onClose: () => void
  submitting?: boolean
  errorMessage?: string | null
  // S51(FB-25) — 선택 툴바 [분류에 연결]·[분류 이동]·문서 상세 [이동] 재사용 옵션(기본값 = 현행,
  // 기존 3 호출처 무변).
  title?: string
  submitLabel?: string
  withNote?: boolean
  // 이동 시 출발 노드를 대상 목록에서 제외(from == to 422를 UI에서 선차단).
  excludeCategoryId?: number | null
}

export default function LinkDocumentModal({
  allNodes,
  onSubmit,
  onClose,
  submitting,
  errorMessage,
  title = '분류에 연결',
  submitLabel = '연결',
  withNote = true,
  excludeCategoryId = null,
}: LinkDocumentModalProps) {
  const options = flattenCategories(allNodes).filter((c) => c.id !== excludeCategoryId)
  const [categoryId, setCategoryId] = useState<string>(options[0] ? String(options[0].id) : '')
  const [localNote, setLocalNote] = useState('')

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          연결할 분류
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          >
            {options.length === 0 && <option value="">분류가 없습니다</option>}
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {'　'.repeat(c.depth)}
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {withNote && (
          <label className="flex flex-col gap-1 text-sm">
            메모 (이 분류 맥락에서만, 선택)
            <input
              value={localNote}
              onChange={(e) => setLocalNote(e.target.value)}
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
              placeholder="예: 3회차 기출"
            />
          </label>
        )}

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
            disabled={submitting || !categoryId}
            onClick={() => onSubmit(Number(categoryId), localNote.trim())}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
