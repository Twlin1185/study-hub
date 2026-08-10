import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import Modal from './Modal'
import RefInsertModal from './RefInsertModal'
import MarkdownView from './MarkdownView'
import { useCreateDocument, useDocument, useUpdateDocument } from '../api/documents'
import { ApiError } from '../api/client'
import type { DocumentDetail, DocumentType } from '../api/types'
import { PALETTE_COLORS, PALETTE_LABEL, TEXT_SIZES, TEXT_SIZE_LABEL } from './markdown/palette'
import type { PaletteColor, TextSize } from './markdown/palette'

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
  // 참조 삽입 도우미(F43, 설계 §4.19 ⑨) — 본문 textarea의 커서 위치에 삽입한다.
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const [refInsertOpen, setRefInsertOpen] = useState(false)
  // 분할 라이브 미리보기(F52 ④) — 좁은 화면(<768px)은 탭 전환, md 이상은 나란히(구현 재량).
  const [previewTab, setPreviewTab] = useState<'edit' | 'preview'>('edit')

  function insertAtCursor(snippet: string) {
    const el = contentRef.current
    setForm((f) => {
      const value = f.content
      const start = el?.selectionStart ?? value.length
      const end = el?.selectionEnd ?? value.length
      const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`
      // 삽입 후 커서를 삽입 문자열 뒤로 옮긴다(다음 렌더에서 적용).
      requestAnimationFrame(() => {
        if (!el) return
        el.focus()
        const caret = start + snippet.length
        el.setSelectionRange(caret, caret)
      })
      return { ...f, content: next }
    })
  }

  // 선택 영역 래핑(F52 ④) — insertAtCursor를 확장: 선택이 있으면 그 텍스트를 감싸고, 없으면
  // 자리표시자 텍스트를 넣은 뒤 그 자리표시자를 선택 상태로 남겨 바로 고쳐 쓸 수 있게 한다.
  function wrapSelection(before: string, after: string, placeholder: string) {
    const el = contentRef.current
    setForm((f) => {
      const value = f.content
      const start = el?.selectionStart ?? value.length
      const end = el?.selectionEnd ?? value.length
      const hasSelection = end > start
      const selected = hasSelection ? value.slice(start, end) : placeholder
      const inserted = `${before}${selected}${after}`
      const next = `${value.slice(0, start)}${inserted}${value.slice(end)}`
      requestAnimationFrame(() => {
        if (!el) return
        el.focus()
        const selStart = start + before.length
        const selEnd = selStart + selected.length
        el.setSelectionRange(selStart, selEnd)
      })
      return { ...f, content: next }
    })
  }

  function wrapDirective(attr: string, placeholder: string) {
    wrapSelection(':t[', `]{${attr}}`, placeholder)
  }

  function insertCallout(kind: 'note' | 'warn' | 'tip') {
    wrapSelection(`:::${kind}[제목]\n`, '\n:::', '내용')
  }

  // 단축키 4종만(과설계 금지 — 그 이상은 툴바 전용, F52 ④). textarea 포커스 시 preventDefault.
  function handleContentKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!e.ctrlKey) return
    const key = e.key.toLowerCase()
    if (!e.shiftKey && key === 'b') {
      e.preventDefault()
      wrapSelection('**', '**', '굵게')
    } else if (!e.shiftKey && key === 'i') {
      e.preventDefault()
      wrapSelection('*', '*', '기울임')
    } else if (!e.shiftKey && key === 'u') {
      e.preventDefault()
      wrapSelection('++', '++', '밑줄')
    } else if (e.shiftKey && key === 'h') {
      e.preventDefault()
      wrapSelection('==', '==', '형광펜')
    }
  }

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
    // 참조 삽입 팝업이 열려 있는 동안에는 바깥 모달이 Esc·배경 클릭으로 닫히지 않게 한다
    // (두 모달이 같은 window keydown을 듣기 때문 — 편집 내용 유실 방지).
    <Modal
      title={editing ? '문서 편집' : '새 문서'}
      onClose={refInsertOpen ? () => setRefInsertOpen(false) : onClose}
      widthClass="max-w-2xl"
    >
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

          <div className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="doc-content" className="text-sm text-primary">
                본문 (Markdown)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {/* 좁은 화면(<768px)은 분할 대신 탭 전환(F52 ④ 구현 재량) */}
                <div className="flex gap-1 md:hidden">
                  <button
                    type="button"
                    onClick={() => setPreviewTab('edit')}
                    className={`rounded border px-2 py-1 text-xs ${
                      previewTab === 'edit'
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border text-primary hover:bg-bg'
                    }`}
                  >
                    편집
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab('preview')}
                    className={`rounded border px-2 py-1 text-xs ${
                      previewTab === 'preview'
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border text-primary hover:bg-bg'
                    }`}
                  >
                    미리보기
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setRefInsertOpen(true)}
                  className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg"
                >
                  ＋ 참조 삽입
                </button>
              </div>
            </div>

            {/* 툴바 — 선택 영역 래핑(F52 ④). 색상 계열 select는 값을 고르면 바로 적용하고 원상태로
                되돌아간다(선택창을 계속 열어 둘 이유가 없다 — 과설계 금지). */}
            <div className="flex flex-wrap items-center gap-1 rounded border border-border bg-bg p-1">
              <button
                type="button"
                title="굵게 (Ctrl+B)"
                onClick={() => wrapSelection('**', '**', '굵게')}
                className="rounded px-2 py-1 text-xs font-bold text-primary hover:bg-surface"
              >
                B
              </button>
              <button
                type="button"
                title="기울임 (Ctrl+I)"
                onClick={() => wrapSelection('*', '*', '기울임')}
                className="rounded px-2 py-1 text-xs italic text-primary hover:bg-surface"
              >
                I
              </button>
              <button
                type="button"
                title="취소선"
                onClick={() => wrapSelection('~~', '~~', '취소선')}
                className="rounded px-2 py-1 text-xs text-primary line-through hover:bg-surface"
              >
                S
              </button>
              <button
                type="button"
                title="밑줄 (Ctrl+U)"
                onClick={() => wrapSelection('++', '++', '밑줄')}
                className="rounded px-2 py-1 text-xs text-primary underline hover:bg-surface"
              >
                U
              </button>
              <button
                type="button"
                title="형광펜(기본 노랑, Ctrl+Shift+H)"
                onClick={() => wrapSelection('==', '==', '형광펜')}
                className="rounded bg-mark-yellow px-2 py-1 text-xs text-primary hover:opacity-80"
              >
                형광펜
              </button>
              <select
                aria-label="형광펜 색상"
                defaultValue=""
                onChange={(e) => {
                  const color = e.target.value as PaletteColor | ''
                  if (color) wrapDirective(`bg=${color}`, '형광펜')
                  e.target.value = ''
                }}
                className="rounded border border-border bg-surface px-1 py-1 text-xs text-primary outline-none focus:border-accent"
              >
                <option value="" disabled>
                  형광펜 색…
                </option>
                {PALETTE_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {PALETTE_LABEL[c]}
                  </option>
                ))}
              </select>
              <select
                aria-label="글자색"
                defaultValue=""
                onChange={(e) => {
                  const color = e.target.value as PaletteColor | ''
                  if (color) wrapDirective(`c=${color}`, '글자색')
                  e.target.value = ''
                }}
                className="rounded border border-border bg-surface px-1 py-1 text-xs text-primary outline-none focus:border-accent"
              >
                <option value="" disabled>
                  글자색…
                </option>
                {PALETTE_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {PALETTE_LABEL[c]}
                  </option>
                ))}
              </select>
              <select
                aria-label="글자 크기"
                defaultValue=""
                onChange={(e) => {
                  const size = e.target.value as TextSize | ''
                  if (size) wrapDirective(`s=${size}`, '크기')
                  e.target.value = ''
                }}
                className="rounded border border-border bg-surface px-1 py-1 text-xs text-primary outline-none focus:border-accent"
              >
                <option value="" disabled>
                  크기…
                </option>
                {TEXT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {TEXT_SIZE_LABEL[s]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                title="인라인 스포일러"
                onClick={() => wrapSelection('||', '||', '스포일러')}
                className="rounded px-2 py-1 text-xs text-primary hover:bg-surface"
              >
                스포일러
              </button>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <button
                type="button"
                title="콜아웃 — 참고"
                onClick={() => insertCallout('note')}
                className="rounded px-2 py-1 text-xs text-accent hover:bg-surface"
              >
                참고
              </button>
              <button
                type="button"
                title="콜아웃 — 주의"
                onClick={() => insertCallout('warn')}
                className="rounded px-2 py-1 text-xs text-warning hover:bg-surface"
              >
                주의
              </button>
              <button
                type="button"
                title="콜아웃 — 팁"
                onClick={() => insertCallout('tip')}
                className="rounded px-2 py-1 text-xs text-correct hover:bg-surface"
              >
                팁
              </button>
            </div>

            {/* 분할 라이브 미리보기(F52 ④) — 같은 공용 MarkdownView 재사용(미리보기 전용 렌더 경로 금지). */}
            <div className="grid gap-2 md:grid-cols-2">
              <textarea
                id="doc-content"
                ref={contentRef}
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                onKeyDown={handleContentKeyDown}
                rows={8}
                className={`rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent ${
                  previewTab === 'preview' ? 'hidden md:block' : ''
                }`}
              />
              <div
                className={`max-h-64 overflow-y-auto rounded border border-border bg-surface px-3 py-2 ${
                  previewTab === 'edit' ? 'hidden md:block' : ''
                }`}
              >
                <MarkdownView content={form.content || '_미리볼 내용이 없습니다._'} />
              </div>
            </div>
            {/* 문법 힌트 1줄 (설계 §4.19 ⑨ + §5.3 S26/F52) */}
            <p className="text-xs text-muted">
              {'![[DOC-0012|별칭]]'} 임베드 · {'[[DOC-0012]]'} 문서 이동 · {'[[#절 제목]]'} 앵커 ·{' '}
              {':::fold[제목] … :::'} 접기 · {':::hide[제목] … :::'} 가리기 · {'++밑줄++'} · {'==형광펜=='} ·{' '}
              {'||스포일러||'} · {':t[텍스트]{c=red bg=yellow s=large}'} · {':::note/warn/tip[제목] … :::'} 콜아웃
            </p>
          </div>

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

      {refInsertOpen && (
        <RefInsertModal onInsert={insertAtCursor} onClose={() => setRefInsertOpen(false)} />
      )}
    </Modal>
  )
}
