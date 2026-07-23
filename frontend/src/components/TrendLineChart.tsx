import { Line } from 'react-chartjs-2'
import { useChartColors } from '../hooks/useChartColors'

interface TrendLineChartProps {
  labels: string[]
  values: number[]
  suffix?: string
  yMin?: number
  yMax?: number
}

// 재사용 가능한 라인 차트 — 토큰 색만 사용(색상 하드코딩 금지). 데이터 의미는 호출부가 결정
// (홈에서는 §4.8 stats/accuracy-trend의 일자별 정답률 표시에 사용).
export default function TrendLineChart({ labels, values, suffix = '', yMin, yMax }: TrendLineChartProps) {
  const colors = useChartColors()

  return (
    <div className="h-40 rounded-lg border border-border bg-surface p-3">
      <Line
        data={{
          labels,
          datasets: [
            {
              data: values,
              borderColor: colors.accent,
              backgroundColor: colors.accentSoft,
              pointBackgroundColor: colors.accent,
              tension: 0.3,
              fill: true,
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
                label: (ctx) => `${ctx.formattedValue}${suffix}`,
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: colors.textMuted, font: { size: 10 } } },
            y: {
              grid: { color: colors.border },
              ticks: { color: colors.textMuted, font: { size: 10 } },
              beginAtZero: yMin == null,
              min: yMin,
              max: yMax,
            },
          },
        }}
      />
    </div>
  )
}
