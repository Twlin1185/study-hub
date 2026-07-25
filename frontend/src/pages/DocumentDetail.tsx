import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  useAddRelation,
  useDeleteDocument,
  useDeleteRelation,
  useDocument,
  useLinkDocument,
  useSetDocumentTags,
  useUnlinkDocument,
} from '../api/documents'
import type { DocumentType, RelationType } from '../api/types'
import MarkdownView from '../components/MarkdownView'
import TagChip from '../components/TagChip'
import ConfirmDialog from '../components/ConfirmDialog'
import MiniHistoryChart from '../components/MiniHistoryChart'
import BookmarkButton from '../components/BookmarkButton'
import AddRelationModal from '../components/AddRelationModal'
import RegenerateJobPanel from '../components/RegenerateJobPanel'
import DocEditor from '../components/DocEditor'
import { useFontScale } from '../hooks/useFontScale'
import { ApiError } from '../api/client'

const TYPE_LABEL: Record<DocumentType, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출문제',
  flashcard: '플래시카드',
}

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

const RELATION_LABEL: Record<RelationType, string> = {
  explains: '설명',
  related: '관련',
  prerequisite: '선행 개념',
}

function isConceptType(type: DocumentType): boolean {
  return type === 'concept' || type === 'flashcard'
}

function choiceMarker(index: number): string {
  return CIRCLED_DIGITS[index] ?? `${index + 1}.`
}

// answer가 "1"~"9"이면 보기 번호(①②③…)로 매핑, 그 외에는 원문 그대로 노출한다.
function formatAnswer(answer: string | null): string {
  if (!answer || !answer.trim()) return '-'
  const trimmed = answer.trim()
  if (/^[1-9]$/.test(trimmed)) {
    return `${choiceMarker(Number(trimmed) - 1)} (${trimmed})`
  }
  return trimmed
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 다음 복습일 표시 — 오늘 기준 D-day를 함께 붙인다 (예: "2026-07-25 (D-2)").
function formatDueDate(due: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(`${due}T00:00:00`)
  if (Number.isNaN(dueDate.getTime())) return due
  const diff = Math.round((dueDate.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return `${due} (오늘)`
  return diff > 0 ? `${due} (D-${diff})` : `${due} (D+${-diff})`
}

// SRS 사람 말 표기 (설계 §5.3, F36-⑩) — "3일 후 복습 예정"·"오늘 복습 대상" 형태.
function srsHumanText(due: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(`${due}T00:00:00`)
  if (Number.isNaN(dueDate.getTime())) return '복습 예정'
  const diff = Math.round((dueDate.getTime() - today.getTime()) / 86400000)
  if (diff <= 0) return '오늘 복습 대상'
  if (diff === 1) return '내일 복습 예정'
  return `${diff}일 후 복습 예정`
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const documentId = id ? Number(id) : null
  const navigate = useNavigate()

  const docQuery = useDocument(documentId)
  const deleteDocument = useDeleteDocument()
  const setTags = useSetDocumentTags()
  const linkDocument = useLinkDocument()
  const unlinkDocument = useUnlinkDocument()
  const addRelation = useAddRelation()
  const deleteRelation = useDeleteRelation()
  const fontScale = useFontScale()

  // 편집은 공용 DocEditor 모달로(설계 §5 도입부, F37) — 문서 상세 전용 인라인 폼 제거.
  const [editing, setEditing] = useState(false)
  const [addRelationOpen, setAddRelationOpen] = useState(false)
  const [relationError, setRelationError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [srsDetailOpen, setSrsDetailOpen] = useState(false)
  const [answerRevealed, setAnswerRevealed] = useState(false)

  const doc = docQuery.data

  // 문서가 바뀔 때마다 정답·해설은 기본 가림 상태로 초기화한다.
  useEffect(() => {
    setAnswerRevealed(false)
  }, [documentId])

  if (!documentId) return <p className="p-4 text-sm text-wrong">잘못된 문서 ID입니다.</p>

  if (docQuery.isLoading) return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  if (docQuery.isError || !doc) {
    return (
      <p className="p-4 text-sm text-wrong">
        {errMsg(docQuery.error, '문서를 찾을 수 없습니다.')}
      </p>
    )
  }

  const isQuestionLike = doc.type === 'question' || doc.type === 'past_question'
  // 열람 모드에서 정답·해설 스포일러를 적용할 타입(개념 제외)
  const hasAnswerSection = isQuestionLike || doc.type === 'flashcard'

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' && e.key !== ',') return
    e.preventDefault()
    const value = tagInput.trim().replace(/^#/, '')
    if (!value || !doc) return
    if (doc.tags.includes(value)) {
      setTagInput('')
      return
    }
    setTags.mutate({ id: doc.id, tags: [...doc.tags, value] })
    setTagInput('')
  }

  function removeTag(tag: string) {
    if (!doc) return
    setTags.mutate({ id: doc.id, tags: doc.tags.filter((t) => t !== tag) })
  }

  function updateLocalNote(categoryId: number, note: string) {
    if (!doc) return
    linkDocument.mutate({ id: doc.id, category_id: categoryId, local_note: note })
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-3 text-sm text-muted hover:text-primary"
      >
        ← 뒤로
      </button>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {TYPE_LABEL[doc.type]}
          </span>
          <span className="text-xs text-muted">{doc.doc_no}</span>
          <BookmarkButton documentId={doc.id} bookmarked={doc.bookmarked} />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            편집
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded border border-border px-3 py-1.5 text-sm text-wrong hover:bg-bg"
          >
            삭제
          </button>
        </div>
      </div>

      {/* 오류 신고 · 재생성 (설계 §5.3, F30) — 진행 중 잡 배지 / 완료 시 기존·신규 비교 */}
      <div className="mb-3">
        <RegenerateJobPanel doc={doc} />
      </div>

      <h1 className="mb-3 text-xl font-semibold text-primary">{doc.title}</h1>

      {editing && (
        <DocEditor mode="edit" documentId={doc.id} onClose={() => setEditing(false)} />
      )}

      {(
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            {hasAnswerSection && <h2 className="mb-2 text-sm font-semibold text-primary">지문</h2>}
            <MarkdownView content={doc.content} scale={fontScale} />
          </div>

          {hasAnswerSection && (doc.choices ?? []).length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold text-primary">보기</h2>
              <ul className="flex flex-col gap-1.5 text-sm text-primary">
                {(doc.choices ?? []).map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 font-medium text-muted">{choiceMarker(i)}</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasAnswerSection && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <button
                type="button"
                onClick={() => setAnswerRevealed((v) => !v)}
                aria-expanded={answerRevealed}
                className="rounded border border-border px-3 py-1.5 text-sm font-medium text-primary hover:bg-bg"
              >
                {answerRevealed ? '정답·해설 숨기기' : '정답·해설 보기'}
              </button>

              {answerRevealed && (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  <p className="text-sm text-primary">
                    <span className="font-semibold">정답: </span>
                    {formatAnswer(doc.answer)}
                  </p>
                  <div className="text-sm text-primary">
                    <span className="font-semibold">해설</span>
                    <MarkdownView content={doc.explanation} scale={fontScale} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 태그 */}
      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-primary">태그</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {doc.tags.map((tag) => (
            <TagChip
              key={tag}
              label={tag}
              onClick={() => navigate(`/explore?tag=${encodeURIComponent(tag)}`)}
              onRemove={() => removeTag(tag)}
            />
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder="태그 입력 후 Enter"
            className="w-32 rounded border border-border bg-bg px-2 py-1 text-xs text-primary outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* 사용처 */}
      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-primary">
          사용처{doc.usages.length > 0 && ` (${doc.usages.length}곳에서 사용 중)`}
        </h2>
        {doc.usages.length === 0 ? (
          <p className="text-sm text-muted">연결된 분류가 없습니다 (단일 문서).</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {doc.usages.map((usage) => (
              <UsageRow
                key={usage.category_id}
                path={usage.path}
                localNote={usage.local_note}
                onSaveNote={(note) => updateLocalNote(usage.category_id, note)}
                onUnlink={() => unlinkDocument.mutate({ id: doc.id, categoryId: usage.category_id })}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 관련 문서 — 문제면 "이 문제의 개념", 개념이면 "확인 문제" (설계 §5.3, F24) */}
      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-primary">
            {isConceptType(doc.type) ? '확인 문제' : '이 문제의 개념'}
            {doc.relations.length > 0 && ` (${doc.relations.length})`}
          </h2>
          <button
            type="button"
            onClick={() => {
              setRelationError(null)
              setAddRelationOpen(true)
            }}
            className="rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-bg"
          >
            + 연결 추가
          </button>
        </div>
        {doc.relations.length === 0 ? (
          <p className="text-sm text-muted">연결된 관련 문서가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {doc.relations.map((rel) => (
              <li
                key={`${rel.document_id}-${rel.relation}-${rel.direction}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-bg px-3 py-2 text-sm"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/docs/${rel.document_id}`)}
                  className="min-w-0 flex-1 truncate text-left text-primary hover:underline"
                  title={rel.title}
                >
                  <span className="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                    {RELATION_LABEL[rel.relation]}
                  </span>
                  <span className="mr-1 text-xs text-muted">{rel.doc_no}</span>
                  {rel.title}
                </button>
                {/* 관계 해제는 이 문서가 선언한 관계(direction:'from')만 가능 — 백엔드 remove_relation
                    이 from_document_id==현재 문서인 행만 대상으로 한다. 상대가 선언한 관계는
                    해당 문서 상세에서 해제해야 한다. */}
                {rel.direction === 'from' ? (
                  <button
                    type="button"
                    onClick={() => deleteRelation.mutate({ id: doc.id, toDocumentId: rel.document_id })}
                    className="shrink-0 rounded border border-border px-2 py-1 text-xs text-wrong hover:bg-surface"
                  >
                    연결 해제
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted" title="상대 문서에서 선언한 관계">
                    상대측 연결
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 풀이 이력 미니차트 (설계 §5.3, S3) */}
      {isQuestionLike && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">
            풀이 이력
            {doc.stats.attempts > 0 &&
              ` (${doc.stats.attempts}회, 정답률 ${doc.stats.accuracy != null ? Math.round(doc.stats.accuracy * 100) : '-'}%)`}
          </h2>
          <MiniHistoryChart recent={doc.stats.recent} />
        </div>
      )}

      {/* SRS 복습 상태 — 사람 말 표기(설계 §5.3, F36-⑩). 수치는 "자세히"로 접힘 */}
      {doc.stats.srs && doc.stats.srs.due_date && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-semibold text-primary">{srsHumanText(doc.stats.srs.due_date)}</p>
            <button
              type="button"
              onClick={() => setSrsDetailOpen((v) => !v)}
              aria-expanded={srsDetailOpen}
              className="text-xs text-muted hover:text-primary"
            >
              {srsDetailOpen ? '접기' : '자세히'}
            </button>
          </div>
          {srsDetailOpen && (
            <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 text-center">
              <div>
                <dd className="text-sm font-semibold text-primary">{formatDueDate(doc.stats.srs.due_date)}</dd>
                <dt className="text-xs text-muted">다음 복습일</dt>
              </div>
              <div>
                <dd className="text-sm font-semibold text-primary">
                  {doc.stats.srs.ease_factor != null ? doc.stats.srs.ease_factor.toFixed(2) : '-'}
                </dd>
                <dt className="text-xs text-muted">난이도 계수 (EF)</dt>
              </div>
              <div>
                <dd className="text-sm font-semibold text-primary">
                  {doc.stats.srs.interval_days != null ? `${doc.stats.srs.interval_days}일` : '-'}
                </dd>
                <dt className="text-xs text-muted">복습 간격</dt>
              </div>
            </dl>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="문서 삭제"
          message={`"${doc.title}" 문서를 삭제할까요? (소프트 삭제 — 학습 기록은 보존됩니다)`}
          confirmLabel="삭제"
          danger
          submitting={deleteDocument.isPending}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() =>
            deleteDocument.mutate(doc.id, {
              onSuccess: () => navigate('/explore'),
            })
          }
        />
      )}

      {addRelationOpen && (
        <AddRelationModal
          documentId={doc.id}
          excludeIds={doc.relations.map((r) => r.document_id)}
          submitting={addRelation.isPending}
          errorMessage={relationError}
          onClose={() => setAddRelationOpen(false)}
          onSubmit={(toDocumentId, relation) => {
            setRelationError(null)
            addRelation.mutate(
              { id: doc.id, toDocumentId, relation },
              {
                onSuccess: () => setAddRelationOpen(false),
                onError: (e) => setRelationError(errMsg(e, '연결에 실패했습니다.')),
              },
            )
          }}
        />
      )}
    </div>
  )
}

function UsageRow({
  path,
  localNote,
  onSaveNote,
  onUnlink,
}: {
  path: string
  localNote: string | null
  onSaveNote: (note: string) => void
  onUnlink: () => void
}) {
  const [note, setNote] = useState(localNote ?? '')
  const [editing, setEditing] = useState(false)

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-bg px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate text-primary">{path}</p>
        {editing ? (
          <div className="mt-1 flex gap-1">
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => {
                onSaveNote(note)
                setEditing(false)
              }}
              className="rounded bg-accent px-2 py-1 text-xs text-on-accent"
            >
              저장
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-0.5 text-left text-xs text-muted hover:text-primary"
          >
            {localNote || '메모 추가…'}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onUnlink}
        className="shrink-0 rounded border border-border px-2 py-1 text-xs text-wrong hover:bg-surface"
      >
        연결 해제
      </button>
    </li>
  )
}
