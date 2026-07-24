import { useEffect, useRef, useState } from 'react'
import { useHeatmap } from '../../api/stats'
import Heatmap from '../Heatmap'

const MAX_WEEKS = 26
const MIN_WEEKS = 8
// Heatmap 셀 기하: w-3(12px) + gap-1(4px) = 16px/주, 요일 라벨 열(w-4 + gap) ≈ 20px.
const WEEK_PX = 16
const LABEL_PX = 20

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// 오늘 기준 최근 26주 범위(일요일 정렬) — 데이터는 최대 범위로 1회만 조회하고
// 표시 주 수는 클라이언트에서 슬라이스한다(리사이즈·열 변경 시 재요청 없음).
function maxRange(): { from: string; to: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + (6 - today.getDay()))
  const start = new Date(endOfWeek)
  start.setDate(endOfWeek.getDate() - MAX_WEEKS * 7 + 1)
  return { from: isoDate(start), to: isoDate(endOfWeek) }
}

// 홈 위젯: 학습 히트맵 (설계 §5.1, S7 반응형 주 수).
// 위젯 컨테이너 폭(ResizeObserver) 기준으로 표시 주 수를 8~26주로 유동 조정한다.
export default function HeatmapWidget() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [weeks, setWeeks] = useState(12)
  const range = useRef(maxRange()).current
  const heatmapQuery = useHeatmap(range.from, range.to)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const recompute = (width: number) => {
      const usable = width - LABEL_PX
      const n = Math.floor(usable / WEEK_PX)
      setWeeks(Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Number.isFinite(n) ? n : 12)))
    }
    recompute(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) recompute(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-primary">학습 히트맵 (최근 {weeks}주)</h2>
      <div ref={containerRef}>
        {heatmapQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
        {heatmapQuery.isError && <p className="text-sm text-wrong">히트맵을 불러오지 못했습니다.</p>}
        {heatmapQuery.data && <Heatmap entries={heatmapQuery.data} weeks={weeks} />}
      </div>
    </section>
  )
}
