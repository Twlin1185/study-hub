import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCategoryTree } from '../api/categories'
import { useSettings } from '../api/settings'
import { useCreateQuizSession } from '../api/quiz'
import { useQuizSessionStore } from '../stores/quizSession'
import type { QuizMode } from '../api/types'
import { ApiError } from '../api/client'
import CategoryScopePicker from '../components/CategoryScopePicker'
import QuizExamTabs from '../components/QuizExamTabs'

const MODE_OPTIONS: { value: QuizMode; label: string }[] = [
  { value: 'sequential', label: '순차' },
  { value: 'random', label: '랜덤' },
  { value: 'wrong_only', label: '오답만' },
  { value: 'bookmarked', label: '북마크만' },
]

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §5.6 — 퀴즈 설정 화면. 범위(트리)·모드·문항 수를 골라 quiz/session을 생성하고
// zustand quizSession 스토어에 담아 /quiz/run으로 이동한다.
export default function QuizPage() {
  const navigate = useNavigate()
  const treeQuery = useCategoryTree()
  const settingsQuery = useSettings()
  const createSession = useCreateQuizSession()
  const start = useQuizSessionStore((s) => s.start)

  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [mode, setMode] = useState<QuizMode>('random')
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const defaultCount = settingsQuery.data?.['quiz.default_count'] ?? 10

  // 설정값이 늦게 도착하면 그때 기본값을 반영 (사용자가 이미 직접 입력했으면 덮어쓰지 않음)
  useEffect(() => {
    if (count === null && settingsQuery.data?.['quiz.default_count'] != null) {
      setCount(settingsQuery.data['quiz.default_count'])
    }
  }, [count, settingsQuery.data])

  const effectiveCount = count ?? defaultCount

  function handleStart() {
    setError(null)
    createSession.mutate(
      { category_id: categoryId ?? undefined, mode, count: effectiveCount },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) {
            setError('조건에 맞는 문제가 없습니다.')
            return
          }
          start(data.items, mode, categoryId)
          navigate('/quiz/run')
        },
        onError: (e) => setError(errMsg(e, '퀴즈를 시작하지 못했습니다.')),
      },
    )
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl font-semibold text-primary">퀴즈</h1>

      {/* 실전 모의고사 진입 탭 (설계 §5.6, S11) — 모의고사는 §5.12 별도 흐름(일괄 제출 채점). */}
      <QuizExamTabs />

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-primary">범위</h2>
        {treeQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
        {treeQuery.isError && <p className="text-sm text-wrong">분류를 불러오지 못했습니다.</p>}
        {treeQuery.data && (
          <CategoryScopePicker nodes={treeQuery.data} selectedId={categoryId} onSelect={setCategoryId} />
        )}
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-primary">모드</h2>
        <div className="grid grid-cols-2 gap-2">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                mode === opt.value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface text-primary hover:bg-bg'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-primary">문항 수</h2>
        <input
          type="number"
          min={1}
          max={100}
          value={effectiveCount}
          onChange={(e) => setCount(Number(e.target.value))}
          className="w-24 rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        />
      </section>

      {error && <p className="mb-3 text-sm text-wrong">{error}</p>}

      <button
        type="button"
        onClick={handleStart}
        disabled={createSession.isPending}
        className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
      >
        {createSession.isPending ? '준비 중…' : '퀴즈 시작'}
      </button>
    </div>
  )
}
