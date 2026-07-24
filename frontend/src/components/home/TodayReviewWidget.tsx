import { Link } from 'react-router-dom'
import { useDashboard } from '../../api/dashboard'

// 홈 위젯: 오늘의 복습 (설계 §5.1). 복습 대상 0건이면 표시하지 않는다.
export default function TodayReviewWidget() {
  const { data } = useDashboard()
  if (!data || data.today_review <= 0) return null

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3">
        <span className="text-sm text-primary">오늘의 복습 {data.today_review}개</span>
        <div className="flex gap-2">
          <Link
            to="/flashcards"
            className="rounded border border-border px-3 py-1.5 text-sm font-medium text-primary hover:bg-bg"
          >
            플래시카드
          </Link>
          <Link
            to="/review"
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            복습 시작
          </Link>
        </div>
      </div>
    </section>
  )
}
