import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import SearchBar from './SearchBar'
import SuggestionsNavBadge from './SuggestionsNavBadge'

interface NavItem {
  to: string
  label: string
  icon: string
  disabled?: boolean
  end?: boolean
}

// 모바일 하단 탭바 구성 (설계 §5 도입부: 홈/커리큘럼/퀴즈/오답노트) — S3에서 확정.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '홈', icon: '🏠', end: true },
  { to: '/curriculum', label: '커리큘럼', icon: '📚' },
  { to: '/quiz', label: '퀴즈', icon: '📝' },
  { to: '/review-notes', label: '오답노트', icon: '📌' },
]

// 데스크톱 사이드바 전용 추가 항목 — 탐색/반입은 모바일 하단 탭바에 없음(설계 §5 도입부),
// 데스크톱에서는 계속 접근 가능해야 하므로 여기 유지.
const DESKTOP_EXTRA_ITEMS: NavItem[] = [
  { to: '/explore', label: '탐색', icon: '🗂️' },
  { to: '/import', label: '반입', icon: '📥' },
  { to: '/print', label: '인쇄', icon: '🖨️' },
]

function NavButton({ item, compact }: { item: NavItem; compact?: boolean }) {
  if (item.disabled) {
    return (
      <span
        className={`flex select-none flex-col items-center justify-center gap-0.5 rounded px-2 py-1.5 text-muted opacity-40 ${
          compact ? 'flex-1 text-[11px]' : 'flex-row justify-start gap-2 px-3 text-sm'
        }`}
        aria-disabled="true"
        title="아직 구현되지 않았습니다"
      >
        <span aria-hidden>{item.icon}</span>
        <span>{item.label}</span>
      </span>
    )
  }
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-0.5 rounded px-2 py-1.5 transition-colors ${
          compact ? 'flex-1 text-[11px]' : 'flex-row justify-start gap-2 px-3 py-2 text-sm'
        } ${isActive ? 'text-accent bg-accent-soft' : 'text-muted hover:bg-bg hover:text-primary'}`
      }
    >
      <span aria-hidden>{item.icon}</span>
      <span>{item.label}</span>
    </NavLink>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-screen bg-bg text-primary">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden w-48 shrink-0 flex-col border-r border-border bg-surface p-3 md:flex print:hidden">
        <h1 className="mb-3 px-2 text-base font-semibold text-primary">Study Hub</h1>
        <div className="px-2">
          <SearchBar variant="sidebar" />
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavButton key={item.to} item={item} />
          ))}
          {DESKTOP_EXTRA_ITEMS.map((item) => (
            <NavButton key={item.to} item={item} />
          ))}
          <SuggestionsNavBadge />
        </nav>
        <div className="mt-auto">
          <NavButton item={{ to: '/settings', label: '설정', icon: '⚙️' }} />
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        {/* 모바일 상단 헤더 */}
        <header className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3 md:hidden print:hidden">
          <h1 className="text-base font-semibold text-primary">Study Hub</h1>
          <div className="flex flex-1 items-center justify-end gap-1">
            <SearchBar variant="mobile" />
            <SuggestionsNavBadge compact />
            <NavLink
              to="/settings"
              className="rounded p-1.5 text-muted hover:bg-bg hover:text-primary"
              aria-label="설정"
            >
              ⚙️
            </NavLink>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-16 md:pb-0 print:overflow-visible print:pb-0">{children}</main>

        {/* 모바일 하단 탭바 */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface md:hidden print:hidden">
          {NAV_ITEMS.map((item) => (
            <NavButton key={item.to} item={item} compact />
          ))}
        </nav>
      </div>
    </div>
  )
}
