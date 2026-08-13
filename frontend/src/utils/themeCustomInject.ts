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

// 문서 스타일 size 4단계(DocSize)와 동일한 이름 체계 — 일관되게 2px 단위 증가(검토 치명-1
// 수정: xl 추가, 서버 THEME_SIZES가 4단계라 프론트 매핑 누락 시 수용-무동작이 된다).
const FONT_SIZE_PX: Record<string, string> = {
  small: '14px',
  default: '16px',
  large: '18px',
  xl: '20px',
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

// --surface-raised 파생 비율(검토 3차 잔여-1) — tokens.css 기본 토큰 쌍에서 역산: 라이트는
// --surface(#ffffff)와 --surface-raised(#ffffff)가 완전히 같아 방향성 0(밝히지도 어둡히지도
// 않음). 다크는 --surface(#17191f) -> --surface-raised(#1e2129)로, 흰색 쪽으로 채널당 평균
// (7,8,10)/(232,230,224) ≈ 3.65% 혼합돼 있다 — 4%로 근사해 같은 mixHex 공식(라이트는 ratio 0이라
// mixHex가 원래 값을 그대로 돌려준다 — 분기 없이 통일)으로 적용한다. surface-raised는 서버 대비
// 검증 축이 아니므로(대비 검증은 --text만) 이 파생이 저장을 막을 일은 없다.
const SURFACE_RAISED_LIGHTEN_RATIO: Record<ThemeTab, number> = { light: 0, dark: 0.04 }

// 색 계열(bg·surface·text·accent 파생)과 타이포 계열(font·size)을 분리한다 — §4.26 ④ 경계표:
// "인쇄는 배경 전부 무시" + "폰트·글자크기는 인쇄 유지"가 서로 다른 매체 스코프를 요구하기
// 때문이다(색은 화면 전용, 타이포는 화면·인쇄 공통).
// 글자색·강조색은 팔레트 이름(F52 7색, 백엔드 THEME_PALETTE_NAMES와 동일) — INK_HEX로 실제 hex를
// 구해 계산한다(자유 hex 금지, §4.26 ① 결정 연장).
function colorDeclarationsFor(palette: ThemeCustomPalette | undefined, mode: ThemeTab): string[] {
  if (!palette) return []
  const decls: string[] = []
  if (isValidHex(palette.bg)) decls.push(`--bg: ${palette.bg};`)
  if (isValidHex(palette.surface)) {
    const raisedHex = mixHex(palette.surface, '#ffffff', 1 - SURFACE_RAISED_LIGHTEN_RATIO[mode])
    decls.push(`--surface: ${palette.surface};`, `--surface-raised: ${raisedHex};`)
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

// 검토 경미-2 수정: 기준 글자크기는 `--font-size-base` 변수 + index.css의 상시 `html{font-size}`
// 규칙 조합을 버렸다(그 규칙이 미설정 상태에서도 16px를 강제해 브라우저 접근성 글자크기 상속을
// 끊었다 — DoD 4 "무지정 렌더 불변" 위반). 대신 라이트·다크 선택자(아래 LIGHT_SELECTOR·
// DARK_SELECTOR — 둘 다 <html> 자신을 가리킨다, theme.ts가 dark 클래스를 documentElement에
// 직접 토글)에 **커스텀이 있을 때만** `font-size` 선언을 직접 얹는다 — 미설정이면 이 함수가 빈
// 배열을 돌려주므로 규칙 자체가 생성되지 않고, html은 종전처럼 아무 font-size 선언도 갖지 않는다
// (브라우저 기본값 상속 유지).
function typographyDeclarationsFor(palette: ThemeCustomPalette | undefined): string[] {
  if (!palette) return []
  const decls: string[] = []
  if (palette.font && FONT_STACK[palette.font]) decls.push(`--font-base: ${FONT_STACK[palette.font]};`)
  if (palette.size && FONT_SIZE_PX[palette.size]) {
    decls.push(`font-size: ${FONT_SIZE_PX[palette.size]};`)
  }
  return decls
}

// 라이트·다크 선택자(2차 검토 치명 수정) — dark 클래스는 documentElement(=html) 자신에 붙는다
// (stores/theme.ts `classList.toggle('dark')`), 즉 `:root`와 `.dark`가 **같은 요소**를 겨눈다.
// `:root`(0,1,0)와 `.dark`(0,1,0)는 특정도가 같아 소스 순서로만 갈리는데, 주입 태그가
// `document.head.appendChild`로 번들 CSS보다 항상 뒤에 오므로 라이트 블록의 `:root`가 다크
// 모드에서도 tokens.css의 `.dark`를 이겨버렸다(실측: 라이트만 세피아 저장 후 다크 전환 →
// --bg가 세피아로 남고 --text만 다크 값이 되어 대비 1.03:1까지 붕괴). 라이트 오버라이드는
// **`html:not(.dark)`**(특정도 0,1,1)로 좁혀 다크 클래스가 있으면 아예 매칭되지 않게 하고,
// 다크 오버라이드는 대칭성을 위해 `html.dark`로 통일한다(특정도 상승은 무해 — 여기 있는
// 규칙끼리만 경쟁하는 게 아니라 tokens.css `.dark`보다 항상 이겨야 하므로 오히려 안전 마진).
const LIGHT_SELECTOR = 'html:not(.dark)'
const DARK_SELECTOR = 'html.dark'

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
  if (lightType.length > 0) parts.push(`${LIGHT_SELECTOR} { ${lightType.join(' ')} }`)
  if (darkType.length > 0) parts.push(`${DARK_SELECTOR} { ${darkType.join(' ')} }`)
  if (lightColor.length > 0 || darkColor.length > 0) {
    const screenParts: string[] = ['@media screen {']
    if (lightColor.length > 0) screenParts.push(`  ${LIGHT_SELECTOR} { ${lightColor.join(' ')} }`)
    if (darkColor.length > 0) screenParts.push(`  ${DARK_SELECTOR} { ${darkColor.join(' ')} }`)
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
