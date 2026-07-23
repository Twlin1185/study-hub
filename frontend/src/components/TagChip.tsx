interface TagChipProps {
  label: string
  onClick?: () => void
  onRemove?: () => void
  active?: boolean
}

export default function TagChip({ label, onClick, onRemove, active }: TagChipProps) {
  const clickable = Boolean(onClick)
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-accent text-on-accent'
          : 'bg-accent-soft text-accent'
      } ${clickable ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      #{label}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`${label} 태그 제거`}
          className="ml-0.5 leading-none opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      )}
    </span>
  )
}
