import { useState } from 'react'
import type { FormEvent } from 'react'
import Modal from './Modal'
import type { DocumentType } from '../api/types'

const TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'concept', label: '개념' },
  { value: 'question', label: '문제' },
  { value: 'past_question', label: '기출문제' },
  { value: 'flashcard', label: '플래시카드' },
]

export interface CreateDocumentValues {
  type: DocumentType
  title: string
  content: string
  choices: string[]
  answer: string
  explanation: string
  difficulty: number | null
}

interface CreateDocumentModalProps {
  onSubmit: (values: CreateDocumentValues) => void
  onClose: () => void
  submitting?: boolean
  errorMessage?: string | null
  defaultCategoryName?: string | null
}

export default function CreateDocumentModal({
  onSubmit,
  onClose,
  submitting,
  errorMessage,
  defaultCategoryName,
}: CreateDocumentModalProps) {
  const [type, setType] = useState<DocumentType>('concept')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [choicesText, setChoicesText] = useState('')
  const [answer, setAnswer] = useState('')
  const [explanation, setExplanation] = useState('')
  const [difficulty, setDifficulty] = useState('')

  const isQuestionLike = type === 'question' || type === 'past_question'

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      type,
      title: title.trim(),
      content,
      choices: choicesText
        .split('\n')
        .map((c) => c.trim())
        .filter(Boolean),
      answer,
      explanation,
      difficulty: difficulty ? Number(difficulty) : null,
    })
  }

  return (
    <Modal title="새 문서" onClose={onClose} widthClass="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {defaultCategoryName && (
          <p className="rounded bg-accent-soft px-2 py-1 text-xs text-accent">
            생성 후 "{defaultCategoryName}" 분류에 자동 연결됩니다.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          타입          <select
            value={type}
            onChange={(e) => setType(e.target.value as DocumentType)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          제목
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          본문 (Markdown)
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
        </label>

        {isQuestionLike && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              보기 (줄바꿈으로 구분)
              <textarea
                value={choicesText}
                onChange={(e) => setChoicesText(e.target.value)}
                rows={3}
                className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                placeholder={'① 보기1\n② 보기2'}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              정답
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              해설 (Markdown)
              <textarea
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                rows={3}
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
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
        </label>

        {errorMessage && <p className="text-sm text-wrong">{errorMessage}</p>}

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
            생성
          </button>
        </div>
      </form>
    </Modal>
  )
}
