interface MiniHistoryChartProps {
  recent: boolean[] // 오래된 → 최신
}

// 설계 §5.3 풀이 이력 미니차트 (최근 10회 ○/×). 색은 토큰(--correct/--wrong)만 사용.
export default function MiniHistoryChart({ recent }: MiniHistoryChartProps) {
  if (!recent || recent.length === 0) {
    return <p className="text-sm text-muted">풀이 이력이 없습니다.</p>
  }

  return (
    <div className="flex items-center gap-1">
      {recent.map((correct, i) => (
        <span
          key={i}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            correct ? 'bg-correct/15 text-correct' : 'bg-wrong/15 text-wrong'
          }`}
          title={correct ? '정답' : '오답'}
        >
          {correct ? '○' : '✕'}
        </span>
      ))}
    </div>
  )
}
