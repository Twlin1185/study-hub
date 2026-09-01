import { useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import SearchBar from './SearchBar'
import SuggestionsNavBadge from './SuggestionsNavBadge'
import JobCenterButton from './JobCenterButton'
import JobCenterPanel from './JobCenterPanel'
import { useSidebarStore } from '../stores/sidebar'
import { useAppUpdate } from '../hooks/useAppUpdate'

interface NavItem {
  to: string
  label: string
  icon: string
  disabled?: boolean
  end?: boolean
}

// 모바일 하단 탭바 구성 (설계 §5 도입부) — S9(F36-②)에서 "복습" 탭 추가로 5탭.
// 복습 탭은 홈 경유 없이 /review로 직행한다.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '홈', icon: '🏠', end: true },
  { to: '/curriculum', label: '커리큘럼', icon: '📚' },
  { to: '/quiz', label: '퀴즈', icon: '📝' },
  { to: '/review', label: '복습', icon: '🔁' },
  { to: '/review-notes', label: '오답노트', icon: '📌' },
]

// 데스크톱 사이드바 전용 추가 항목 — 탐색/반입은 모바일 하단 탭바에 없음(설계 §5 도입부),
// 데스크톱에서는 계속 접근 가능해야 하므로 여기 유지.
const DESKTOP_EXTRA_ITEMS: NavItem[] = [
  { to: '/explore', label: '탐색', icon: '🗂️' },
  { to: '/import', label: '반입', icon: '📥' },
  { to: '/print', label: '인쇄', icon: '🖨️' },
]

// 노트 진입점(stage-43 G-1 — 규약 B 정식 승격). 데스크톱 사이드바 1항목 + 모바일 좌측 드로어
// 1항목(아래 drawer JSX) — 하단 탭바 5개는 불변(F39 관례). `/notes` 라우트 자체는 App.tsx에서
// 여전히 lazy 청크(R37) — 여기 링크 추가는 라우트 진입 지점을 늘릴 뿐 초기 청크에 영향 없다.
const NOTES_NAV_ITEM: NavItem = { to: '/notes', label: '노트', icon: '📓' }

function NavButton({
  item,
  compact,
  collapsed,
  onClick,
}: {
  item: NavItem
  compact?: boolean
  collapsed?: boolean
  onClick?: () => void
}) {
  if (item.disabled) {
    return (
      <span
        className={`flex select-none items-center gap-0.5 rounded text-muted opacity-40 ${
          compact
            ? 'min-h-[48px] flex-1 flex-col justify-center px-2 py-1.5 text-[11px]'
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
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `flex items-center rounded transition-colors ${
          compact
            ? 'min-h-[48px] flex-1 flex-col justify-center gap-0.5 px-2 py-1.5 text-[11px]'
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
  // 새 빌드 감지(설계 §4.16) — 보통은 자동 새로고침으로 해결되고, 그래도 남으면 배너로 알린다.
  const { updateAvailable } = useAppUpdate()
  // LLM 작업 센터(S22, F48, 설계 §4.24·§5.14) — 라우트가 아닌 전역 패널. 모바일은 하단 탭바를
  // 그대로 두고(F39 "탭 추가 금지" 관례) 좌측 드로어에서 진입한다(§5 공통 레이아웃).
  const [jobCenterOpen, setJobCenterOpen] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

  return (
    <div className="flex h-full min-h-screen bg-bg text-primary">
      {updateAvailable && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b border-warning bg-accent-soft px-3 py-2 text-sm text-primary print:hidden">
          <span>새 버전이 준비되어 있습니다.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-border bg-surface px-3 py-1 text-xs text-primary hover:bg-bg"
          >
            새로고침
          </button>
        </div>
      )}
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
          {/* stage-43 G-1(규약 B) — 노트 정식 승격, 사이드바 1항목. */}
          <NavButton item={NOTES_NAV_ITEM} collapsed={collapsed} />
          <SuggestionsNavBadge compact={collapsed} />
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <NavButton item={{ to: '/settings', label: '설정', icon: '⚙️' }} collapsed={collapsed} />
          {/* LLM 작업 센터 진입점(S22, F48, 설계 §5·§4.24 ⑥) — 도움말 항목 위(F39 배치 관례).
              라우트 이동이 아닌 전역 패널이라 NavButton(NavLink)이 아닌 버튼. */}
          <JobCenterButton onClick={() => setJobCenterOpen(true)} compact={collapsed} />
          {/* 도움말 진입점(S12, F39, 설계 §5·§4.15) — 앱 라우트가 아닌 외부 문서 링크이므로
              NavLink가 아닌 일반 <a target="_blank">로 새 탭에 연다. 접힘 레일은 아이콘+title. */}
          <a
            href="/manual"
            target="_blank"
            rel="noopener"
            title={collapsed ? '도움말' : undefined}
            className={`flex items-center rounded text-sm text-muted transition-colors hover:bg-bg hover:text-primary ${
              collapsed ? 'justify-center px-2 py-2' : 'flex-row justify-start gap-2 px-3 py-2'
            }`}
          >
            <span aria-hidden>❓</span>
            {!collapsed && <span>도움말</span>}
          </a>
        </div>
      </aside>

      {/* 본문 컬럼 = 위 가로 flex(90행)의 아이템이다. `min-w-0`이 없으면 `min-width: auto`(=min-content)라
          **넓은 자식의 고유 폭이 셸까지 밀려 올라가** 헤더·하단 탭바까지 화면 밖으로 밀린다
          (stage-38 F-2 R1 실측: 표 있는 노트에서 documentElement.scrollWidth 527 vs client 373 →
          이 한 줄로 388). 편집 표면 안쪽 봉인은 `editor2/blocknote/notes.css`가 이미 하지만,
          **전파를 끊는 마지막 마디는 여기**라 셸에서 한 번 더 끊는다.
          데스크톱 영향: flex 아이템의 축소 하한만 푸는 것이라 통상 화면(자식이 컬럼보다 좁음)에는
          변화가 없고, 넓은 자식은 종전처럼 자기 상자에서 넘칠 뿐 **셸 골격을 늘리지 않는다**. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* 모바일 상단 헤더 */}
        {/* pt-[calc(...)]가 py-3의 상단만 override — PWA standalone 설치 시 상태바와 겹치지 않도록
            viewport-fit=cover(index.html)의 safe-area를 더한다. 브라우저 탭 사용 시 env()=0이라 무변. */}
        <header className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:hidden print:hidden">
          <div className="flex items-center gap-1.5">
            {/* 좌측 드로어 진입점(S22, F48, 설계 §5·§4.24 ⑥) — 모바일은 사이드바가 없으므로
                여기서 연다. 하단 탭바 5개는 그대로 유지(F39 "탭 추가 금지" 관례). */}
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="메뉴"
              className="rounded p-1.5 text-muted hover:bg-bg hover:text-primary"
            >
              ☰
            </button>
            <h1 className="text-base font-semibold text-primary">Study Hub</h1>
          </div>
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

        <main className="flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 print:overflow-visible print:pb-0">{children}</main>

        {/* 모바일 하단 탭바 — viewport-fit=cover(index.html) 하에서 제스처 바 기종은 탭바가
            홈 인디케이터와 겹쳐 하단 잘림·터치 미스가 났다(v2.00.0 실기기 피드백). env()로
            탭바 자체를 인디케이터 위로 올린다 — 비대상 기종·데스크톱은 env()=0이라 무변. */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
          {NAV_ITEMS.map((item) => (
            <NavButton key={item.to} item={item} compact />
          ))}
        </nav>
      </div>

      {/* 좌측 드로어(모바일 전용) — "노트"(stage-43 G-1 정식 승격) · "LLM 작업" 진입점 2개를
          담는다(하단 탭바 불변 — §5 공통 레이아웃, F39 관례. FB-8 전면 확장은 이번 범위 아님 —
          '노트' 1항목 추가만). 향후 다른 항목이 필요해지면 이 자리에 늘린다. */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-black/40 md:hidden print:hidden"
          onClick={() => setMobileDrawerOpen(false)}
          role="presentation"
        >
          <div
            className="flex h-full w-64 max-w-[80vw] flex-col gap-1 border-r border-border bg-surface p-3"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="메뉴"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-primary">메뉴</h2>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                aria-label="닫기"
                className="rounded p-1 text-muted hover:bg-bg hover:text-primary"
              >
                ✕
              </button>
            </div>
            {/* stage-43 G-1(규약 B) — 노트 정식 승격, 드로어 1항목. 드로어 크기(비 collapsed)라
                사이드바와 같은 행 레이아웃(text 라벨 포함)이 그대로 맞는다. */}
            <NavButton item={NOTES_NAV_ITEM} onClick={() => setMobileDrawerOpen(false)} />
            <JobCenterButton
              onClick={() => {
                setMobileDrawerOpen(false)
                setJobCenterOpen(true)
              }}
            />
          </div>
        </div>
      )}

      <JobCenterPanel open={jobCenterOpen} onClose={() => setJobCenterOpen(false)} />
    </div>
  )
}
