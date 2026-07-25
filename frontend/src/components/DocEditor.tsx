import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Modal from './Modal'
import { useCreateDocument, useDocument, useUpdateDocument } from '../api/documents'
import { ApiError } from '../api/client'
import type { DocumentDetail, DocumentType } from '../api/types'

// 문서 3대 공용 모듈 중 DocEditor (설계 §5 도입부·§5.4, F37) — 작성/수정 폼을 모달로 분리.
// 문서 상세를 거치지 않고 커리큘럼·탐색·검색 결과 어디서든 "그 자리에서 수정/작성"이 가능하게 한다.
const TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'concept', label: '개념' },
  { value: 'question', label: '문제' },
  { value: 'past_question', label: '기출문제' },
  { value: 'flashcard', label: '플래시카드' },
]

function isQuestionLike(type: DocumentType): boolean {
  return type === 'question' || type === 'past_question'
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

interface DocEditorProps {
  mode: 'create' | 'edit'
  // edit 모드: 수정할 문서 id (상세를 조회해 폼을 채운다)
  documentId?: number
  // create 모드: 새 문서 기본 타입(커리큘럼 탭 타입) · 자동 연결할 분류
  defaultType?: DocumentType
  categoryId?: number | null
  categoryName?: string | null
  onClose: () => void
  onSaved?: (doc: DocumentDetail) => void
}

interface FormState {
  type: DocumentType
  title: string
  content: string
  choices: string
  answer: string
  explanation: string
  difficulty: string
}

function emptyForm(defaultType: DocumentType): FormState {
  return { type: defaultType, title: '', content: '', choices: '', answer: '', explanation: '', difficulty: '' }
}

export default function DocEditor({
  mode,
  documentId,
  defaultType = 'concept',
  categoryId,
  categoryName,
  onClose,
  onSaved,
}: DocEditorProps) {
  const editing = mode === 'edit'
  const docQuery = useDocument(editing ? (documentId ?? null) : null)
  const createDocument = useCreateDocument()
  const updateDocument = useUpdateDocument()

  const [form, setForm] = useState<FormState>(() => emptyForm(defaultType))
  const [error, setError] = useState<string | null>(null)

  // edit 모드: 상세가 로드되면 폼을 채운다.
  const doc = docQuery.data
  useEffect(() => {
    if (!editing || !doc) return
    setForm({
      type: doc.type,
      title: doc.title,
      content: doc.content ?? '',
      choices: (doc.choices ?? []).join('\n'),
      answer: doc.answer ?? '',
      explanation: doc.explanation ?? '',
      difficulty: doc.difficulty != null ? String(doc.difficulty) : '',
    })
  }, [editing, doc])

  const questionLike = isQuestionLike(form.type)
  const submitting = createDocument.isPending || updateDocument.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setError(null)
    const choices = questionLike
      ? form.choices.split('\n').map((c) => c.trim()).filter(Boolean)
      : undefined
    const difficulty = form.difficulty ? Number(form.difficulty) : null

    if (editing) {
      if (documentId == null) return
      updateDocument.mutate(
        {
          id: documentId,
          title: form.title.trim(),
          content: form.content,
          choices,
          answer: form.answer,
          explanation: form.explanation,
          difficulty,
        },
        {
          onSuccess: (data) => {
            onSaved?.(data)
            onClose()
          },
          onError: (err) => setError(errMsg(err, '저장에 실패했습니다.')),
        },
      )
    } else {
      createDocument.mutate(
        {
          type: form.type,
          title: form.title.trim(),
          content: form.content,
          choices,
          answer: form.answer,
          explanation: form.explanation,
          difficulty,
          category_id: categoryId ?? undefined,
        },
        {
          onSuccess: (result) => {
            if (result.linkError) {
              setError(`문서는 생성했으나 분류 연결에 실패했습니다: ${result.linkError}`)
              return
            }
            onSaved?.(result.document)
            onClose()
          },
          onError: (err) => setError(errMsg(err, '생성에 실패했습니다.')),
        },
      )
    }
  }

  const loadingDetail = editing && docQuery.isLoading

  return (
    <Modal title={editing ? '문서 편집' : '새 문서'} onClose={onClose} widthClass="max-w-lg">
      {loadingDetail ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : editing && docQuery.isError ? (
        <p className="text-sm text-wrong">{errMsg(docQuery.error, '문서를 불러오지 못했습니다.')}</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {!editing && categoryName && (
            <p className="rounded bg-accent-soft px-2 py-1 text-xs text-accent">
              생성 후 "{categoryName}" 분류에 자동 연결됩니다.
            </p>
          )}

          {!editing ? (
            <label className="flex flex-col gap-1 text-sm">
              타입
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as DocumentType }))}
                className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs text-muted">
              타입: {TYPE_OPTIONS.find((o) => o.value === form.type)?.label ?? form.type}
            </p>
          )}

          <label className="flex flex-col gap-1 text-sm">
            제목
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            본문 (Markdown)
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={5}
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
          </label>

          {questionLike && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                보기 (줄바꿈으로 구분)
                <textarea
                  value={form.choices}
                  onChange={(e) => setForm((f) => ({ ...f, choices: e.target.value }))}
                  rows={4}
                  className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                  placeholder={'보기1\n보기2'}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                정답
                <input
                  value={form.answer}
                  onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
                  className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                해설 (Markdown)
                <textarea
                  value={form.explanation}
                  onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
                  rows={4}
                  className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1 text-sm">
            난이도 (1~5, 선택)
            <input
              type="number"
              min={1}
              max={5}
              value={form.difficulty}
              onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
          </label>

          {error && <p className="text-sm text-wrong">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              {editing ? '저장' : '생성'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
