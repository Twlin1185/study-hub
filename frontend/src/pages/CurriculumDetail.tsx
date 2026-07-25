import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useCategoryTree,
  useCategoryTreePipeline,
  useCreateCategory,
  useDeleteCategory,
  useMoveCategory,
  useUpdateCategory,
} from '../api/categories'
import { useCategoryStats } from '../api/stats'
import { useDocuments } from '../api/documents'
import { useCreateQuizSession } from '../api/quiz'
import { useQuizSessionStore } from '../stores/quizSession'
import type { CategoryNode, CategoryStageProgress, DocumentType, StageCount } from '../api/types'
import { findCategory } from '../utils/tree'
import { ApiError } from '../api/client'
import Stepper from '../components/Stepper'
import type { StepperStep } from '../components/Stepper'
import CategoryFormModal from '../components/CategoryFormModal'
import MoveCategoryModal from '../components/MoveCategoryModal'
import ConfirmDialog from '../components/ConfirmDialog'
import CategoryAccuracyBar from '../components/CategoryAccuracyBar'
import DocEditor from '../components/DocEditor'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'add-category'; parent: CategoryNode }
  | { kind: 'rename-category'; node: CategoryNode }
  | { kind: 'move-category'; node: CategoryNode }
  | { kind: 'delete-category'; node: CategoryNode }

// DocEditor 모달(문서 작성/편집) — 문서 상세로 이동하지 않고 그 자리에서 처리 (설계 §5.4, F37).
type DocModalState =
  | { kind: 'none' }
  | { kind: 'create'; categoryId: number; categoryName: string; type: DocumentType }
  | { kind: 'edit'; documentId: number }

// F37 3단 진도의 다음 단계 파생(첫 미완료 단계) — 설계 §4.12.
type NextStage = 'concept' | 'question' | 'past_question' | 'done'

function isStageDone(c: StageCount): boolean {
  return c.total === 0 || c.done >= c.total
}

function deriveNextStage(sp: CategoryStageProgress): NextStage {
  if (!isStageDone(sp.concept)) return 'concept'
  if (!isStageDone(sp.question)) return 'question'
  if (!isStageDone(sp.past_question)) return 'past_question'
  return 'done'
}

function stageStatus(c: StageCount, next: NextStage, self: NextStage): StepperStep['status'] {
  if (c.total === 0 || c.done >= c.total) return 'done'
  if (next === self) return 'current'
  return 'future'
}

const DOC_TABS: { type: DocumentType; label: string }[] = [
  { type: 'concept', label: '학습내용' },
  { type: 'question', label: '문제' },
  { type: 'past_question', label: '기출' },
]

// 설계 §5.4 — 과목/챕터 아코디언(임의 깊이). S9(F37): 각 노드에 3단 진도(Stepper)·타입별 개수 칩·
// [학습]·[문제]·[기출] 직접 진입 + 펼침 시 타입별 문서 탭(+문서 추가·행 편집, DocEditor).
export default function CurriculumDetailPage() {
  const { id } = useParams<{ id: string }>()
  const categoryId = id ? Number(id) : null
  const navigate = useNavigate()
  const treeQuery = useCategoryTree()
  // 파이프라인 집계는 선택 오버레이 — 실패/로딩이어도 커리큘럼 기본 동작은 유지(graceful).
  const pipelineQuery = useCategoryTreePipeline()
  const statsQuery = useCategoryStats(categoryId)

  const nodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data])
  const node = categoryId != null ? findCategory(nodes, categoryId) : null

  // categoryId → stage_progress 맵(파이프라인 트리에서).
  const stageMap = useMemo(() => {
    const map = new Map<number, CategoryStageProgress>()
    function walk(list: CategoryNode[]) {
      for (const n of list) {
        if (n.stage_progress) map.set(n.id, n.stage_progress)
        walk(n.children)
      }
    }
    walk(pipelineQuery.data ?? [])
    return map
  }, [pipelineQuery.data])

  const [editMode, setEditMode] = useState(false)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })
  const [docModal, setDocModal] = useState<DocModalState>({ kind: 'none' })
  const [modalError, setModalError] = useState<string | null>(null)
  const [quizError, setQuizError] = useState<string | null>(null)

  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const moveCategory = useMoveCategory()
  const deleteCategory = useDeleteCategory()
  const createSession = useCreateQuizSession()
  const startQuiz = useQuizSessionStore((s) => s.start)

  function closeModal() {
    setModal({ kind: 'none' })
    setModalError(null)
  }

  // [문제]/[기출] 직접 진입 — quiz/session{types} (하위 포함) 생성 후 런 화면으로 (설계 §5.4).
  function startTypedQuiz(catId: number, types: DocumentType[]) {
    setQuizError(null)
    createSession.mutate(
      { category_id: catId, mode: 'sequential', count: 200, types },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) {
            setQuizError('출제할 문제가 없습니다.')
            return
          }
          startQuiz(data.items, 'sequential', catId)
          navigate('/quiz/run')
        },
        onError: (e) => setQuizError(errMsg(e, '퀴즈를 시작하지 못했습니다.')),
      },
    )
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

      {quizError && <p className="mb-3 text-sm text-wrong">{quizError}</p>}

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
        <AccordionSection
          node={node}
          depth={0}
          editMode={editMode}
          stageMap={stageMap}
          onStudy={(n) => navigate(`/study/${n.id}`)}
          onQuiz={(catId, types) => startTypedQuiz(catId, types)}
          onAddDoc={(n, type) => setDocModal({ kind: 'create', categoryId: n.id, categoryName: n.name, type })}
          onEditDoc={(documentId) => setDocModal({ kind: 'edit', documentId })}
          onAddChild={(n) => setModal({ kind: 'add-category', parent: n })}
          onRename={(n) => setModal({ kind: 'rename-category', node: n })}
          onMove={(n) => setModal({ kind: 'move-category', node: n })}
          onDelete={(n) => setModal({ kind: 'delete-category', node: n })}
          forceOpen
        />
      ) : (
        <div className="flex flex-col gap-2">
          {node.children.map((child) => (
            <AccordionSection
              key={child.id}
              node={child}
              depth={0}
              editMode={editMode}
              stageMap={stageMap}
              onStudy={(n) => navigate(`/study/${n.id}`)}
              onQuiz={(catId, types) => startTypedQuiz(catId, types)}
              onAddDoc={(n, type) => setDocModal({ kind: 'create', categoryId: n.id, categoryName: n.name, type })}
              onEditDoc={(documentId) => setDocModal({ kind: 'edit', documentId })}
              onAddChild={(n) => setModal({ kind: 'add-category', parent: n })}
              onRename={(n) => setModal({ kind: 'rename-category', node: n })}
              onMove={(n) => setModal({ kind: 'move-category', node: n })}
              onDelete={(n) => setModal({ kind: 'delete-category', node: n })}
            />
          ))}
        </div>
      )}

      {docModal.kind === 'create' && (
        <DocEditor
          mode="create"
          defaultType={docModal.type}
          categoryId={docModal.categoryId}
          categoryName={docModal.categoryName}
          onClose={() => setDocModal({ kind: 'none' })}
        />
      )}
      {docModal.kind === 'edit' && (
        <DocEditor mode="edit" documentId={docModal.documentId} onClose={() => setDocModal({ kind: 'none' })} />
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
  stageMap: Map<number, CategoryStageProgress>
  onStudy: (node: CategoryNode) => void
  onQuiz: (categoryId: number, types: DocumentType[]) => void
  onAddDoc: (node: CategoryNode, type: DocumentType) => void
  onEditDoc: (documentId: number) => void
  onAddChild: (node: CategoryNode) => void
  onRename: (node: CategoryNode) => void
  onMove: (node: CategoryNode) => void
  onDelete: (node: CategoryNode) => void
  forceOpen?: boolean
}

function AccordionSection(props: AccordionSectionProps) {
  const { node, depth, editMode, stageMap, forceOpen } = props
  const [expanded, setExpanded] = useState(forceOpen ?? depth < 1)
  const hasChildren = node.children.length > 0
  const sp = stageMap.get(node.id) ?? null

  return (
    <div className="rounded-lg border border-border bg-surface" style={{ marginLeft: `${depth * 12}px` }}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="shrink-0 text-muted">{expanded ? '▾' : '▸'}</span>
          <span className="truncate text-sm font-medium text-primary">{node.name}</span>
        </button>
        {node.progress != null && (
          <span className="shrink-0 text-xs text-muted" title="개념 진도(study_progress)">
            {Math.round(node.progress * 100)}%
          </span>
        )}
      </div>

      {/* 3단 진도 · 개수 칩 · 단계 직접 진입 (설계 §5.4, F37) */}
      <NodeStageRow node={node} sp={sp} onStudy={props.onStudy} onQuiz={props.onQuiz} />

      {editMode && (
        <RowActions
          onAddChild={() => props.onAddChild(node)}
          onRename={() => props.onRename(node)}
          onMove={() => props.onMove(node)}
          onDelete={() => props.onDelete(node)}
          className="px-3 pb-2"
        />
      )}

      {expanded && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          {/* 타입별 문서 탭 (학습내용/문제/기출) + 추가·편집 */}
          <NodeDocPanel node={node} onAddDoc={props.onAddDoc} onEditDoc={props.onEditDoc} />

          {hasChildren &&
            node.children.map((child) => (
              <AccordionSection key={child.id} {...props} node={child} depth={depth + 1} forceOpen={false} />
            ))}
        </div>
      )}
    </div>
  )
}

// 노드 3단 진도(Stepper) + 타입별 개수 칩 + [학습]·[문제]·[기출] (하위 포함).
function NodeStageRow({
  node,
  sp,
  onStudy,
  onQuiz,
}: {
  node: CategoryNode
  sp: CategoryStageProgress | null
  onStudy: (node: CategoryNode) => void
  onQuiz: (categoryId: number, types: DocumentType[]) => void
}) {
  const next = sp ? deriveNextStage(sp) : 'concept'
  const steps: StepperStep[] = sp
    ? [
        { key: 'concept', label: '개념', status: stageStatus(sp.concept, next, 'concept') },
        { key: 'question', label: '문제', status: stageStatus(sp.question, next, 'question') },
        { key: 'past_question', label: '기출', status: stageStatus(sp.past_question, next, 'past_question') },
      ]
    : []

  const conceptCount = sp?.concept.total ?? 0
  const questionCount = sp?.question.total ?? 0
  const pastCount = sp?.past_question.total ?? 0
  const studyEnabled = conceptCount + questionCount > 0

  return (
    <div className="flex flex-col gap-2 px-3 pb-2">
      {sp ? (
        <Stepper steps={steps} size="sm" className="max-w-xs" />
      ) : (
        <p className="text-[11px] text-muted">3단 진도 집계 불러오는 중…</p>
      )}

      {sp && (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent" title="하위 포함">
            개념 {sp.concept.done}/{sp.concept.total}
          </span>
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent" title="하위 포함">
            문제 {sp.question.done}/{sp.question.total}
          </span>
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent" title="하위 포함">
            기출 {sp.past_question.done}/{sp.past_question.total}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!studyEnabled}
          onClick={() => onStudy(node)}
          className={`rounded px-3 py-1.5 text-xs font-medium ${
            next === 'concept'
              ? 'bg-accent text-on-accent hover:opacity-90'
              : 'border border-border bg-surface text-primary hover:bg-bg'
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          학습
        </button>
        <button
          type="button"
          disabled={questionCount === 0}
          onClick={() => onQuiz(node.id, ['question'])}
          className={`rounded px-3 py-1.5 text-xs font-medium ${
            next === 'question'
              ? 'bg-accent text-on-accent hover:opacity-90'
              : 'border border-border bg-surface text-primary hover:bg-bg'
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          문제
        </button>
        <button
          type="button"
          disabled={pastCount === 0}
          onClick={() => onQuiz(node.id, ['past_question'])}
          className={`rounded px-3 py-1.5 text-xs font-medium ${
            next === 'past_question'
              ? 'bg-accent text-on-accent hover:opacity-90'
              : 'border border-border bg-surface text-primary hover:bg-bg'
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          기출
        </button>
      </div>
    </div>
  )
}

// 펼침 시 타입별 문서 탭(이 분류에 직접 연결된 문서) + [+문서 추가] + 행 [편집].
function NodeDocPanel({
  node,
  onAddDoc,
  onEditDoc,
}: {
  node: CategoryNode
  onAddDoc: (node: CategoryNode, type: DocumentType) => void
  onEditDoc: (documentId: number) => void
}) {
  const [tab, setTab] = useState<DocumentType>('concept')
  // 이 노드에 직접 연결된 문서만(집계 칩은 하위 포함, 문서 목록은 직접 — 혼동 방지).
  const docsQuery = useDocuments({ category_id: node.id, type: tab, size: 200 })
  const items = docsQuery.data?.items ?? []

  return (
    <div className="rounded border border-border bg-bg p-2">
      <div className="mb-2 flex gap-1">
        {DOC_TABS.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => setTab(t.type)}
            aria-pressed={tab === t.type}
            className={`rounded px-2.5 py-1 text-xs font-medium ${
              tab === t.type ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {docsQuery.isLoading ? (
        <p className="px-1 py-2 text-xs text-muted">불러오는 중…</p>
      ) : docsQuery.isError ? (
        <p className="px-1 py-2 text-xs text-wrong">문서를 불러오지 못했습니다.</p>
      ) : items.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted">이 분류에 연결된 문서가 없습니다.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((doc) => (
            <li key={doc.id} className="flex items-center gap-2 py-1.5 text-sm">
              <Link
                to={`/docs/${doc.id}`}
                className="min-w-0 flex-1 truncate text-primary hover:underline"
                title={doc.title}
              >
                {doc.title}
              </Link>
              <button
                type="button"
                onClick={() => onEditDoc(doc.id)}
                className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-primary hover:bg-surface"
              >
                편집
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => onAddDoc(node, tab)}
        className="mt-2 w-full rounded border border-dashed border-border px-2 py-1.5 text-xs font-medium text-accent hover:bg-surface"
      >
        + 문서 추가
      </button>
    </div>
  )
}
