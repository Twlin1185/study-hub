import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import SearchBar from './SearchBar'
import SuggestionsNavBadge from './SuggestionsNavBadge'
import { useSidebarStore } from '../stores/sidebar'

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

function NavButton({ item, compact, collapsed }: { item: NavItem; compact?: boolean; collapsed?: boolean }) {
  if (item.disabled) {
    return (
      <span
        className={`flex select-none items-center gap-0.5 rounded text-muted opacity-40 ${
          compact
            ? 'flex-1 flex-col justify-center px-2 py-1.5 text-[11px]'
            : collapsed
              ? 'justify-center px-2 py-2 text-sm'
              : 'flex-row justify-start gap-2 px-3 py-1.5 text-sm'
        }`}
        aria-disabled="true"
        title={collapsed ? `${item.label} (아직 구현되지 않았습니다)` : '아직 구현되지 않았습니다'}
      >
        <span aria-hidden>{item.icon}</span>
        {!collapsed && <span>{item.label}</span>}
      </span>
    )
  }
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `flex items-center rounded transition-colors ${
          compact
            ? 'flex-1 flex-col justify-center gap-0.5 px-2 py-1.5 text-[11px]'
            : collapsed
              ? 'justify-center px-2 py-2 text-sm'
              : 'flex-row justify-start gap-2 px-3 py-2 text-sm'
        } ${isActive ? 'text-accent bg-accent-soft' : 'text-muted hover:bg-bg hover:text-primary'}`
      }
    >
      <span aria-hidden>{item.icon}</span>
      {!compact && !collapsed && <span>{item.label}</span>}
    </NavLink>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const sidebar = useSidebarStore((s) => s.state)
  const toggleSidebar = useSidebarStore((s) => s.toggle)
  const setSidebar = useSidebarStore((s) => s.setState)
  const collapsed = sidebar === 'collapsed'

  return (
    <div className="flex h-full min-h-screen bg-bg text-primary">
      {/* 데스크톱/태블릿 사이드바 (F33: 접힘 토글) */}
      <aside
        className={`hidden shrink-0 flex-col border-r border-border bg-surface p-3 md:flex print:hidden ${
          collapsed ? 'w-16' : 'w-48'
        }`}
      >
        <div className={`mb-3 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-2'}`}>
          {!collapsed && <h1 className="text-base font-semibold text-primary">Study Hub</h1>}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            title={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            className="rounded p-1 text-muted hover:bg-bg hover:text-primary"
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>

        {collapsed ? (
          <button
            type="button"
            onClick={() => setSidebar('expanded')}
            aria-label="검색"
            title="검색"
            className="mb-3 flex justify-center rounded px-2 py-2 text-muted hover:bg-bg hover:text-primary"
          >
            🔍
          </button>
        ) : (
          <div className="px-2">
            <SearchBar variant="sidebar" />
          </div>
        )}

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavButton key={item.to} item={item} collapsed={collapsed} />
          ))}
          {DESKTOP_EXTRA_ITEMS.map((item) => (
            <NavButton key={item.to} item={item} collapsed={collapsed} />
          ))}
          <SuggestionsNavBadge compact={collapsed} />
        </nav>
        <div className="mt-auto">
          <NavButton item={{ to: '/settings', label: '설정', icon: '⚙️' }} collapsed={collapsed} />
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
