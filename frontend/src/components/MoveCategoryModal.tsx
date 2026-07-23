import { useState } from 'react'
import Modal from './Modal'
import type { CategoryNode } from '../api/types'
import { collectDescendantIds, flattenCategories } from '../utils/tree'

interface MoveCategoryModalProps {
  node: CategoryNode
  allNodes: CategoryNode[]
  onSubmit: (parentId: number | null, sortOrder: number) => void
  onClose: () => void
  submitting?: boolean
  errorMessage?: string | null
}

export default function MoveCategoryModal({
  node,
  allNodes,
  onSubmit,
  onClose,
  submitting,
  errorMessage,
}: MoveCategoryModalProps) {
  const [parentId, setParentId] = useState<string>(String(node.parent_id ?? ''))
  const [sortOrder, setSortOrder] = useState(node.sort_order)

  const forbidden = collectDescendantIds(node)
  const options = flattenCategories(allNodes).filter((c) => !forbidden.has(c.id))

  return (
    <Modal title={`"${node.name}" 이동`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          이동할 위치 (부모 분류)
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          >
            <option value="">(최상위)</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {'　'.repeat(c.depth)}
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          정렬 순서
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
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
            disabled={submitting}
            onClick={() => onSubmit(parentId ? Number(parentId) : null, sortOrder)}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            이동
          </button>
        </div>
      </div>
    </Modal>
  )
}
