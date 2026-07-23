import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WeaknessItem } from '../api/types'
import { useCreateQuizSession } from '../api/quiz'
import { useQuizSessionStore } from '../stores/quizSession'
import { ApiError } from '../api/client'

interface WeaknessWidgetProps {
  items: WeaknessItem[]
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §5.1, 계획 체크리스트 — "자꾸 틀리는 개념 Top 10". 클릭=문서 상세, [재도전]=해당 문서만 미니 퀴즈.
// 특정 문서를 지목하는 재도전은 sequential + document_ids(설계 §5.8) — wrong_only는 미해결
// 오답노트 조인이라 오답노트가 없는 문서(약점 위젯의 근거는 attempts 누적 정답률)는 0문항이 된다.
export default function WeaknessWidget({ items }: WeaknessWidgetProps) {
  const navigate = useNavigate()
  const start = useQuizSessionStore((s) => s.start)
  const createSession = useCreateQuizSession()
  const [error, setError] = useState<string | null>(null)

  if (items.length === 0) {
    return <p className="text-sm text-muted">아직 약점으로 분류할 만큼 풀이 기록이 쌓이지 않았습니다.</p>
  }

  function retry(documentId: number) {
    setError(null)
    createSession.mutate(
      { mode: 'sequential', count: 1, document_ids: [documentId] },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) {
            setError('재도전할 문제를 찾지 못했습니다.')
            return
          }
          start(data.items, 'sequential', null)
          navigate('/quiz/run')
        },
        onError: (e) => setError(errMsg(e, '재도전을 시작하지 못했습니다.')),
      },
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && <p className="text-xs text-wrong">{error}</p>}
      {items.map((item, i) => (
        <div
          key={item.document_id}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
        >
          <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted">{i + 1}</span>
          <button
            type="button"
            onClick={() => navigate(`/docs/${item.document_id}`)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-sm text-primary" title={item.title}>
              {item.title}
            </p>
            <p className="truncate text-xs text-muted">
              {item.category_path ?? '미분류'} · 정답률 {Math.round(item.accuracy * 100)}% ({item.attempts}회)
            </p>
          </button>
          <button
            type="button"
            onClick={() => retry(item.document_id)}
            disabled={createSession.isPending}
            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg disabled:opacity-50"
          >
            재도전
          </button>
        </div>
      ))}
    </div>
  )
}
