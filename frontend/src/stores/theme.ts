import { create } from 'zustand'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  )
}

function applyDomClass(mode: ThemeMode) {
  if (typeof document === 'undefined') return
  const isDark = mode === 'dark' || (mode === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', isDark)
}

function readInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: readInitialMode(),
  setMode: (mode) => {
    window.localStorage.setItem(STORAGE_KEY, mode)
    applyDomClass(mode)
    set({ mode })
  },
}))

// 초기 적용 (모듈 로드 시 1회)
applyDomClass(useThemeStore.getState().mode)

// system 모드일 때 OS 설정 변경 구독
if (typeof window !== 'undefined') {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    if (useThemeStore.getState().mode === 'system') {
      applyDomClass('system')
    }
  }
  media.addEventListener?.('change', handler)
}
