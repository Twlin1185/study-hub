import { useState } from 'react'
import { useCategoryTree, useUpdateCategory } from '../api/categories'
import { useSettings, useUpdateSettings } from '../api/settings'
import type { CustomDDay } from '../api/types'
import { ApiError } from '../api/client'
import { findCategory, flattenCategories } from '../utils/tree'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `dd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// 설계 §5.11 — D-Day 관리. DDL 변경 없이 두 종류를 관리한다:
// ① 시험 분류 exam_date (PATCH /categories/{id} 재사용)
// ② 임의 D-Day (settings.ddays.custom = [{id, label, date}], settings GET/PUT 재사용)
export default function DDayManager() {
  return (
    <section className="mb-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-primary">D-Day 관리</h2>
      <p className="mb-3 text-xs text-muted">
        시험 분류의 시험일과, 접수 마감·발표일 같은 임의 일정을 함께 관리합니다. 홈 배지에 병합돼 표시됩니다.
      </p>
      <ExamDateSection />
      <div className="my-4 border-t border-border" />
      <CustomDDaySection />
    </section>
  )
}

function ExamDateSection() {
  const treeQuery = useCategoryTree()
  const updateCategory = useUpdateCategory()
  const flat = flattenCategories(treeQuery.data ?? [])

  const [categoryId, setCategoryId] = useState<string>('')
  const [examDate, setExamDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const selectedNode = categoryId
    ? findCategory(treeQuery.data ?? [], Number(categoryId))
    : null

  function handleSelect(id: string) {
    setCategoryId(id)
    setSaved(false)
    setError(null)
    const node = id ? findCategory(treeQuery.data ?? [], Number(id)) : null
    setExamDate(node?.exam_date ?? '')
  }

  function handleSave() {
    if (!categoryId) return
    setError(null)
    updateCategory.mutate(
      { id: Number(categoryId), exam_date: examDate || null },
      {
        onSuccess: () => {
          setSaved(true)
          window.setTimeout(() => setSaved(false), 1500)
        },
        onError: (e) => setError(errMsg(e, '저장에 실패했습니다.')),
      },
    )
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-primary">시험 분류 D-Day</h3>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={categoryId}
          onChange={(e) => handleSelect(e.target.value)}
          className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        >
          <option value="">분류 선택…</option>
          {flat.map((c) => (
            <option key={c.id} value={c.id}>
              {'　'.repeat(c.depth)}
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={examDate}
          onChange={(e) => setExamDate(e.target.value)}
          disabled={!categoryId}
          className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!categoryId || updateCategory.isPending}
          className="shrink-0 rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {saved ? '저장됨' : '저장'}
        </button>
        {selectedNode?.exam_date && (
          <button
            type="button"
            onClick={() => {
              setExamDate('')
              updateCategory.mutate(
                { id: Number(categoryId), exam_date: null },
                { onError: (e) => setError(errMsg(e, '제거에 실패했습니다.')) },
              )
            }}
            className="shrink-0 rounded border border-border px-3 py-2 text-sm text-wrong hover:bg-bg"
          >
            제거
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-wrong">{error}</p>}
    </div>
  )
}

function CustomDDaySection() {
  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()
  const customDDays = settingsQuery.data?.['ddays.custom'] ?? []

  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function saveList(next: CustomDDay[], onDone?: () => void) {
    setError(null)
    updateSettings.mutate(
      { 'ddays.custom': next },
      {
        onSuccess: () => onDone?.(),
        onError: (e) => setError(errMsg(e, '저장에 실패했습니다.')),
      },
    )
  }

  function handleAddOrUpdate() {
    if (!label.trim() || !date) {
      setError('라벨과 날짜를 모두 입력하세요.')
      return
    }
    if (editingId) {
      const next = customDDays.map((d) => (d.id === editingId ? { ...d, label: label.trim(), date } : d))
      saveList(next, () => resetForm())
    } else {
      const next = [...customDDays, { id: newId(), label: label.trim(), date }]
      saveList(next, () => resetForm())
    }
  }

  function resetForm() {
    setLabel('')
    setDate('')
    setEditingId(null)
  }

  function handleEdit(d: CustomDDay) {
    setEditingId(d.id)
    setLabel(d.label)
    setDate(d.date)
  }

  function handleDelete(id: string) {
    saveList(customDDays.filter((d) => d.id !== id))
    if (editingId === id) resetForm()
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-primary">임의 D-Day (접수 마감·발표일 등)</h3>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="예: 실기 접수 마감"
          className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={handleAddOrUpdate}
          disabled={updateSettings.isPending}
          className="shrink-0 rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {editingId ? '수정' : '+ 추가'}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={resetForm}
            className="shrink-0 rounded border border-border px-3 py-2 text-sm text-primary hover:bg-bg"
          >
            취소
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-wrong">{error}</p>}

      {customDDays.length === 0 ? (
        <p className="text-sm text-muted">등록된 임의 D-Day가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {customDDays.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 rounded border border-border bg-bg px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-primary">
                {d.label} <span className="text-xs text-muted">({d.date})</span>
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => handleEdit(d)}
                  className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(d.id)}
                  className="rounded border border-border px-2 py-1 text-xs text-wrong hover:bg-surface"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
