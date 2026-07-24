import { useAccuracyTrend } from '../../api/stats'
import TrendLineChart from '../TrendLineChart'

// "YYYY-MM-DD" → "M/D" (차트 x축 라벨용)
function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-')
  return `${Number(month)}/${Number(day)}`
}

// 홈 위젯: 최근 정답률 추이 (설계 §5.1). 풀이가 있던 날 데이터가 없으면 표시하지 않는다.
export default function AccuracyTrendWidget() {
  const { data } = useAccuracyTrend(30)
  if (!data || data.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-primary">최근 정답률 추이</h2>
      <TrendLineChart
        labels={data.map((e) => formatShortDate(e.date))}
        values={data.map((e) => Math.round(e.accuracy * 100))}
        suffix="%"
        yMin={0}
        yMax={100}
      />
    </section>
  )
}
