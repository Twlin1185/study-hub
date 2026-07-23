interface ProgressBarProps {
  value: number // 0~1
  label?: string
}

export default function ProgressBar({ value, label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-border">
        <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
      {label && <span className="shrink-0 text-xs text-muted">{label}</span>}
    </div>
  )
}
