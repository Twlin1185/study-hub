import { useEffect, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  useDeleteDocument,
  useDocument,
  useLinkDocument,
  useSetDocumentTags,
  useUnlinkDocument,
  useUpdateDocument,
} from '../api/documents'
import type { DocumentType } from '../api/types'
import MarkdownView from '../components/MarkdownView'
import TagChip from '../components/TagChip'
import ConfirmDialog from '../components/ConfirmDialog'
import MiniHistoryChart from '../components/MiniHistoryChart'
import { ApiError } from '../api/client'

const TYPE_LABEL: Record<DocumentType, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출문제',
  flashcard: '플래시카드',
}

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

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

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const documentId = id ? Number(id) : null
  const navigate = useNavigate()

  const docQuery = useDocument(documentId)
  const updateDocument = useUpdateDocument()
  const deleteDocument = useDeleteDocument()
  const setTags = useSetDocumentTags()
  const linkDocument = useLinkDocument()
  const unlinkDocument = useUnlinkDocument()

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    title: '',
    content: '',
    choices: '',
    answer: '',
    explanation: '',
    difficulty: '',
  })
  const [tagInput, setTagInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [answerRevealed, setAnswerRevealed] = useState(false)

  const doc = docQuery.data

  useEffect(() => {
    if (!doc) return
    setForm({
      title: doc.title,
      content: doc.content ?? '',
      choices: (doc.choices ?? []).join('\n'),
      answer: doc.answer ?? '',
      explanation: doc.explanation ?? '',
      difficulty: doc.difficulty != null ? String(doc.difficulty) : '',
    })
  }, [doc])

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

  function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!documentId) return
    setSaveError(null)
    updateDocument.mutate(
      {
        id: documentId,
        title: form.title.trim(),
        content: form.content,
        choices: isQuestionLike
          ? form.choices
              .split('\n')
              .map((c) => c.trim())
              .filter(Boolean)
          : undefined,
        answer: form.answer,
        explanation: form.explanation,
        difficulty: form.difficulty ? Number(form.difficulty) : null,
      },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => setSaveError(errMsg(err, '저장에 실패했습니다.')),
      },
    )
  }

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
        </div>
        <div className="flex gap-2">
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
            >
              편집
            </button>
          )}
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setSaveError(null)
              }}
              className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
            >
              취소
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded border border-border px-3 py-1.5 text-sm text-wrong hover:bg-bg"
          >
            삭제
          </button>
        </div>
      </div>

      {!editing && <h1 className="mb-3 text-xl font-semibold text-primary">{doc.title}</h1>}

      {editing ? (
        <form onSubmit={handleSave} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <label className="flex flex-col gap-1 text-sm">
            제목
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            본문 (Markdown)
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={8}
              className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
          </label>
          {isQuestionLike && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                보기 (줄바꿈으로 구분)
                <textarea
                  value={form.choices}
                  onChange={(e) => setForm((f) => ({ ...f, choices: e.target.value }))}
                  rows={4}
                  className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                정답
                <input
                  value={form.answer}
                  onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
                  className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                해설 (Markdown)
                <textarea
                  value={form.explanation}
                  onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
                  rows={4}
                  className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                />
              </label>
            </>
          )}
          <label className="flex flex-col gap-1 text-sm">
            난이도 (1~5)
            <input
              type="number"
              min={1}
              max={5}
              value={form.difficulty}
              onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}
              className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
          </label>

          {saveError && <p className="text-sm text-wrong">{saveError}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={updateDocument.isPending}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            {hasAnswerSection && <h2 className="mb-2 text-sm font-semibold text-primary">지문</h2>}
            <MarkdownView content={doc.content} />
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
                    <MarkdownView content={doc.explanation} />
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
