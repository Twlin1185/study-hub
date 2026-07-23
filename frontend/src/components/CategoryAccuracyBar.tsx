import { Bar } from 'react-chartjs-2'
import { useChartColors } from '../hooks/useChartColors'
import type { CategoryChildStat } from '../api/types'

interface CategoryAccuracyBarProps {
  items: CategoryChildStat[]
}

const LOW_THRESHOLD = 0.6

// 설계 §4.1 categories/{id}/stats — 과목별 정답률 바 차트. 시나리오 S3 "정답률 60% 미만 단원 집중":
// 임계값 미만은 wrong 토큰, 그 외는 accent 토큰으로 강조 (색상 하드코딩 금지).
export default function CategoryAccuracyBar({ items }: CategoryAccuracyBarProps) {
  const colors = useChartColors()
  const withAttempts = items.filter((it) => it.attempt_count > 0)

  if (withAttempts.length === 0) {
    return <p className="text-sm text-muted">아직 풀이 기록이 없습니다.</p>
  }

  return (
    <div className="h-56 rounded-lg border border-border bg-surface p-3">
      <Bar
        data={{
          labels: withAttempts.map((it) => it.name),
          datasets: [
            {
              label: '정답률',
              data: withAttempts.map((it) => Math.round((it.accuracy ?? 0) * 100)),
              backgroundColor: withAttempts.map((it) =>
                (it.accuracy ?? 0) < LOW_THRESHOLD ? colors.wrong : colors.accent,
              ),
              borderRadius: 4,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const item = withAttempts[ctx.dataIndex]
                  return `정답률 ${ctx.formattedValue}% (${item.attempt_count}회 시도)`
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: colors.textMuted, font: { size: 10 } } },
            y: {
              min: 0,
              max: 100,
              grid: { color: colors.border },
              ticks: { color: colors.textMuted, font: { size: 10 } },
            },
          },
        }}
      />
    </div>
  )
}
