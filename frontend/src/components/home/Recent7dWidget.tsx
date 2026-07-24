import { useDashboard } from '../../api/dashboard'

// 홈 위젯: 최근 7일 풀이/정답률 (설계 §5.1).
export default function Recent7dWidget() {
  const { data } = useDashboard()
  if (!data) return null

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-primary">최근 7일</h2>
      <div className="flex gap-3">
        <div className="flex-1 rounded-lg border border-border bg-surface p-3 text-center">
          <p className="text-lg font-semibold text-primary">{data.recent.attempts_7d}</p>
          <p className="text-xs text-muted">풀이 수</p>
        </div>
        <div className="flex-1 rounded-lg border border-border bg-surface p-3 text-center">
          <p className="text-lg font-semibold text-primary">
            {data.recent.accuracy_7d != null ? `${Math.round(data.recent.accuracy_7d * 100)}%` : '-'}
          </p>
          <p className="text-xs text-muted">정답률</p>
        </div>
      </div>
    </section>
  )
}
