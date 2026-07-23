import { useEffect, useState } from 'react'
import { useThemeStore } from '../stores/theme'

export interface ChartColors {
  accent: string
  accentSoft: string
  correct: string
  wrong: string
  warning: string
  border: string
  textMuted: string
  text: string
  surface: string
  heat: string[]
}

function readColors(): ChartColors {
  // Canvas는 CSS 커스텀 프로퍼티(var(...))를 직접 받지 못하므로 계산된 값을 읽어 전달한다.
  // 다크 모드 전환 시(<html class="dark"> 토글) 재계산해야 차트 색이 토큰을 따라간다 (규칙 #1).
  const style = getComputedStyle(document.documentElement)
  const get = (name: string) => style.getPropertyValue(name).trim()
  return {
    accent: get('--accent'),
    accentSoft: get('--accent-soft'),
    correct: get('--correct'),
    wrong: get('--wrong'),
    warning: get('--warning'),
    border: get('--border'),
    textMuted: get('--text-muted'),
    text: get('--text'),
    surface: get('--surface'),
    heat: [get('--heat-1'), get('--heat-2'), get('--heat-3'), get('--heat-4'), get('--heat-5')],
  }
}

// 차트(Chart.js)용 토큰 색상 — 테마 전환(수동/시스템) 시 재계산해 다크 모드에서도
// 색상 하드코딩 없이 토큰을 따라가게 한다 (계획 체크리스트 "다크 모드에서 차트 색상 토큰 연동 확인").
export function useChartColors(): ChartColors {
  const mode = useThemeStore((s) => s.mode)
  const [colors, setColors] = useState<ChartColors>(() =>
    typeof document !== 'undefined' ? readColors() : ({} as ChartColors),
  )

  useEffect(() => {
    setColors(readColors())
  }, [mode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setColors(readColors())
    media.addEventListener?.('change', handler)
    return () => media.removeEventListener?.('change', handler)
  }, [])

  return colors
}
