import { useEffect } from 'react'
import { useSettings } from '../api/settings'
import { applyThemeCustomCss } from '../utils/themeCustomInject'

// 전역 테마 주입 (F53 ①, 설계 §4.26 ③ · screens §7) — App 최상단에서 1회 호출.
// 신규 zustand 스토어 없음(§7 명시) — 서버 settings:ui.theme_custom을 TanStack Query로 읽어
// <html> 수준 CSS 변수로 반영한다. 저장이 없으면(NULL/빈 값) 아무 변수도 건드리지 않는다.
export function useApplyThemeCustom() {
  const { data } = useSettings()
  useEffect(() => {
    applyThemeCustomCss(data?.['ui.theme_custom'] ?? null)
  }, [data])
}
