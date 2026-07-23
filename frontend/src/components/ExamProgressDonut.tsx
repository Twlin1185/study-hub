import { Doughnut } from 'react-chartjs-2'
import { useChartColors } from '../hooks/useChartColors'

interface ExamProgressDonutProps {
  name: string
  progress: number // 0~1
}

// 설계 §5.1 "시험별 진도 도넛". 색은 토큰(accent/border)만 사용 — 색상 하드코딩 금지.
export default function ExamProgressDonut({ name, progress }: ExamProgressDonutProps) {
  const colors = useChartColors()
  const pct = Math.max(0, Math.min(1, progress))

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-surface p-3">
      <div className="relative h-20 w-20">
        <Doughnut
          data={{
            labels: ['완료', '남음'],
            datasets: [
              {
                data: [pct, 1 - pct],
                backgroundColor: [colors.accent, colors.border],
                borderWidth: 0,
              },
            ],
          }}
          options={{
            cutout: '70%',
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: false,
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-primary">
          {Math.round(pct * 100)}%
        </div>
      </div>
      <p className="max-w-[6rem] truncate text-center text-xs text-muted" title={name}>
        {name}
      </p>
    </div>
  )
}
