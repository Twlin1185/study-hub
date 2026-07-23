import { Link } from 'react-router-dom'
import { useDashboard } from '../api/dashboard'
import { ApiError } from '../api/client'
import ProgressBar from '../components/ProgressBar'
import DDayBadge from '../components/DDayBadge'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

export default function HomePage() {
  const dashboardQuery = useDashboard()

  if (dashboardQuery.isLoading) {
    return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  }
  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <p className="p-4 text-sm text-wrong">
        {errMsg(dashboardQuery.error, '대시보드를 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.')}
      </p>
    )
  }

  const data = dashboardQuery.data
  const hasNoData = data.continue.length === 0 && data.ddays.length === 0 && data.recent.attempts_7d === 0

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-xl font-semibold text-primary">홈</h1>

      {hasNoData && (
        <div className="mb-5 flex flex-col items-start gap-2 rounded-lg border border-border bg-surface p-5">
          <p className="text-sm font-medium text-primary">아직 학습 데이터가 없습니다.</p>
          <p className="text-sm text-muted">기출 JSON을 반입해 시작하세요.</p>
          <Link
            to="/import"
            className="mt-1 rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            반입하러 가기          </Link>
        </div>
      )}

      {data.continue.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-primary">이어하기</h2>
          <div className="flex flex-col gap-2">
            {data.continue.slice(0, 3).map((card) => (
              <div key={card.category_id} className="rounded-lg border border-border bg-surface p-3">
                <p className="mb-1 truncate text-sm text-primary" title={card.path}>
                  {card.path}
                </p>
                <div className="mb-2">
                  <ProgressBar
                    value={card.total > 0 ? card.done / card.total : 0}
                    label={`${card.done}/${card.total}`}
                  />
                </div>
                <Link
                  to={`/study/${card.category_id}`}
                  className="inline-block rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
                >
                  이어하기
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.today_review > 0 && (
        <section className="mb-5">
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 opacity-60">
            <span className="text-sm text-primary">오늘의 복습 {data.today_review}개</span>
            <span className="text-xs text-muted" title="플래시카드/복습 큐는 S5에서 연결됩니다">
              준비 중
            </span>
          </div>
        </section>
      )}

      {data.ddays.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-primary">D-Day</h2>
          <div className="flex flex-col gap-2">
            {data.ddays.map((d) => (
              <DDayBadge key={d.category_id} name={d.name} dDay={d.d_day} />
            ))}
          </div>
        </section>
      )}

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
    </div>
  )
}
