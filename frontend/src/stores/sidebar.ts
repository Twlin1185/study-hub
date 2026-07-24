import { create } from 'zustand'

// 설계 §5 도입부(F33) — 데스크톱/태블릿 사이드바 접힘 상태.
// 기기별 UI 선호이므로 서버 settings가 아닌 localStorage(theme 관례, §6).
export type SidebarState = 'expanded' | 'collapsed'

const STORAGE_KEY = 'sidebar'

// 저장값이 없을 때 기본: 768~1023px(태블릿)=collapsed, ≥1024px(PC)=expanded.
// 모바일(<768px)은 사이드바 자체가 없으므로 값은 무의미 — expanded로 둔다.
function defaultForViewport(): SidebarState {
  if (typeof window === 'undefined') return 'expanded'
  const w = window.innerWidth
  return w >= 768 && w < 1024 ? 'collapsed' : 'expanded'
}

function readInitial(): SidebarState {
  if (typeof window === 'undefined') return 'expanded'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'expanded' || stored === 'collapsed') return stored
  return defaultForViewport()
}

interface SidebarStore {
  state: SidebarState
  toggle: () => void
  setState: (state: SidebarState) => void
}

export const useSidebarStore = create<SidebarStore>((set, get) => ({
  state: readInitial(),
  setState: (state) => {
    window.localStorage.setItem(STORAGE_KEY, state)
    set({ state })
  },
  toggle: () => get().setState(get().state === 'expanded' ? 'collapsed' : 'expanded'),
}))
