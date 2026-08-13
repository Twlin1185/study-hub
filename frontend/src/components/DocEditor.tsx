import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import MarkdownFieldEditor from './MarkdownFieldEditor'
import DocStyleFields from './DocStyleFields'
import { useCreateDocument, useDocument, useUpdateDocument } from '../api/documents'
import { ApiError } from '../api/client'
import type { DocumentDetail, DocumentStyle, DocumentType } from '../api/types'

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
  // "창으로 열기" 이월 초안(10-1ⓒ 연장) — 있으면 서버 문서·빈 폼보다 우선하고, 즉시 dirty로
  // 간주한다(DocEditPage가 sessionStorage에서 1회성으로 읽어 넘긴다).
  initialDraft?: FormState | null
}

export interface FormState {
  type: DocumentType
  title: string
  content: string
  choices: string
  answer: string
  explanation: string
  difficulty: string
  // S28(F53 ②) — 편집 모드 전용 폼 필드(screens §5.3 S28). 신규 작성 시에는 항상 null 그대로
  // 두고 전송하지 않는다(§4.26 ①은 PATCH만 계약 — POST 경로는 이 단계 범위 밖).
  style: DocumentStyle | null
}

function emptyForm(defaultType: DocumentType): FormState {
  return {
    type: defaultType,
    title: '',
    content: '',
    choices: '',
    answer: '',
    explanation: '',
    difficulty: '',
    style: null,
  }
}

// "창으로 열기" 이월 초안 sessionStorage 키(10-1ⓒ 연장) — DocEditPage가 1회성으로 읽고 즉시
// 지운다. DocEditor가 FormState의 단일 출처이므로 이 파일에서 내보낸다(다른 파일은 손대지 않고
// import만 하면 되게).
export const DRAFT_STORAGE_KEY = 'docEditor.draft'

export default function DocEditor({
  mode,
  documentId,
  defaultType = 'concept',
  categoryId,
  categoryName,
  onClose,
  onSaved,
  variant = 'modal',
  initialDraft,
}: DocEditorProps) {
  const editing = mode === 'edit'
  const navigate = useNavigate()
  const docQuery = useDocument(editing ? (documentId ?? null) : null)
  const createDocument = useCreateDocument()
  const updateDocument = useUpdateDocument()

  const [form, setForm] = useState<FormState>(() => initialDraft ?? emptyForm(defaultType))
  const [error, setError] = useState<string | null>(null)
  // "창으로 열기" 이월 초안으로 시작했으면 지시서대로 무조건 dirty로 간주한다(내용이 실제로
  // 서버 값과 같아도 — 사용자가 편집 중이던 걸 이어받았다는 사실 자체가 dirty).
  const startedFromDraftRef = useRef(initialDraft != null)
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

  // 10-1ⓒ 미저장 보호 — 폼이 "초기값"(빈 폼, 또는 불러온 문서 그대로)과 다르면 닫기 시도(Esc·
  // 오버레이·X·페이지 취소) 때 확인창을 거친다. 초기값은 edit 모드에서 문서가 로드되는 시점에
  // form과 함께 갱신한다(로드 직후를 "변경 없음"으로 본다 — 로드 자체를 dirty로 오판하지 않게).
  const initialFormRef = useRef<FormState>(emptyForm(defaultType))
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)

  // edit 모드: 상세가 로드되면 폼을 채운다 — 단, 이월 초안이 있으면 서버 값보다 우선이므로
  // 이 로드 이펙트가 방금 적용한 초안을 덮어쓰지 않게 건너뛴다(지시서 "편집 모드에서는 서버
  // 문서보다 이월 초안이 우선").
  const doc = docQuery.data
  useEffect(() => {
    if (!editing || !doc || initialDraft) return
    const loaded: FormState = {
      type: doc.type,
      title: doc.title,
      content: doc.content ?? '',
      choices: (doc.choices ?? []).join('\n'),
      answer: doc.answer ?? '',
      explanation: doc.explanation ?? '',
      difficulty: doc.difficulty != null ? String(doc.difficulty) : '',
      style: doc.style ?? null,
    }
    setForm(loaded)
    initialFormRef.current = loaded
  }, [editing, doc, initialDraft])

  const isDirty = startedFromDraftRef.current || JSON.stringify(form) !== JSON.stringify(initialFormRef.current)

  // 닫기 "시도" 진입점 — Esc·오버레이·X(Modal의 onClose)·페이지 닫기·폼의 취소 버튼이 전부 이
  // 함수를 거친다. 저장 성공 경로(onSuccess 핸들러)는 이 함수를 부르지 않고 onSaved/onClose를
  // 직접 호출하므로 확인 없이 닫힌다(지시서 "저장 성공 경로는 확인 없이 닫힘").
  function attemptClose() {
    if (isDirty) setConfirmCloseOpen(true)
    else onClose()
  }

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
          style: form.style,
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

  // "창으로 열기"(9-5, 10-1ⓒ 연장) — 수정은 문서 id로, 신규 작성은 타입·분류 컨텍스트를 쿼리
  // 파라미터로 유지한 채 전용 라우트로 이동한다. 저장·검증은 그 라우트에서도 이 컴포넌트 그대로
  // 처리(공용). 폼이 초기값과 달라져 있으면(dirty) 그 내용을 sessionStorage에 1회성 초안으로
  // 이월해 새 창/페이지가 그대로 이어받게 한다 — 초기값 그대로(빈 폼 등)면 이월할 것이 없으므로
  // 건너뛴다(§10 잔여 경미-2: 안 그러면 새 페이지가 빈 폼인데도 "초안으로 시작 = dirty"가 되어
  // 곧바로 닫기 확인창이 뜬다). 이월(또는 건너뜀) 후에는 onClose를 바로 부른다(확인 없이 닫힘,
  // attemptClose를 거치지 않음 — 내용 손실이 아니다).
  function openInWindow() {
    if (isDirty) {
      try {
        sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(form))
      } catch {
        // 사생활 보호 모드 등으로 sessionStorage 접근 불가 — 이월 없이 새 창은 그대로 연다.
      }
    }
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
        minHeightClass="min-h-[50vh]"
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

      {/* 문서별 스타일(S28 — F53 ②, screens §5.3) — 편집 모드 전용(신규 작성 시 폼 없음, §4.26
          ①은 PATCH 계약이라 생성 직후 별도 저장 왕복이 필요해 이 단계 범위 밖으로 둔다). */}
      {editing && (
        <div className="rounded-lg border border-border bg-bg p-3">
          <p className="mb-2 text-sm font-medium text-primary">문서 스타일 (이 문서만)</p>
          <p className="mb-2 text-xs text-muted">
            지정하지 않으면 전역 설정을 따릅니다. 임베드 카드 안·인쇄 배경에는 적용되지 않습니다.
          </p>
          <DocStyleFields value={form.style} onChange={(next) => setForm((f) => ({ ...f, style: next }))} />
        </div>
      )}

      {error && <p className="text-sm text-wrong">{error}</p>}

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={attemptClose}
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

  // 10-1ⓒ — 미저장 변경 확인창(ConfirmDialog 재사용, window.confirm 금지). 어느 variant에서든
  // attemptClose가 dirty를 감지했을 때만 뜬다.
  const confirmCloseDialog = confirmCloseOpen && (
    <ConfirmDialog
      title="편집 닫기"
      message="작성 중인 내용이 있습니다. 닫을까요?"
      confirmLabel="닫기"
      danger
      onConfirm={() => {
        setConfirmCloseOpen(false)
        onClose()
      }}
      onClose={() => setConfirmCloseOpen(false)}
    />
  )

  if (variant === 'page') {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-primary">{editing ? '문서 편집' : '새 문서'}</h1>
          <button
            type="button"
            onClick={attemptClose}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            닫기
          </button>
        </div>
        {body}
        {confirmCloseDialog}
      </div>
    )
  }

  return (
    // 참조 삽입 팝업이 열려 있는 동안에는 바깥 모달이 Esc·배경 클릭으로 닫히지 않게 한다
    // (두 모달이 같은 window keydown을 듣기 때문 — 편집 내용 유실 방지). 팝업 쪽은 자체 핸들러로
    // 스스로 닫히므로 여기서는 실제 onClose 대신 아무 것도 하지 않으면 충분하다. ref 팝업이 열려
    // 있지 않으면 attemptClose로 보내 미저장 변경 확인(10-1ⓒ)을 거치게 한다.
    <Modal
      title={editing ? '문서 편집' : '새 문서'}
      onClose={anyRefModalOpen ? () => {} : attemptClose}
      widthClass="max-w-6xl"
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
      {confirmCloseDialog}
    </Modal>
  )
}
