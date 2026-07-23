interface DDayBadgeProps {
  name: string
  dDay: number
}

export default function DDayBadge({ name, dDay }: DDayBadgeProps) {
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
    </div>
  )
}
