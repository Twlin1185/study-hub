// 전역 테마 커스텀 런타임 주입 (F53 ①, 설계 §4.26 ③ · screens §7) — <html> 수준 CSS 변수로
// 빌드 없이 반영한다. 라이트·다크 각각 오버라이드만 있고, 미지정 항목은 tokens.css 기본값 그대로
// 상속된다(선언하지 않은 변수는 손대지 않으므로).
import { isValidHex, mixHex, pickReadableOnColor } from './color'
import { INK_HEX, type ThemeTab } from './themeCustomPresets'
import type { ThemeCustom, ThemeCustomPalette } from '../api/types'

const FONT_STACK: Record<string, string> = {
  sans: "system-ui, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Noto Serif KR', 'Times New Roman', serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
}

const FONT_SIZE_PX: Record<string, string> = {
  small: '15px',
  default: '16px',
  large: '18px',
}

const STYLE_TAG_ID = 'theme-custom-vars'

// 복구 경로(R27 ① — 계약) — 커스텀 테마가 화면을 못 보게 망가뜨려도 이 쿼리를 붙이면 주입을
// 건너뛰고 기본 토큰으로 들어올 수 있다. 매뉴얼에 명시(user-manual.html).
const SAFE_MODE_PARAM = 'safe_theme'

export function isSafeThemeMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get(SAFE_MODE_PARAM) === '1'
  } catch {
    return false
  }
}

// 색 계열(bg·surface·text·accent 파생)과 타이포 계열(font·fontSize)을 분리한다 — §4.26 ④ 경계표:
// "인쇄는 배경 전부 무시" + "폰트·글자크기는 인쇄 유지"가 서로 다른 매체 스코프를 요구하기
// 때문이다(색은 화면 전용, 타이포는 화면·인쇄 공통).
// 글자색·강조색은 팔레트 이름(F52 7색, 백엔드 THEME_PALETTE_NAMES와 동일) — INK_HEX로 실제 hex를
// 구해 계산한다(자유 hex 금지, §4.26 ① 결정 연장).
function colorDeclarationsFor(palette: ThemeCustomPalette | undefined, mode: ThemeTab): string[] {
  if (!palette) return []
  const decls: string[] = []
  if (isValidHex(palette.bg)) decls.push(`--bg: ${palette.bg};`)
  if (isValidHex(palette.surface)) {
    decls.push(`--surface: ${palette.surface};`, `--surface-raised: ${palette.surface};`)
  }
  if (palette.text && INK_HEX[mode][palette.text]) decls.push(`--text: ${INK_HEX[mode][palette.text]};`)
  if (palette.accent && INK_HEX[mode][palette.accent]) {
    const accentHex = INK_HEX[mode][palette.accent]
    const bgRef = isValidHex(palette.bg) ? palette.bg : '#ffffff'
    decls.push(
      `--accent: ${accentHex};`,
      `--accent-soft: ${mixHex(accentHex, bgRef, 0.18)};`,
      `--on-accent: ${pickReadableOnColor(accentHex)};`,
    )
  }
  return decls
}

function typographyDeclarationsFor(palette: ThemeCustomPalette | undefined): string[] {
  if (!palette) return []
  const decls: string[] = []
  if (palette.font && FONT_STACK[palette.font]) decls.push(`--font-base: ${FONT_STACK[palette.font]};`)
  if (palette.fontSize && FONT_SIZE_PX[palette.fontSize]) {
    decls.push(`--font-size-base: ${FONT_SIZE_PX[palette.fontSize]};`)
  }
  return decls
}

// 색 오버라이드는 @media screen으로 감싼다 — 인라인 스타일이 아니라 스타일시트 규칙으로 주입해야
// tokens.css의 `@media print { :root, .dark {...} }` 강제 라이트 규칙과 같은 층위에서 안전하게
// 밀린다(불변 규칙: 인쇄 뷰는 테마 무시하고 항상 라이트 — 전역 커스텀도 예외 없음, §4.26 ④).
// 타이포(폰트·기준 글자크기)는 매체 제한 없이 그대로 선언한다 — "폰트·글자크기는 인쇄 유지"
// (§4.26 ④, 잉크와 무관해 인쇄를 막을 이유가 없다).
export function buildThemeCustomCss(theme: ThemeCustom | null | undefined): string {
  if (!theme) return ''
  const lightColor = colorDeclarationsFor(theme.light, 'light')
  const darkColor = colorDeclarationsFor(theme.dark, 'dark')
  const lightType = typographyDeclarationsFor(theme.light)
  const darkType = typographyDeclarationsFor(theme.dark)
  const parts: string[] = []
  if (lightType.length > 0) parts.push(`:root { ${lightType.join(' ')} }`)
  if (darkType.length > 0) parts.push(`.dark { ${darkType.join(' ')} }`)
  if (lightColor.length > 0 || darkColor.length > 0) {
    const screenParts: string[] = ['@media screen {']
    if (lightColor.length > 0) screenParts.push(`  :root { ${lightColor.join(' ')} }`)
    if (darkColor.length > 0) screenParts.push(`  .dark { ${darkColor.join(' ')} }`)
    screenParts.push('}')
    parts.push(screenParts.join('\n'))
  }
  return parts.join('\n')
}

export function applyThemeCustomCss(theme: ThemeCustom | null | undefined) {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null
  const css = isSafeThemeMode() ? '' : buildThemeCustomCss(theme)
  if (!css) {
    existing?.remove()
    return
  }
  const tag = existing ?? document.createElement('style')
  tag.id = STYLE_TAG_ID
  if (!existing) document.head.appendChild(tag)
  tag.textContent = css
}
