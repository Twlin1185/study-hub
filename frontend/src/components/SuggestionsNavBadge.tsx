import { NavLink } from 'react-router-dom'
import { useSuggestions } from '../api/suggestions'
import { useImproveProposals } from '../api/improve'

// 설계 §4.9·§4.22, §5 — 홈/탐색 "제안 N건" 배지 → 제안함. 여기서는 사이드바·모바일 헤더용 상시
// 진입점을 제공한다(0건이면 숨김이 아니라 배지 없이 아이콘만 — 언제든 규칙 관리 결과를 확인할
// 수 있도록 진입점 자체는 유지). S20(§4.22 ③): [분류 연결]·[반입 개선] 두 pending 수신함을
// 합산한다 — 제안함이 "화면" 층에서 일반화됐을 뿐 배지는 여전히 하나(결정 ①).
export default function SuggestionsNavBadge({ compact }: { compact?: boolean }) {
  const suggestionsQuery = useSuggestions()
  const improveProposalsQuery = useImproveProposals('pending')
  const count = (suggestionsQuery.data?.length ?? 0) + (improveProposalsQuery.data?.length ?? 0)

  if (compact) {
    return (
      <NavLink
        to="/suggestions"
        aria-label="제안함"
        className="relative rounded p-1.5 text-muted hover:bg-bg hover:text-primary"
      >
        📮
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-wrong px-1 text-[10px] font-semibold leading-none text-on-accent">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </NavLink>
    )
  }

  return (
    <NavLink
      to="/suggestions"
      className={({ isActive }) =>
        `flex items-center gap-2 rounded px-3 py-2 text-sm transition-colors ${
          isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-bg hover:text-primary'
        }`
      }
    >
      <span aria-hidden>📮</span>
      <span>제안함</span>
      {count > 0 && (
        <span className="ml-auto rounded-full bg-wrong px-1.5 py-0.5 text-[10px] font-semibold leading-none text-on-accent">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  )
}
