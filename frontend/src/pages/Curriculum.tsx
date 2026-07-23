import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useCategoryTree,
  useCreateCategory,
  useDeleteCategory,
  useMoveCategory,
  useUpdateCategory,
} from '../api/categories'
import { ApiError } from '../api/client'
import ProgressBar from '../components/ProgressBar'
import CategoryFormModal from '../components/CategoryFormModal'
import MoveCategoryModal from '../components/MoveCategoryModal'
import ConfirmDialog from '../components/ConfirmDialog'
import type { CategoryNode } from '../api/types'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'add-category' }
  | { kind: 'rename-category'; node: CategoryNode }
  | { kind: 'move-category'; node: CategoryNode }
  | { kind: 'delete-category'; node: CategoryNode }

// 설계 §5.4 — 최상위(자격증) 카드 목록 → 시험 선택.
// S4: 편집 모드 토글 시 [+ 시험 추가] + 카드별 [수정]·[이동]·[삭제] — 탐색과 동일한 공용 모달/API 재사용.
export default function CurriculumPage() {
  const treeQuery = useCategoryTree()
  const [editMode, setEditMode] = useState(false)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })
  const [modalError, setModalError] = useState<string | null>(null)

  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const moveCategory = useMoveCategory()
  const deleteCategory = useDeleteCategory()

  function closeModal() {
    setModal({ kind: 'none' })
    setModalError(null)
  }

  if (treeQuery.isLoading) return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  if (treeQuery.isError) {
    return (
      <p className="p-4 text-sm text-wrong">
        {errMsg(treeQuery.error, '분류를 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.')}
      </p>
    )
  }

  const nodes = treeQuery.data ?? []

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-primary">커리큘럼</h1>
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          aria-pressed={editMode}
          className={`shrink-0 rounded border px-2.5 py-1.5 text-sm ${
            editMode ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-primary'
          }`}
          title="분류 편집 모드"
        >
          ✎ 편집
        </button>
      </div>

      {editMode && (
        <button
          type="button"
          onClick={() => setModal({ kind: 'add-category' })}
          className="mb-4 w-full rounded-lg border border-dashed border-accent bg-accent-soft px-4 py-2.5 text-sm font-medium text-accent hover:opacity-90"
        >
          + 시험 추가
        </button>
      )}

      {nodes.length === 0 && (
        <p className="text-sm text-muted">등록된 분류가 없습니다. 탐색에서 분류를 먼저 추가하세요.</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {nodes.map((node) => (
          <div
            key={node.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <Link to={`/curriculum/${node.id}`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-base font-medium text-primary">{node.name}</h2>
                {node.level_hint && <span className="shrink-0 text-xs text-muted">{node.level_hint}</span>}
              </div>
              <span className="text-xs text-muted">문서 {node.doc_count}개</span>
              {node.progress != null && (
                <ProgressBar value={node.progress} label={`${Math.round(node.progress * 100)}%`} />
              )}
              {node.exam_date && <span className="text-xs text-muted">시험일 {node.exam_date}</span>}
            </Link>
            {editMode && (
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => setModal({ kind: 'rename-category', node })}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-primary hover:bg-surface-raised"
                >
                  ✎ 수정
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ kind: 'move-category', node })}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-primary hover:bg-surface-raised"
                >
                  ⇄ 이동
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ kind: 'delete-category', node })}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-wrong hover:bg-surface-raised"
                >
                  🗑 삭제
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {modal.kind === 'add-category' && (
        <CategoryFormModal
          title="최상위 분류(시험) 추가"
          submitLabel="추가"
          submitting={createCategory.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onSubmit={(values) => {
            setModalError(null)
            createCategory.mutate(
              { parent_id: null, ...values },
              {
                onSuccess: closeModal,
                onError: (e) => setModalError(errMsg(e, '분류 생성에 실패했습니다.')),
              },
            )
          }}
        />
      )}

      {modal.kind === 'rename-category' && (
        <CategoryFormModal
          title={`"${modal.node.name}" 수정`}
          submitLabel="수정"
          initial={{
            name: modal.node.name,
            level_hint: modal.node.level_hint,
            exam_date: modal.node.exam_date,
          }}
          submitting={updateCategory.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onSubmit={(values) => {
            if (modal.kind !== 'rename-category') return
            setModalError(null)
            updateCategory.mutate(
              { id: modal.node.id, ...values },
              {
                onSuccess: closeModal,
                onError: (e) => setModalError(errMsg(e, '수정에 실패했습니다.')),
              },
            )
          }}
        />
      )}

      {modal.kind === 'move-category' && (
        <MoveCategoryModal
          node={modal.node}
          allNodes={nodes}
          submitting={moveCategory.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onSubmit={(parentId, sortOrder) => {
            if (modal.kind !== 'move-category') return
            setModalError(null)
            moveCategory.mutate(
              { id: modal.node.id, parent_id: parentId, sort_order: sortOrder },
              {
                onSuccess: closeModal,
                onError: (e) => setModalError(errMsg(e, '이동할 수 없습니다 (자기 자신/자손 하위로는 이동 불가).')),
              },
            )
          }}
        />
      )}

      {modal.kind === 'delete-category' && (
        <ConfirmDialog
          title="분류 삭제"
          message={`"${modal.node.name}" 분류를 삭제할까요? 하위 분류나 연결된 문서가 있으면 삭제할 수 없습니다.`}
          confirmLabel="삭제"
          danger
          submitting={deleteCategory.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onConfirm={() => {
            if (modal.kind !== 'delete-category') return
            setModalError(null)
            deleteCategory.mutate(modal.node.id, {
              onSuccess: closeModal,
              onError: (e) =>
                setModalError(errMsg(e, '삭제할 수 없습니다. 하위 분류/연결된 문서를 먼저 정리하세요.')),
            })
          }}
        />
      )}
    </div>
  )
}
