import { useMemo, useState } from 'react'
import Modal from './Modal'
import type { CategoryNode } from '../api/types'
import { collectDescendantIds, findCategory } from '../utils/tree'

// 분류 삭제 모달 (stage-50, FB-24 ①·② — 결함 수정 + 선택형 삭제). 수치는 트리 응답만으로 클라이언트
// 계산(새 API 없음) — c=하위 분류 개수, d=직계 연결 문서(doc_count), D=하위 포함 연결 문서 합.
// ConfirmDialog는 옵션 슬롯이 없어 재사용하지 않고 Modal 위에 직접 구성한다(규약 G).

function sumDocCount(node: CategoryNode): number {
  return node.doc_count + node.children.reduce((acc, c) => acc + sumDocCount(c), 0)
}

export interface DeleteCategoryOpts {
  on_documents?: 'unlink' | 'reparent'
  recursive?: boolean
}

interface DeleteCategoryModalProps {
  node: CategoryNode
  allNodes: CategoryNode[]
  submitting?: boolean
  errorMessage?: string | null
  onClose: () => void
  onConfirm: (opts: DeleteCategoryOpts) => void
}

export default function DeleteCategoryModal({
  node,
  allNodes,
  submitting,
  errorMessage,
  onClose,
  onConfirm,
}: DeleteCategoryModalProps) {
  const c = useMemo(() => collectDescendantIds(node).size - 1, [node])
  const d = node.doc_count
  const D = useMemo(() => sumDocCount(node), [node])

  const [recursive, setRecursive] = useState(false)
  const [onDocuments, setOnDocuments] = useState<'unlink' | 'reparent'>('unlink')

  const parent = node.parent_id != null ? findCategory(allNodes, node.parent_id) : null
  const reparentAvailable = node.parent_id != null

  const targetLinks = c > 0 && recursive ? D : d
  const showRecursiveCheckbox = c > 0
  const showDocOptions = targetLinks > 0
  const simple = c === 0 && d === 0

  const canSubmit = !(showRecursiveCheckbox && !recursive)

  const summaryParts: string[] = []
  if (c > 0) summaryParts.push(`하위 분류 ${c}개`)
  if (D > 0) {
    summaryParts.push(`연결 문서 ${d}건${D !== d ? `(하위 포함 ${D}건)` : ''}`)
  }

  function handleConfirm() {
    if (!canSubmit) return
    const opts: DeleteCategoryOpts = {}
    if (showRecursiveCheckbox && recursive) opts.recursive = true
    if (showDocOptions) opts.on_documents = onDocuments
    onConfirm(opts)
  }

  return (
    <Modal title="분류 삭제" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-primary">{`"${node.name}" 분류를 삭제할까요?`}</p>

        {summaryParts.length > 0 && <p className="text-sm text-muted">{summaryParts.join(' · ')}</p>}

        {showRecursiveCheckbox && (
          <div className="flex flex-col gap-1">
            <label className="flex items-start gap-2 text-sm text-primary">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
              />
              <span>하위 분류 {c}개도 함께 삭제</span>
            </label>
            {!recursive && (
              <p className="pl-6 text-xs text-muted">하위 분류가 있으면 함께 삭제하거나 먼저 이동하세요</p>
            )}
          </div>
        )}

        {showDocOptions && (
          <div className="flex flex-col gap-2 rounded border border-border bg-bg p-2">
            <p className="text-xs font-medium text-muted">문서 처리</p>
            <label className="flex items-start gap-2 text-sm text-primary">
              <input
                type="radio"
                name="on_documents"
                className="mt-0.5 shrink-0"
                checked={onDocuments === 'unlink'}
                onChange={() => setOnDocuments('unlink')}
              />
              <span>
                연결만 해제
                <br />
                <span className="text-xs text-muted">문서는 남고 &apos;단일 문서&apos;로 표시됩니다</span>
              </span>
            </label>
            {reparentAvailable && (
              <label className="flex items-start gap-2 text-sm text-primary">
                <input
                  type="radio"
                  name="on_documents"
                  className="mt-0.5 shrink-0"
                  checked={onDocuments === 'reparent'}
                  onChange={() => setOnDocuments('reparent')}
                />
                <span>{`부모 분류 '${parent?.name ?? ''}'로 재연결`}</span>
              </label>
            )}
          </div>
        )}

        {simple && (
          <p className="text-sm text-muted">하위 분류나 연결된 문서가 없습니다.</p>
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
            disabled={submitting || !canSubmit}
            onClick={handleConfirm}
            className="rounded bg-wrong px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            삭제
          </button>
        </div>
      </div>
    </Modal>
  )
}
