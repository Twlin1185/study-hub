import type { DDayKind } from '../api/types'

interface DDayBadgeProps {
  name: string
  dDay: number
  kind?: DDayKind
}

// 설계 §4.8/§5.11 — 시험 분류 D-Day와 임의 D-Day를 병합해 배지로 표시하되 종류를 구분한다.
export default function DDayBadge({ name, dDay, kind }: DDayBadgeProps) {
  const label = dDay === 0 ? 'D-Day' : dDay > 0 ? `D-${dDay}` : `D+${Math.abs(dDay)}`
  const urgent = dDay >= 0 && dDay <= 7

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        urgent ? 'border-warning bg-accent-soft' : 'border-border bg-surface'
      }`}
    >
      <span className={`font-semibold ${urgent ? 'text-warning' : 'text-accent'}`}>{label}</span>
      <span className="truncate text-primary">{name}</span>
      {kind && (
        <span className="ml-auto shrink-0 rounded-full bg-bg px-1.5 py-0.5 text-[10px] text-muted">
          {kind === 'category' ? '시험' : '일정'}
        </span>
      )}
    </div>
  )
}
