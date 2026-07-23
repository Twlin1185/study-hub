import { useState } from 'react'
import type { FormEvent } from 'react'
import Modal from './Modal'

const LEVEL_HINTS = ['자격증', '시험', '과목', '단원']

export interface CategoryFormValues {
  name: string
  level_hint: string | null
  exam_date: string | null
}

interface CategoryFormModalProps {
  title: string
  initial?: Partial<CategoryFormValues>
  submitLabel: string
  onSubmit: (values: CategoryFormValues) => void
  onClose: () => void
  submitting?: boolean
  errorMessage?: string | null
}

export default function CategoryFormModal({
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose,
  submitting,
  errorMessage,
}: CategoryFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [levelHint, setLevelHint] = useState(initial?.level_hint ?? '')
  const [examDate, setExamDate] = useState(initial?.exam_date ?? '')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      level_hint: levelHint || null,
      exam_date: examDate || null,
    })
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          이름
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            placeholder="예: 정보처리기사"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          레벨 힌트 (표시용)
          <select
            value={levelHint}
            onChange={(e) => setLevelHint(e.target.value)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          >
            <option value="">(없음)</option>
            {LEVEL_HINTS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          시험일 (선택, D-Day용)
          <input
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
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
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
