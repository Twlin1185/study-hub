import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  useCategoryTree,
  useCreateCategory,
  useDeleteCategory,
  useMoveCategory,
  useUpdateCategory,
} from '../api/categories'
import { useBulkDocuments, useDocuments, useLinkDocument } from '../api/documents'
import { useTags } from '../api/tags'
import { useSuggestions } from '../api/suggestions'
import type { DocumentBulkResult, DocumentType } from '../api/types'
import Tree from '../components/Tree'
import DocCard from '../components/DocCard'
import CategoryFormModal from '../components/CategoryFormModal'
import MoveCategoryModal from '../components/MoveCategoryModal'
import LinkDocumentModal from '../components/LinkDocumentModal'
import DocEditor from '../components/DocEditor'
import DeleteCategoryModal from '../components/DeleteCategoryModal'
import ConfirmDialog from '../components/ConfirmDialog'
import BulkSelectionBar from '../components/BulkSelectionBar'
import { ApiError } from '../api/client'
import { collectDescendantIds, findCategory } from '../utils/tree'
import type { CategoryNode } from '../api/types'

type ModalState =
  | { kind: 'none' }
  | { kind: 'add-category'; parent: CategoryNode | null }
  | { kind: 'rename-category'; node: CategoryNode }
  | { kind: 'move-category'; node: CategoryNode }
  | { kind: 'delete-category'; node: CategoryNode }
  | { kind: 'link-document'; documentId: number }
  | { kind: 'create-document' }
  // S51(FB-25) — 탐색 다중 선택 선택 툴바 4동작. ids·category_id는 현재 선택 상태에서 제출 시점에
  // 읽는다(모달 자체는 대상만 담당 — 별도 payload 불필요).
  | { kind: 'bulk-link' }
  | { kind: 'bulk-move' }
  | { kind: 'bulk-unlink' }
  | { kind: 'bulk-delete' }

// S51(FB-25) — 성공 요약 1줄(카운터 그대로). action별 주 카운터 필드가 다르다(§4.31 응답 항등식).
function summarizeBulkResult(result: DocumentBulkResult): string {
  const primary: Record<DocumentBulkResult['action'], [string, number]> = {
    link: ['연결', result.linked],
    unlink: ['해제', result.unlinked],
    move: ['이동', result.moved],
    delete: ['삭제', result.deleted],
  }
  const [label, n] = primary[result.action]
  return result.skipped > 0 ? `${label} ${n} · 건너뜀 ${result.skipped}` : `${label} ${n}`
}

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

  // S51(FB-25) — 탐색 다중 선택. anchorId = Shift 범위 기준점(마지막 비Shift 클릭).
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set())
  const [anchorId, setAnchorId] = useState<number | null>(null)
  const [bulkResultSummary, setBulkResultSummary] = useState<string | null>(null)

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
  const items = useMemo(() => documentsQuery.data?.items ?? [], [documentsQuery.data])

  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const moveCategory = useMoveCategory()
  const deleteCategory = useDeleteCategory()
  const linkDocument = useLinkDocument()
  const bulkDocuments = useBulkDocuments()

  const treeNodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data])
  const selectedNode = selectedCategoryId != null ? findCategory(treeNodes, selectedCategoryId) : null

  // S51(FB-25) — 초기화 트리거: 필터 6종(분류·하위 포함·타입·태그·단일 문서·북마크) 변경.
  // 배치 성공 후·분류 삭제 성공 후는 해당 onSuccess에서 별도로 초기화한다.
  useEffect(() => {
    setSelectedDocIds(new Set())
    setAnchorId(null)
    setBulkResultSummary(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategoryId, deep, typeFilter, tagFilter, orphanOnly, bookmarkedOnly])

  // 표시값 = 선택 ∩ 현재 목록 id(목록에서 사라진 id는 세지 않음) — 그대로 일괄 작업 대상이 된다.
  const visibleSelectedIds = useMemo(
    () => items.filter((d) => selectedDocIds.has(d.id)).map((d) => d.id),
    [items, selectedDocIds],
  )

  function toggleDocSelect(id: number, shiftKey: boolean) {
    setBulkResultSummary(null)
    setSelectedDocIds((prev) => {
      const next = new Set(prev)
      if (shiftKey && anchorId != null) {
        const ids = items.map((d) => d.id)
        const anchorIdx = ids.indexOf(anchorId)
        const clickedIdx = ids.indexOf(id)
        if (anchorIdx !== -1 && clickedIdx !== -1) {
          const [start, end] = anchorIdx <= clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx]
          for (let i = start; i <= end; i++) next.add(ids[i])
        } else {
          next.add(id)
        }
      } else if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    if (!shiftKey) setAnchorId(id)
  }

  function selectAllVisible() {
    setBulkResultSummary(null)
    setSelectedDocIds(new Set(items.map((d) => d.id)))
  }

  function clearSelection() {
    setBulkResultSummary(null)
    setSelectedDocIds(new Set())
    setAnchorId(null)
  }

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

        <BulkSelectionBar
          count={visibleSelectedIds.length}
          totalVisible={items.length}
          fromNode={selectedNode}
          deep={selectedCategoryId != null ? deep : false}
          resultSummary={bulkResultSummary}
          onSelectAllVisible={selectAllVisible}
          onClear={clearSelection}
          onLink={() => setModal({ kind: 'bulk-link' })}
          onMove={() => setModal({ kind: 'bulk-move' })}
          onUnlink={() => setModal({ kind: 'bulk-unlink' })}
          onDelete={() => setModal({ kind: 'bulk-delete' })}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((doc) => (
            <DocCard
              key={doc.id}
              doc={doc}
              selected={selectedDocIds.has(doc.id)}
              onToggleSelect={toggleDocSelect}
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
        <DeleteCategoryModal
          node={modal.node}
          allNodes={treeNodes}
          submitting={deleteCategory.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onConfirm={(opts) => {
            if (modal.kind !== 'delete-category') return
            setModalError(null)
            // 재귀 삭제 시 선택 노드가 삭제 트리(자신 + 하위 전체)에 포함되면 선택을 초기화한다.
            const deletedIds = collectDescendantIds(modal.node)
            deleteCategory.mutate(
              { id: modal.node.id, ...opts },
              {
                onSuccess: () => {
                  if (selectedCategoryId != null && deletedIds.has(selectedCategoryId)) {
                    setSelectedCategoryId(null)
                  }
                  // S51(FB-25) — 초기화 트리거: 분류 삭제 성공 후.
                  setSelectedDocIds(new Set())
                  setAnchorId(null)
                  setBulkResultSummary(null)
                  closeModal()
                },
                onError: (e) => setModalError(e.message),
              },
            )
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

      {/* S51(FB-25) — 선택 툴바 4동작. ids는 항상 표시값(선택 ∩ 현재 목록)을 보낸다. */}
      {modal.kind === 'bulk-link' && (
        <LinkDocumentModal
          allNodes={treeNodes}
          title={`${visibleSelectedIds.length}건을 분류에 연결`}
          submitLabel="연결"
          withNote={false}
          submitting={bulkDocuments.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onSubmit={(categoryId) => {
            setModalError(null)
            bulkDocuments.mutate(
              { action: 'link', document_ids: visibleSelectedIds, category_id: categoryId },
              {
                onSuccess: (result) => {
                  setBulkResultSummary(summarizeBulkResult(result))
                  setSelectedDocIds(new Set())
                  setAnchorId(null)
                  closeModal()
                },
                onError: (e) => setModalError(errMsg(e, '일괄 작업에 실패했습니다.')),
              },
            )
          }}
        />
      )}

      {modal.kind === 'bulk-move' && selectedNode && (
        <LinkDocumentModal
          allNodes={treeNodes}
          title={`${visibleSelectedIds.length}건을 '${selectedNode.name}'에서 이동`}
          submitLabel="이동"
          withNote={false}
          excludeCategoryId={selectedNode.id}
          submitting={bulkDocuments.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onSubmit={(toCategoryId) => {
            setModalError(null)
            bulkDocuments.mutate(
              {
                action: 'move',
                document_ids: visibleSelectedIds,
                category_id: selectedNode.id,
                to_category_id: toCategoryId,
                deep,
              },
              {
                onSuccess: (result) => {
                  setBulkResultSummary(summarizeBulkResult(result))
                  setSelectedDocIds(new Set())
                  setAnchorId(null)
                  closeModal()
                },
                onError: (e) => setModalError(errMsg(e, '일괄 작업에 실패했습니다.')),
              },
            )
          }}
        />
      )}

      {modal.kind === 'bulk-unlink' && selectedNode && (
        <ConfirmDialog
          title="연결 해제"
          message={`${visibleSelectedIds.length}건의 '${selectedNode.name}' 연결${
            deep ? '(하위 포함)' : ''
          }을 해제할까요? 문서는 남습니다`}
          confirmLabel="해제"
          submitting={bulkDocuments.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onConfirm={() => {
            setModalError(null)
            bulkDocuments.mutate(
              { action: 'unlink', document_ids: visibleSelectedIds, category_id: selectedNode.id, deep },
              {
                onSuccess: (result) => {
                  setBulkResultSummary(summarizeBulkResult(result))
                  setSelectedDocIds(new Set())
                  setAnchorId(null)
                  closeModal()
                },
                onError: (e) => setModalError(errMsg(e, '일괄 작업에 실패했습니다.')),
              },
            )
          }}
        />
      )}

      {modal.kind === 'bulk-delete' && (
        <ConfirmDialog
          title="문서 삭제"
          message={`${visibleSelectedIds.length}건을 삭제할까요? 문서는 휴지통 없이 숨겨지며 분류 연결·학습 기록은 그대로 남습니다`}
          confirmLabel="삭제"
          danger
          submitting={bulkDocuments.isPending}
          errorMessage={modalError}
          onClose={closeModal}
          onConfirm={() => {
            setModalError(null)
            bulkDocuments.mutate(
              { action: 'delete', document_ids: visibleSelectedIds },
              {
                onSuccess: (result) => {
                  setBulkResultSummary(summarizeBulkResult(result))
                  setSelectedDocIds(new Set())
                  setAnchorId(null)
                  closeModal()
                },
                onError: (e) => setModalError(errMsg(e, '일괄 작업에 실패했습니다.')),
              },
            )
          }}
        />
      )}

      {/* 문서 생성 — 공용 DocEditor(stage-26 9-5) — 탐색 화면 전용 폼을 두지 않는다(전 사용처 수렴). */}
      {modal.kind === 'create-document' && (
        <DocEditor
          mode="create"
          categoryId={selectedCategoryId}
          categoryName={selectedNode?.name ?? null}
          onClose={closeModal}
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
