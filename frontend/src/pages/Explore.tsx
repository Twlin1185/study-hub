import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  useCategoryTree,
  useCreateCategory,
  useDeleteCategory,
  useMoveCategory,
  useUpdateCategory,
} from '../api/categories'
import {
  useCreateDocument,
  useDocuments,
  useLinkDocument,
} from '../api/documents'
import { useTags } from '../api/tags'
import { useSuggestions } from '../api/suggestions'
import type { DocumentType } from '../api/types'
import Tree from '../components/Tree'
import DocCard from '../components/DocCard'
import CategoryFormModal from '../components/CategoryFormModal'
import MoveCategoryModal from '../components/MoveCategoryModal'
import LinkDocumentModal from '../components/LinkDocumentModal'
import CreateDocumentModal from '../components/CreateDocumentModal'
import ConfirmDialog from '../components/ConfirmDialog'
import { ApiError } from '../api/client'
import { findCategory } from '../utils/tree'
import type { CategoryNode } from '../api/types'

type ModalState =
  | { kind: 'none' }
  | { kind: 'add-category'; parent: CategoryNode | null }
  | { kind: 'rename-category'; node: CategoryNode }
  | { kind: 'move-category'; node: CategoryNode }
  | { kind: 'delete-category'; node: CategoryNode }
  | { kind: 'link-document'; documentId: number }
  | { kind: 'create-document' }

export default function ExplorePage() {
  const treeQuery = useCategoryTree()
  const tagsQuery = useTags()
  const suggestionsQuery = useSuggestions()
  const suggestionCount = suggestionsQuery.data?.length ?? 0

  const [searchParams] = useSearchParams()

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [deep, setDeep] = useState(true)
  const [typeFilter, setTypeFilter] = useState<DocumentType | ''>('')
  const [tagFilter, setTagFilter] = useState(searchParams.get('tag') ?? '')
  const [orphanOnly, setOrphanOnly] = useState(false)
  const [bookmarkedOnly, setBookmarkedOnly] = useState(searchParams.get('bookmarked') === '1')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })
  const [modalError, setModalError] = useState<string | null>(null)
  const [pageNotice, setPageNotice] = useState<string | null>(null)

  // 문서 상세에서 태그 클릭 → 이동해온 ?tag= 쿼리를 필터에 반영
  useEffect(() => {
    const tagParam = searchParams.get('tag')
    if (tagParam && tagParam !== tagFilter) {
      setTagFilter(tagParam)
    }
  }, [searchParams, tagFilter])

  // 홈 "북마크 모아보기" 진입(?bookmarked=1) 반영
  useEffect(() => {
    if (searchParams.get('bookmarked') === '1' && !bookmarkedOnly) {
      setBookmarkedOnly(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const documentsQuery = useDocuments({
    category_id: selectedCategoryId ?? undefined,
    deep: selectedCategoryId != null ? deep : undefined,
    type: typeFilter || undefined,
    tag: tagFilter || undefined,
    orphan: orphanOnly || undefined,
    bookmarked: bookmarkedOnly || undefined,
    page: 1,
    size: 100,
  })

  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const moveCategory = useMoveCategory()
  const deleteCategory = useDeleteCategory()
  const linkDocument = useLinkDocument()
  const createDocument = useCreateDocument()

  const treeNodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data])
  const selectedNode = selectedCategoryId != null ? findCategory(treeNodes, selectedCategoryId) : null

  function closeModal() {
    setModal({ kind: 'none' })
    setModalError(null)
  }

  function errMsg(e: unknown, fallback: string) {
    return e instanceof ApiError ? e.message : fallback
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-3rem)] flex-col md:flex-row">
      {/* 데스크톱 좌측 트리 */}
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-border bg-surface p-3 md:block">
        <TreePanel
          treeQuery={treeQuery}
          treeNodes={treeNodes}
          selectedCategoryId={selectedCategoryId}
          setSelectedCategoryId={setSelectedCategoryId}
          setModal={setModal}
          linkDocument={linkDocument}
          setModalError={setModalError}
        />
      </aside>

      {/* 모바일 드로어 트리 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="fixed inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 overflow-y-auto bg-surface p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">분류</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded p-1 text-muted hover:bg-bg"
              >
                ✕
              </button>
            </div>
            <TreePanel
              treeQuery={treeQuery}
              treeNodes={treeNodes}
              selectedCategoryId={selectedCategoryId}
              setSelectedCategoryId={(id) => {
                setSelectedCategoryId(id)
                setDrawerOpen(false)
              }}
              setModal={setModal}
              linkDocument={linkDocument}
              setModalError={setModalError}
            />
          </aside>
        </div>
      )}

      {/* 우측 문서 그리드 */}
      <section className="flex-1 overflow-y-auto p-4">
        {suggestionCount > 0 && (
          <Link
            to="/suggestions"
            className="mb-3 flex items-center justify-between rounded-lg border border-accent bg-accent-soft px-3 py-2 text-sm text-accent hover:opacity-90"
          >
            <span>📮 분류 제안 {suggestionCount}건 대기 중</span>
            <span>제안함 열기 ›</span>
          </Link>
        )}

        {pageNotice && (
          <div className="mb-3 flex items-start justify-between gap-2 rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
            <span>{pageNotice}</span>
            <button
              type="button"
              onClick={() => setPageNotice(null)}
              aria-label="알림 닫기"
              className="shrink-0 text-muted hover:text-primary"
            >
              ✕
            </button>
          </div>
        )}

        <div className="mb-3 flex items-center justify-between gap-2 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-primary"
          >
            {selectedNode ? selectedNode.name : '전체 문서'} 🗂️
          </button>
          <button
            type="button"
            onClick={() => setModal({ kind: 'create-document' })}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
          >
            + 새 문서
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as DocumentType | '')}
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-primary"
          >
            <option value="">모든 타입</option>
            <option value="concept">개념</option>
            <option value="question">문제</option>
            <option value="past_question">기출</option>
            <option value="flashcard">카드</option>
          </select>

          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-primary"
          >
            <option value="">모든 태그</option>
            {(tagsQuery.data ?? []).map((t) => (
              <option key={t.id} value={t.name}>
                #{t.name} ({t.usage_count})
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1 text-sm text-primary">
            <input
              type="checkbox"
              checked={orphanOnly}
              onChange={(e) => setOrphanOnly(e.target.checked)}
            />
            단일 문서만
          </label>

          <label className="flex items-center gap-1 text-sm text-primary">
            <input
              type="checkbox"
              checked={bookmarkedOnly}
              onChange={(e) => setBookmarkedOnly(e.target.checked)}
            />
            ★ 북마크만
          </label>

          {selectedCategoryId != null && (
            <label className="flex items-center gap-1 text-sm text-primary">
              <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
              하위 포함
            </label>
          )}

          <button
            type="button"
            onClick={() => setModal({ kind: 'create-document' })}
            className="ml-auto hidden rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 md:block"
          >
            + 새 문서
          </button>
        </div>

        {documentsQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
        {documentsQuery.isError && (
          <p className="text-sm text-wrong">
            {errMsg(documentsQuery.error, '문서를 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.')}
          </p>
        )}
        {documentsQuery.data && documentsQuery.data.items.length === 0 && (
          <p className="text-sm text-muted">문서가 없습니다. "+ 새 문서"로 추가해 보세요.</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(documentsQuery.data?.items ?? []).map((doc) => (
            <DocCard
              key={doc.id}
              doc={doc}
              onRequestLink={(documentId) => setModal({ kind: 'link-document', documentId })}
            />
          ))}
        </div>
      </section>

      {/* 모달 */}
      {modal.kind === 'add-category' && (
        <CategoryFormModal
          title={modal.parent ? `"${modal.parent.name}" 하위 분류 추가` : '최상위 분류 추가'}
          submitLabel="추가"
          submitting={createCategory.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onSubmit={(values) => {
            setModalError(null)
            createCategory.mutate(
              { parent_id: modal.kind === 'add-category' ? modal.parent?.id ?? null : null, ...values },
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
          allNodes={treeNodes}
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
              onSuccess: () => {
                if (selectedCategoryId === modal.node.id) setSelectedCategoryId(null)
                closeModal()
              },
              onError: (e) =>
                setModalError(errMsg(e, '삭제할 수 없습니다. 하위 분류/연결된 문서를 먼저 정리하세요.')),
            })
          }}
        />
      )}

      {modal.kind === 'link-document' && (
        <LinkDocumentModal
          allNodes={treeNodes}
          submitting={linkDocument.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onSubmit={(categoryId, localNote) => {
            if (modal.kind !== 'link-document') return
            setModalError(null)
            linkDocument.mutate(
              { id: modal.documentId, category_id: categoryId, local_note: localNote || undefined },
              {
                onSuccess: closeModal,
                onError: (e) => setModalError(errMsg(e, '연결에 실패했습니다.')),
              },
            )
          }}
        />
      )}

      {modal.kind === 'create-document' && (
        <CreateDocumentModal
          submitting={createDocument.isPending}
          errorMessage={modalError}
          defaultCategoryName={selectedNode?.name ?? null}
          onClose={closeModal}
          onSubmit={(values) => {
            setModalError(null)
            createDocument.mutate(
              { ...values, category_id: selectedCategoryId ?? undefined },
              {
                onSuccess: (result) => {
                  if (result.linkError) {
                    setPageNotice(`문서는 생성됐으나 연결 실패: ${result.linkError}`)
                  } else {
                    setPageNotice(null)
                  }
                  closeModal()
                },
                onError: (e) => setModalError(errMsg(e, '문서 생성에 실패했습니다.')),
              },
            )
          }}
        />
      )}
    </div>
  )
}

interface TreePanelProps {
  treeQuery: ReturnType<typeof useCategoryTree>
  treeNodes: CategoryNode[]
  selectedCategoryId: number | null
  setSelectedCategoryId: (id: number | null) => void
  setModal: (modal: ModalState) => void
  linkDocument: ReturnType<typeof useLinkDocument>
  setModalError: (msg: string | null) => void
}

function TreePanel({
  treeQuery,
  treeNodes,
  selectedCategoryId,
  setSelectedCategoryId,
  setModal,
  linkDocument,
  setModalError,
}: TreePanelProps) {
  if (treeQuery.isLoading) return <p className="text-sm text-muted">불러오는 중…</p>
  if (treeQuery.isError) {
    return (
      <p className="text-sm text-wrong">
        분류를 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.
      </p>
    )
  }
  return (
    <Tree
      nodes={treeNodes}
      selectedId={selectedCategoryId}
      onSelect={setSelectedCategoryId}
      onAddChild={(parent) => setModal({ kind: 'add-category', parent })}
      onRename={(node) => setModal({ kind: 'rename-category', node })}
      onMove={(node) => setModal({ kind: 'move-category', node })}
      onDelete={(node) => setModal({ kind: 'delete-category', node })}
      onDropDocument={(categoryId, documentId) => {
        setModalError(null)
        linkDocument.mutate({ id: documentId, category_id: categoryId })
      }}
    />
  )
}
