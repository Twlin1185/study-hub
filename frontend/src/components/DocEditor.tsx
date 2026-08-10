import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import MarkdownFieldEditor from './MarkdownFieldEditor'
import { useCreateDocument, useDocument, useUpdateDocument } from '../api/documents'
import { ApiError } from '../api/client'
import type { DocumentDetail, DocumentType } from '../api/types'

// 문서 3대 공용 모듈 중 DocEditor (설계 §5 도입부·§5.4, F37 · stage-26 9-5 후속) — 작성/수정 폼.
// 팝업(모달)과 전용 라우트(창) 양쪽에서 이 컴포넌트 그대로를 렌더한다(저장·검증 로직 공용 —
// 경로별 분기 금지). 본문·해설 편집기는 공용 MarkdownFieldEditor 서브컴포넌트(9-4)로 필드
// 분기 없이 동일하게 적용한다.
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
  // 'modal'(기본) = 팝업. 'page' = 전용 라우트(창, 9-5) — 같은 폼을 페이지 레이아웃으로 렌더.
  variant?: 'modal' | 'page'
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
  variant = 'modal',
}: DocEditorProps) {
  const editing = mode === 'edit'
  const navigate = useNavigate()
  const docQuery = useDocument(editing ? (documentId ?? null) : null)
  const createDocument = useCreateDocument()
  const updateDocument = useUpdateDocument()

  const [form, setForm] = useState<FormState>(() => emptyForm(defaultType))
  const [error, setError] = useState<string | null>(null)
  // 본문·해설 각 MarkdownFieldEditor의 참조 삽입 팝업이 열려 있는 동안에는 바깥 모달이
  // Esc·배경 클릭으로 (편집 내용을 잃으며) 닫히지 않게 한다 — 9-4로 필드가 늘어나 두 인스턴스를
  // 함께 추적한다.
  const [refModalOpen, setRefModalOpen] = useState({ content: false, explanation: false })
  const anyRefModalOpen = refModalOpen.content || refModalOpen.explanation

  // 치명-1 수정(이중 방어 ①): 콜백 identity를 고정(useCallback)하고, setState가 값이 같으면
  // 이전 객체를 그대로 돌려준다(새 참조를 만들지 않음) — 자식(MarkdownFieldEditor)이 렌더마다
  // "새 콜백을 받았다"는 이유만으로 이펙트를 다시 돌리고 그게 다시 이 setState를 부르는 닫힌
  // 루프를 만들지 않게 한다. 자식 쪽도 ref로 이중 방어한다(MarkdownFieldEditor.tsx 참조).
  const handleContentRefModalOpenChange = useCallback((open: boolean) => {
    setRefModalOpen((s) => (s.content === open ? s : { ...s, content: open }))
  }, [])
  const handleExplanationRefModalOpenChange = useCallback((open: boolean) => {
    setRefModalOpen((s) => (s.explanation === open ? s : { ...s, explanation: open }))
  }, [])

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
          // 중요-1 수정: onSaved가 있으면(주로 page variant — 저장 후 문서 상세로 replace 이동)
          // onClose(취소/닫기 전용 경로 — 페이지에선 navigate(-1))를 함께 부르지 않는다. onSaved가
          // 없는 기존 모달 사용처는 그대로 onClose로 닫힌다(모달 기존 동작 불변).
          onSuccess: (data) => {
            if (onSaved) onSaved(data)
            else onClose()
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
            // 경미-3 수정: 분류 연결 실패는 "문서 생성 자체는 성공"으로 처리한다 — 모달을 계속
            // 열어 둔 채 재제출을 유도하면(기존 동작) 중복 생성 위험이 있다. 경고만 알리고
            // 저장 성공과 같은 경로(onSaved/onClose)로 진행한다(종전 Explore pageNotice 수준).
            if (result.linkError) {
              window.alert(`문서는 생성했으나 분류 연결에 실패했습니다: ${result.linkError}`)
            }
            if (onSaved) onSaved(result.document)
            else onClose()
          },
          onError: (err) => setError(errMsg(err, '생성에 실패했습니다.')),
        },
      )
    }
  }

  // "창으로 열기"(9-5) — 수정은 문서 id로, 신규 작성은 타입·분류 컨텍스트를 쿼리 파라미터로
  // 유지한 채 전용 라우트로 이동한다. 저장·검증은 그 라우트에서도 이 컴포넌트 그대로 처리(공용).
  function openInWindow() {
    if (editing && documentId != null) {
      navigate(`/docs/${documentId}/edit`)
    } else {
      const params = new URLSearchParams()
      params.set('type', form.type)
      if (categoryId != null) params.set('categoryId', String(categoryId))
      if (categoryName) params.set('categoryName', categoryName)
      navigate(`/docs/new?${params.toString()}`)
    }
    onClose()
  }

  const loadingDetail = editing && docQuery.isLoading

  const body: ReactNode = loadingDetail ? (
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

      <MarkdownFieldEditor
        id="doc-content"
        label="본문 (Markdown)"
        value={form.content}
        onChange={(next) => setForm((f) => ({ ...f, content: next }))}
        rows={8}
        docNo={doc?.doc_no}
        onRefModalOpenChange={handleContentRefModalOpenChange}
      />

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
          <MarkdownFieldEditor
            id="doc-explanation"
            label="해설 (Markdown)"
            value={form.explanation}
            onChange={(next) => setForm((f) => ({ ...f, explanation: next }))}
            rows={4}
            docNo={doc?.doc_no}
            onRefModalOpenChange={handleExplanationRefModalOpenChange}
          />
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
  )

  if (variant === 'page') {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-primary">{editing ? '문서 편집' : '새 문서'}</h1>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            닫기
          </button>
        </div>
        {body}
      </div>
    )
  }

  return (
    // 참조 삽입 팝업이 열려 있는 동안에는 바깥 모달이 Esc·배경 클릭으로 닫히지 않게 한다
    // (두 모달이 같은 window keydown을 듣기 때문 — 편집 내용 유실 방지). 팝업 쪽은 자체 핸들러로
    // 스스로 닫히므로 여기서는 실제 onClose 대신 아무 것도 하지 않으면 충분하다.
    <Modal
      title={editing ? '문서 편집' : '새 문서'}
      onClose={anyRefModalOpen ? () => {} : onClose}
      widthClass="max-w-2xl"
      headerExtra={
        <button
          type="button"
          onClick={openInWindow}
          title="이 편집기를 별도 페이지(창)로 엽니다"
          className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg"
        >
          창으로 열기
        </button>
      }
    >
      {body}
    </Modal>
  )
}
