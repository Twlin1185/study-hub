import { Link } from 'react-router-dom'
import { useDashboard } from '../api/dashboard'
import { useCategoryTree } from '../api/categories'
import { useAccuracyTrend, useHeatmap, useWeakness } from '../api/stats'
import { ApiError } from '../api/client'
import ProgressBar from '../components/ProgressBar'
import DDayBadge from '../components/DDayBadge'
import Heatmap from '../components/Heatmap'
import ExamProgressDonut from '../components/ExamProgressDonut'
import WeaknessWidget from '../components/WeaknessWidget'
import TrendLineChart from '../components/TrendLineChart'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

const WEEKS = 12

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// "YYYY-MM-DD" → "M/D" (차트 x축 라벨용)
function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-')
  return `${Number(month)}/${Number(day)}`
}

// 히트맵 범위(12주) 시작일 계산 — 이번 주 일요일부터 역산해 컴포넌트와 동일 기준을 맞춘다.
function heatmapRange(): { from: string; to: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + (6 - today.getDay()))
  const start = new Date(endOfWeek)
  start.setDate(endOfWeek.getDate() - WEEKS * 7 + 1)
  return { from: isoDate(start), to: isoDate(endOfWeek) }
}

export default function HomePage() {
  const dashboardQuery = useDashboard()
  const treeQuery = useCategoryTree()
  const range = heatmapRange()
  const heatmapQuery = useHeatmap(range.from, range.to)
  const weaknessQuery = useWeakness(null, 10)
  const accuracyTrendQuery = useAccuracyTrend(30)

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
      )}

      {data.ddays.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-primary">D-Day</h2>
          <div className="flex flex-col gap-2">
            {data.ddays.map((d) => (
              <DDayBadge key={`${d.kind}-${d.category_id ?? d.id}`} name={d.name} dDay={d.d_day} kind={d.kind} />
            ))}
          </div>
        </section>
      )}

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-primary">학습 히트맵 (최근 12주)</h2>
        {heatmapQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
        {heatmapQuery.isError && <p className="text-sm text-wrong">히트맵을 불러오지 못했습니다.</p>}
        {heatmapQuery.data && <Heatmap entries={heatmapQuery.data} weeks={WEEKS} />}
      </section>

      {treeQuery.data && treeQuery.data.some((n) => n.progress != null) && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-primary">시험별 진도</h2>
          <div className="flex flex-wrap gap-3">
            {treeQuery.data
              .filter((n) => n.progress != null)
              .map((n) => (
                <ExamProgressDonut key={n.id} name={n.name} progress={n.progress ?? 0} />
              ))}
          </div>
        </section>
      )}

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-primary">최근 7일</h2>
        <div className="mb-3 flex gap-3">
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

      {/* 데이터 없으면 위젯을 아예 표시하지 않는다 — 다른 홈 위젯(시험별 진도 등)과 동일한 관례. */}
      {accuracyTrendQuery.data && accuracyTrendQuery.data.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-primary">최근 정답률 추이</h2>
          <TrendLineChart
            labels={accuracyTrendQuery.data.map((e) => formatShortDate(e.date))}
            values={accuracyTrendQuery.data.map((e) => Math.round(e.accuracy * 100))}
            suffix="%"
            yMin={0}
            yMax={100}
          />
        </section>
      )}

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-primary">자꾸 틀리는 개념 Top 10</h2>
        {weaknessQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
        {weaknessQuery.isError && <p className="text-sm text-wrong">약점 데이터를 불러오지 못했습니다.</p>}
        {weaknessQuery.data && <WeaknessWidget items={weaknessQuery.data} />}
      </section>

      <section>
        <Link
          to="/explore?bookmarked=1"
          className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-sm text-primary hover:bg-bg"
        >
          <span>★ 북마크 모아보기</span>
          <span className="text-muted">›</span>
        </Link>
      </section>
    </div>
  )
}
