import { lazy, Suspense, useEffect, useState } from 'react'
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
  useUpdateDocument,
} from '../api/documents'
import type { DocumentDetail, DocumentStyle, DocumentType, RelationType } from '../api/types'
import MarkdownView from '../components/MarkdownView'
import InlineRichText from '../components/markdown/InlineRichText'
import TagChip from '../components/TagChip'
import ConfirmDialog from '../components/ConfirmDialog'
import MiniHistoryChart from '../components/MiniHistoryChart'
import BookmarkButton from '../components/BookmarkButton'
import AddRelationModal from '../components/AddRelationModal'
import RegenerateJobPanel from '../components/RegenerateJobPanel'
import ExplainJobPanel from '../components/ExplainJobPanel'
import DocEditor from '../components/DocEditor'
import DocStyleFields from '../components/DocStyleFields'
import { useDocStyle } from '../hooks/useDocStyle'
import { MARKDOWN_SCALE_CLASS } from '../utils/docStyle'
import { ApiError } from '../api/client'
import { pickEmbeddedBy, pickManualRelations } from '../utils/relations'
import { choiceMarker, formatAnswer } from '../utils/answerFormat'

// 에디터 v2 문서 편집 표면(S35 — 이 단계의 새 편집기 **유일한 진입점**). BlockNote·Mantine 번들이
// 초기 청크에 섞이지 않게 **lazy 청크**로만 들어온다(R37 — 초기 청크 증가 ≤ 5KB가 DoD).
const DocBlockEditor = lazy(() => import('../editor2/documents/DocBlockEditor'))

const TYPE_LABEL: Record<DocumentType, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출문제',
  flashcard: '플래시카드',
}

const RELATION_LABEL: Record<RelationType, string> = {
  explains: '설명',
  related: '관련',
  prerequisite: '선행 개념',
}

function isConceptType(type: DocumentType): boolean {
  return type === 'concept' || type === 'flashcard'
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
  // S28(F53 ①·②, 설계 §4.26 ⑤·②-5) — 문서 지정값 > 전역 설정 > 기본 토큰. 문서 로드 전에도
  // 훅은 고정 순서로 불러야 하므로 docQuery.data가 아직 없어도 style은 undefined로 안전하다.
  const { scale: docScale, fontClassName: docFontClass, bgClassName: docBgClass } = useDocStyle(
    docQuery.data?.style,
  )

  // 편집은 공용 DocEditor 모달로(설계 §5 도입부, F37) — 문서 상세 전용 인라인 폼 제거.
  const [editing, setEditing] = useState(false)
  // stage-43 F-1(규약 D — 퇴로 토글 소멸) — **편집 진입은 항상 새 편집기 표면부터 시도한다**.
  // 메모리 변환이 미지원 사유를 보고하면 그 자리에서 공용 DocEditor 모달을 연다 — 그 모달도
  // 내부적으로 같은 판정을 거쳐 본문·해설 편집만 잠그고(규약 D) 나머지 필드는 편집 가능하다.
  const [blockEditing, setBlockEditing] = useState(false)
  const [blockFallbackReason, setBlockFallbackReason] = useState<string | null>(null)
  const [addRelationOpen, setAddRelationOpen] = useState(false)
  const [relationError, setRelationError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [srsDetailOpen, setSrsDetailOpen] = useState(false)
  const [answerRevealed, setAnswerRevealed] = useState(false)

  const doc = docQuery.data

  // 문서가 바뀔 때마다 정답·해설은 기본 가림 상태로 초기화한다.
  // **편집 상태도 함께 내린다(검토 D-1)** — 이 화면은 라우트가 같아서 `/docs/:id` 사이를 오갈 때
  // 컴포넌트가 언마운트되지 않는다. 이동한 문서가 캐시 히트면 `isLoading` 조기 반환도 없어,
  // 편집 표면이 **이전 문서의 본문을 든 채** 새 문서 id로 저장될 수 있었다.
  useEffect(() => {
    setAnswerRevealed(false)
    setBlockEditing(false)
    setBlockFallbackReason(null)
    setEditing(false)
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

  // F43(설계 §4.19 ⑦) — 임베드 인덱스는 파생 관계다. 사용자가 만든 관계 목록에 섞지 않고
  // 사용처 영역의 역참조 목록·삭제 경고로만 쓴다(신규 API 없음 — 공용 필터 utils/relations).
  const manualRelations = pickManualRelations(doc.relations)
  const embeddedBy = pickEmbeddedBy(doc.relations)

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
        {/* 새 편집기 표면이 열려 있는 동안에는 [편집]·[삭제]를 감춘다 — 편집 중 삭제로 들어가는
            경로를 막고, 종료는 표면 안의 [편집 종료](저장 후 닫기)로 단일화한다. */}
        {!blockEditing && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setBlockFallbackReason(null)
                setBlockEditing(true)
              }}
              className="min-h-[36px] rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
            >
              편집
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="min-h-[36px] rounded border border-border px-3 py-1.5 text-sm text-wrong hover:bg-bg"
            >
              삭제
            </button>
          </div>
        )}
      </div>

      {/* 오류 신고 · 재생성 (설계 §5.3, F30) — 진행 중 잡 배지 / 완료 시 기존·신규 비교 */}
      <div className="mb-3">
        <RegenerateJobPanel doc={doc} />
      </div>

      <h1 className="mb-3 text-xl font-semibold text-primary">{doc.title}</h1>

      {editing && (
        <DocEditor mode="edit" documentId={doc.id} onClose={() => setEditing(false)} />
      )}

      {/* stage-43 F-1(규약 D) — 메모리 변환이 미지원 사유를 보고해 공용 편집 폼으로 열렸을 때의
          고지(조용한 변형 0). 그 폼 안에서도 본문·해설 편집은 잠기고 나머지 항목만 편집 가능하다. */}
      {blockFallbackReason && !blockEditing && (
        <div className="mb-3 rounded border border-warning bg-surface p-3 text-xs text-primary">
          이 문서에는 새 편집기가 아직 다루지 못하는 표현이 있어 문서 편집 창에서 본문·해설 편집이
          잠겼습니다.
          <span className="mt-1 block text-muted">{blockFallbackReason}</span>
        </div>
      )}

      {blockEditing ? (
        <Suspense fallback={<p className="text-sm text-muted">편집기를 불러오는 중…</p>}>
          <DocBlockEditor
            // key = 문서 id — 다른 문서로 이동하면 편집 표면을 **새로 만든다**(검토 D-1 이중 방어 ①.
            // 위 리셋 이펙트가 먼저 닫지만, 그 이펙트가 도는 순서에 기대지 않는다).
            key={doc.id}
            doc={doc}
            onClose={() => setBlockEditing(false)}
            onUnsupported={(reason) => {
              setBlockEditing(false)
              setBlockFallbackReason(reason)
              setEditing(true)
            }}
          />
        </Suspense>
      ) : (
        <div className="flex flex-col gap-4">
          {/* S28(F53 ⑤, §4.26 ①·④) — 이 문서의 본문 렌더 영역에만 문서 스타일 적용(앱 크롬 불변).
              배경 오버라이드가 있으면 bg-surface 대신 --doc-bg-*를 쓰고 인쇄에서는 무시된다. */}
          <div className={`rounded-lg border border-border p-4 ${docBgClass || 'bg-surface'} ${docFontClass}`}>
            {hasAnswerSection && <h2 className="mb-2 text-sm font-semibold text-primary">지문</h2>}
            <MarkdownView content={doc.content} scale={docScale} docNo={doc.doc_no} />
          </div>

          {hasAnswerSection && (doc.choices ?? []).length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold text-primary">보기</h2>
              {/* S28(검토 3차 잔여-3) — 보기 목록도 "본문 렌더 영역"에 포함해 폰트·글자크기만
                  확장 적용(배경은 지문 래퍼 기준 유지 — 여기 bg-surface는 그대로 둔다). */}
              <ul className={`flex flex-col gap-1.5 text-primary ${MARKDOWN_SCALE_CLASS[docScale]} ${docFontClass}`}>
                {(doc.choices ?? []).map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 font-medium text-muted">{choiceMarker(i)}</span>
                    <InlineRichText content={c} scale={docScale} />
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
                  <div className={`text-sm text-primary ${docFontClass}`}>
                    <span className="font-semibold">해설</span>
                    <MarkdownView content={doc.explanation} scale={docScale} docNo={doc.doc_no} />
                  </div>
                  {/* AI 풀이 생성 (설계 §4.20 ②, F44) — 문제 타입 + 해설 없음 문서에만 노출 */}
                  <ExplainJobPanel doc={doc} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 문서 스타일 (S28 — F53 ②, screens §5.3) — DocEditor 편집 모드와 별개로 문서 상세에서도
          바로 지정할 수 있다. 저장은 documents PATCH style 재사용(신규 API 0).
          S35: 새 편집기 표면에도 스타일 폼을 두지 않는다 — 이 카드가 단일 출처다. */}
      <DocStyleSection doc={doc} />

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

        {/* 임베드 역참조 (설계 §4.19 ⑦) — 본문에 이 문서를 펼쳐 놓은 문서들 */}
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="mb-2 text-sm font-semibold text-primary">
            이 문서를 임베드한 문서{embeddedBy.length > 0 && ` ${embeddedBy.length}개`}
          </h3>
          {embeddedBy.length === 0 ? (
            <p className="text-sm text-muted">이 문서를 임베드한 문서가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {embeddedBy.map((rel) => (
                <li key={`embeds-${rel.document_id}`}>
                  <button
                    type="button"
                    onClick={() => navigate(`/docs/${rel.document_id}`)}
                    className="flex w-full items-center gap-2 rounded border border-border bg-bg px-3 py-2 text-left text-sm text-primary hover:underline"
                    title={rel.title}
                  >
                    <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                      임베드
                    </span>
                    <span className="shrink-0 text-xs text-muted">{rel.doc_no}</span>
                    <span className="truncate">{rel.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 관련 문서 — 문제면 "이 문제의 개념", 개념이면 "확인 문제" (설계 §5.3, F24) */}
      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-primary">
            {isConceptType(doc.type) ? '확인 문제' : '이 문제의 개념'}
            {manualRelations.length > 0 && ` (${manualRelations.length})`}
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
        {manualRelations.length === 0 ? (
          <p className="text-sm text-muted">연결된 관련 문서가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {manualRelations.map((rel) => (
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
                    {RELATION_LABEL[rel.relation as RelationType] ?? rel.relation}
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
          // 임베드 경고는 알리기만 하고 삭제를 막지 않는다(설계 §4.19 ⑦ — 자리표시자로 해결).
          message={
            `"${doc.title}" 문서를 삭제할까요? (소프트 삭제 — 학습 기록은 보존됩니다)` +
            (embeddedBy.length > 0
              ? `\n\n⚠ 이 문서는 ${embeddedBy.length}개 문서에 임베드됨 — 삭제해도 해당 문서는 유지되며, 임베드 자리에는 "삭제된 문서" 표시가 나옵니다.`
              : '')
          }
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
          // 파생 embeds 행은 제외 대상이 아니다 — 임베드한 문서와도 사용자 관계는 따로 맺을 수 있다.
          excludeIds={manualRelations.map((r) => r.document_id)}
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

// 문서별 스타일 즉시 편집(S28 — F53 ②) — 전체 DocEditor 모달을 열지 않고도 폰트·크기·배경만
// 빠르게 조정할 수 있게 문서 상세에 별도 섹션으로 둔다. 저장은 documents PATCH `style` 재사용.
function DocStyleSection({ doc }: { doc: DocumentDetail }) {
  const updateDocument = useUpdateDocument()
  const [draft, setDraft] = useState<DocumentStyle | null>(doc.style)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(doc.style)
  }, [doc.id, doc.style])

  const dirty = JSON.stringify(draft) !== JSON.stringify(doc.style)

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-primary">문서 스타일</h2>
      <p className="mb-3 text-xs text-muted">
        이 문서의 본문에만 적용됩니다 — 지정하지 않으면 전역 설정을 따르고, 임베드 카드 안·인쇄
        배경에는 적용되지 않습니다(폰트·글자 크기는 인쇄에도 유지됩니다).
      </p>
      <DocStyleFields value={draft} onChange={setDraft} />
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!dirty || updateDocument.isPending}
          onClick={() => {
            setError(null)
            updateDocument.mutate(
              { id: doc.id, style: draft },
              {
                onSuccess: () => {
                  setSaved(true)
                  window.setTimeout(() => setSaved(false), 1500)
                },
                onError: (e) => setError(errMsg(e, '저장에 실패했습니다.')),
              },
            )
          }}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {saved ? '저장됨' : '저장'}
        </button>
        {error && <p className="text-sm text-wrong">{error}</p>}
      </div>
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
