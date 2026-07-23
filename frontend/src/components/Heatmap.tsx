import { useMemo } from 'react'
import type { HeatmapEntry } from '../api/types'

interface HeatmapProps {
  entries: HeatmapEntry[]
  weeks?: number
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// 5단계 색은 tailwind.config.js의 heat1~5(토큰 --heat-1~5) 클래스만 사용한다 — 색상 하드코딩 금지.
function levelClass(level: number): string {
  switch (level) {
    case 0:
      return 'bg-heat1'
    case 1:
      return 'bg-heat2'
    case 2:
      return 'bg-heat3'
    case 3:
      return 'bg-heat4'
    default:
      return 'bg-heat5'
  }
}

// 설계 §5.1, 계획 체크리스트 — 학습 히트맵 12주(잔디). 오늘을 포함한 최근 N주를 일요일 시작 주 단위로 그린다.
export default function Heatmap({ entries, weeks = 12 }: HeatmapProps) {
  const { columns, max } = useMemo(() => {
    const countByDate = new Map(entries.map((e) => [e.date, e.count]))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // 이번 주 일요일까지 포함해 주 단위 격자를 맞춘다.
    const endOfWeek = new Date(today)
    endOfWeek.setDate(today.getDate() + (6 - today.getDay()))
    const totalDays = weeks * 7
    const start = new Date(endOfWeek)
    start.setDate(endOfWeek.getDate() - totalDays + 1)

    const days: { date: string; count: number; inFuture: boolean }[] = []
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const key = toDateKey(d)
      days.push({ date: key, count: countByDate.get(key) ?? 0, inFuture: d > today })
    }

    const cols: (typeof days)[] = []
    for (let w = 0; w < weeks; w++) {
      cols.push(days.slice(w * 7, w * 7 + 7))
    }
    const maxCount = Math.max(1, ...days.map((d) => d.count))
    return { columns: cols, max: maxCount }
  }, [entries, weeks])

  function bucket(count: number): number {
    if (count <= 0) return 0
    const ratio = count / max
    if (ratio > 0.75) return 4
    if (ratio > 0.5) return 3
    if (ratio > 0.25) return 2
    return 1
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1">
        <div className="flex flex-col gap-1 pt-4">
          {WEEKDAY_LABELS.map((label, i) => (
            <span
              key={label}
              className={`h-3 w-4 text-[9px] leading-3 text-muted ${i % 2 === 0 ? 'invisible' : ''}`}
            >
              {label}
            </span>
          ))}
        </div>
        {columns.map((col, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {col.map((day) => (
              <div
                key={day.date}
                title={`${day.date}: ${day.count}건`}
                className={`h-3 w-3 rounded-sm ${day.inFuture ? 'bg-transparent' : levelClass(bucket(day.count))}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
