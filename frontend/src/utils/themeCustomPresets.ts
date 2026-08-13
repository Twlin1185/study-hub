// 전역 테마 커스텀 프리셋·팔레트 (F53 ①, 설계 §4.26 ③ · screens §5.11 S28 · 백엔드
// settings_service.py 대조 완료 2026-08-13) — "프리셋 몇 종(세피아·고대비 등) + 커스텀"의 구체
// 목록은 구현 재량. 글자색·강조색은 **F52 팔레트 7색 이름 재사용**(자유 hex 금지 — 서버가
// THEME_PALETTE_NAMES로 검증), 배경·서피스만 자유 hex + 서버 대비 검증.
import { PALETTE_COLORS, PALETTE_LABEL } from '../components/markdown/palette'
import type { PaletteColor } from '../components/markdown/palette'
import type { PaletteColorName, ThemeCustom, ThemeCustomPalette } from '../api/types'

export type ThemeTab = 'light' | 'dark'

// 글자색·강조색 선택지 — 팔레트 7색 그대로(라이트·다크 공용, 이름은 같고 값만 --ink-*가 테마별로
// 다르다). 자유 입력 UI 없음(§4.26 ① 결정 연장).
export const THEME_PALETTE_OPTIONS: PaletteColorName[] = [...PALETTE_COLORS]
export const THEME_PALETTE_LABEL: Record<PaletteColorName, string> = PALETTE_LABEL

// 대비 계산·미리보기 렌더용 ink hex 사본 — 단일 출처는 styles/tokens.css --ink-*(백엔드
// settings_service._INK_HEX와 값 동일, 서버 대비 검증과 결과가 어긋나지 않도록 동기 유지).
export const INK_HEX: Record<ThemeTab, Record<PaletteColor, string>> = {
  light: {
    red: '#b91c1c',
    orange: '#c2410c',
    yellow: '#a16207',
    green: '#15803d',
    blue: '#1d4ed8',
    purple: '#7e22ce',
    gray: '#4b5563',
  },
  dark: {
    red: '#f87171',
    orange: '#fb923c',
    yellow: '#fbbf24',
    green: '#4ade80',
    blue: '#60a5fa',
    purple: '#c084fc',
    gray: '#9ca3af',
  },
}

export interface ColorSwatch {
  label: string
  value: string
}

export interface ThemePreset {
  id: string
  label: string
  light: ThemeCustomPalette
  dark: ThemeCustomPalette
}

// "프리셋도 저장 형태는 같은 키의 값" (§4.26 ③) — 선택 시 ui.theme_custom에 그대로 저장된다.
// text는 팔레트 7색 중 가장 가까운 이름만 쓸 수 있어(자유 hex 금지) 순수 흑백 대비를 원하면
// 비워 둔다(기본 토큰 --text가 이미 거의 검정/흰색이라 그쪽이 더 고대비).
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'sepia',
    label: '세피아',
    light: { font: 'serif', size: 'default', bg: '#f4ecd8', surface: '#efe4c8', accent: 'orange' },
    dark: { font: 'serif', size: 'default', bg: '#2b2417', surface: '#35301f', accent: 'orange' },
  },
  {
    id: 'high-contrast',
    label: '고대비',
    light: { font: 'sans', size: 'large', bg: '#ffffff', surface: '#ffffff', accent: 'blue' },
    dark: { font: 'sans', size: 'large', bg: '#000000', surface: '#000000', accent: 'yellow' },
  },
  {
    id: 'soft-gray',
    label: '소프트 그레이',
    light: { font: 'sans', size: 'default', bg: '#eef0f3', surface: '#f7f8fa', accent: 'blue' },
    dark: { font: 'sans', size: 'default', bg: '#121317', surface: '#1a1c21', accent: 'blue' },
  },
]

// 현재 draft가 어느 프리셋과 정확히 일치하는지(하이라이트용) — 없으면 "커스텀" 취급.
export function findPresetId(palette: ThemeCustomPalette | undefined, tab: ThemeTab): string | null {
  if (!palette || Object.keys(palette).length === 0) return null
  const found = THEME_PRESETS.find((p) => JSON.stringify(p[tab]) === JSON.stringify(palette))
  return found?.id ?? null
}

// 기본 토큰 값(styles/tokens.css와 동기) — 대비 검증 시 미지정 항목의 기준값으로 쓴다.
// textMuted(검토 중요-1) — 전역 테마 커스텀에는 이 축을 직접 편집하는 UI가 없다(항상 기본
// 토큰 --text-muted 고정값). 서버가 이 축도 대비 검증에 넣는다고 해서 프론트가 즉시 피드백을
// 같이 계산할 수 있도록 값만 미러(정확한 hex 대조·임계값은 백엔드 보고가 정본).
export const DEFAULT_TOKEN_VALUES: Record<ThemeTab, { bg: string; surface: string; text: string; textMuted: string }> = {
  light: { bg: '#f5f6f8', surface: '#ffffff', text: '#14161a', textMuted: '#6b7280' },
  dark: { bg: '#0f1115', surface: '#17191f', text: '#e7e9ee', textMuted: '#9aa1ae' },
}

export function emptyTheme(): ThemeCustom {
  return {}
}
