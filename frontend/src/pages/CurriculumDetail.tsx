import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useCategoryTree,
  useCreateCategory,
  useDeleteCategory,
  useMoveCategory,
  useUpdateCategory,
} from '../api/categories'
import { useCategoryStats } from '../api/stats'
import type { CategoryNode } from '../api/types'
import { findCategory } from '../utils/tree'
import { ApiError } from '../api/client'
import ProgressBar from '../components/ProgressBar'
import CategoryFormModal from '../components/CategoryFormModal'
import MoveCategoryModal from '../components/MoveCategoryModal'
import ConfirmDialog from '../components/ConfirmDialog'
import CategoryAccuracyBar from '../components/CategoryAccuracyBar'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'add-category'; parent: CategoryNode }
  | { kind: 'rename-category'; node: CategoryNode }
  | { kind: 'move-category'; node: CategoryNode }
  | { kind: 'delete-category'; node: CategoryNode }

// 설계 §5.4 — 과목/챕터 아코디언. 계층 깊이(자격증/시험/과목/단원)가 데이터마다 달라질 수 있어
// 고정 2단(과목/챕터)으로 하드코딩하지 않고, 실제 아코디언으로 임의 깊이를 지원한다.
// 문서가 없는 리프(챕터)를 "챕터"로 간주해 진도바 + [이어하기/여기서 시작] 버튼을 표시.
// S4: 편집 모드 토글 시 각 행에 [하위 추가]·[수정]·[이동]·[삭제] — 탐색과 동일한 공용 모달/API 재사용.
export default function CurriculumDetailPage() {
  const { id } = useParams<{ id: string }>()
  const categoryId = id ? Number(id) : null
  const treeQuery = useCategoryTree()
  const statsQuery = useCategoryStats(categoryId)

  const nodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data])
  const node = categoryId != null ? findCategory(nodes, categoryId) : null

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
    return <p className="p-4 text-sm text-wrong">{errMsg(treeQuery.error, '분류를 불러오지 못했습니다.')}</p>
  }
  if (!node) {
    return <p className="p-4 text-sm text-wrong">분류를 찾을 수 없습니다.</p>
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Link to="/curriculum" className="mb-3 inline-block text-sm text-muted hover:text-primary">
        ← 커리큘럼
      </Link>

      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-xl font-semibold text-primary">{node.name}</h1>
          {node.exam_date && <span className="shrink-0 text-xs text-muted">시험일 {node.exam_date}</span>}
        </div>
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
        <RowActions
          onAddChild={() => setModal({ kind: 'add-category', parent: node })}
          onRename={() => setModal({ kind: 'rename-category', node })}
          onMove={() => setModal({ kind: 'move-category', node })}
          onDelete={() => setModal({ kind: 'delete-category', node })}
          className="mb-3"
        />
      )}

      {statsQuery.data && statsQuery.data.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">과목별 정답률 (60% 미만 강조)</h2>
          <CategoryAccuracyBar items={statsQuery.data} />
        </section>
      )}

      {node.children.length === 0 ? (
        <p className="text-sm text-muted">하위 과목·챕터가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {node.children.map((child) => (
            <AccordionSection
              key={child.id}
              node={child}
              depth={0}
              editMode={editMode}
              onAddChild={(n) => setModal({ kind: 'add-category', parent: n })}
              onRename={(n) => setModal({ kind: 'rename-category', node: n })}
              onMove={(n) => setModal({ kind: 'move-category', node: n })}
              onDelete={(n) => setModal({ kind: 'delete-category', node: n })}
            />
          ))}
        </div>
      )}

      {modal.kind === 'add-category' && (
        <CategoryFormModal
          title={`"${modal.parent.name}" 하위 분류 추가`}
          submitLabel="추가"
          submitting={createCategory.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onSubmit={(values) => {
            setModalError(null)
            createCategory.mutate(
              { parent_id: modal.parent.id, ...values },
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

function RowActions({
  onAddChild,
  onRename,
  onMove,
  onDelete,
  className = '',
}: {
  onAddChild: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={onAddChild}
        className="rounded border border-border bg-surface px-2 py-1 text-xs text-primary hover:bg-bg"
      >
        + 하위 추가
      </button>
      <button
        type="button"
        onClick={onRename}
        className="rounded border border-border bg-surface px-2 py-1 text-xs text-primary hover:bg-bg"
      >
        ✎ 수정
      </button>
      <button
        type="button"
        onClick={onMove}
        className="rounded border border-border bg-surface px-2 py-1 text-xs text-primary hover:bg-bg"
      >
        ⇄ 이동
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded border border-border bg-surface px-2 py-1 text-xs text-wrong hover:bg-bg"
      >
        🗑 삭제
      </button>
    </div>
  )
}

interface AccordionSectionProps {
  node: CategoryNode
  depth: number
  editMode: boolean
  onAddChild: (node: CategoryNode) => void
  onRename: (node: CategoryNode) => void
  onMove: (node: CategoryNode) => void
  onDelete: (node: CategoryNode) => void
}

function AccordionSection({ node, depth, editMode, onAddChild, onRename, onMove, onDelete }: AccordionSectionProps) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.children.length > 0

  if (!hasChildren) {
    // 진도바용 done/total은 categories/tree의 비율(progress)만 제공하므로 doc_count와
    // 조합해 근사치를 표시한다 (백엔드가 done/total 원본을 내려주면 교체 필요 — 최종 보고 참고).
    const total = node.doc_count
    const done = node.progress != null ? Math.round(node.progress * total) : 0
    const isComplete = total > 0 && node.progress != null && node.progress >= 1

    return (
      <div className="rounded-lg border border-border bg-surface p-3" style={{ marginLeft: `${depth * 12}px` }}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-primary">{node.name}</p>
            {total > 0 ? (
              <ProgressBar value={node.progress ?? 0} label={`${done}/${total}`} />
            ) : (
              <p className="text-xs text-muted">문서를 연결하세요</p>
            )}
          </div>
          {isComplete ? (
            <span className="shrink-0 text-lg text-correct" aria-label="완료" title="완료">
              ✓
            </span>
          ) : total > 0 ? (
            <Link
              to={done > 0 ? `/study/${node.id}` : `/study/${node.id}?from=start`}
              className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
            >
              {done > 0 ? '이어하기' : '여기서 시작'}
            </Link>
          ) : null}
        </div>
        {editMode && (
          <RowActions
            onAddChild={() => onAddChild(node)}
            onRename={() => onRename(node)}
            onMove={() => onMove(node)}
            onDelete={() => onDelete(node)}
            className="mt-2 border-t border-border pt-2"
          />
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface" style={{ marginLeft: `${depth * 12}px` }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-muted">{expanded ? '▾' : '▸'}</span>
          <span className="text-sm font-medium text-primary">{node.name}</span>
        </span>
        {node.progress != null && <span className="text-xs text-muted">{Math.round(node.progress * 100)}%</span>}
      </button>
      {editMode && (
        <RowActions
          onAddChild={() => onAddChild(node)}
          onRename={() => onRename(node)}
          onMove={() => onMove(node)}
          onDelete={() => onDelete(node)}
          className="px-3 pb-2"
        />
      )}
      {expanded && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          {node.children.map((child) => (
            <AccordionSection
              key={child.id}
              node={child}
              depth={depth + 1}
              editMode={editMode}
              onAddChild={onAddChild}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
