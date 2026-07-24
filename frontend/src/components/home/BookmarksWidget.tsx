import { Link } from 'react-router-dom'

// 홈 위젯: 북마크 모아보기 진입 (설계 §5.1).
export default function BookmarksWidget() {
  return (
    <section>
      <Link
        to="/explore?bookmarked=1"
        className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-sm text-primary hover:bg-bg"
      >
        <span>★ 북마크 모아보기</span>
        <span className="text-muted">›</span>
      </Link>
    </section>
  )
}
