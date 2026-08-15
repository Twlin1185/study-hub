// F52 표현 팔레트 — 의미 이름 7색 + 크기 3단계 (설계 §6 계약, plan §14 F52 결정 ③).
// remarkStudy(파싱 화이트리스트)·MarkdownView(렌더 클래스)·DocEditor(툴바 드롭다운)가 공유하는
// 단일 출처.
//
// S30 ⓓ(F52 결정 ③ "팔레트 7색 고정"의 공식 개정) — 색 값 화이트리스트는 이제
// **팔레트 7색 이름 ∪ `#rrggbb`**다. 3자리 축약·`rgb()`·CSS 색 이름은 여전히 불허(종전대로
// 스타일만 무시하고 텍스트는 그대로 — 임의 CSS 문자열이 속성값으로 사는 경로 0).
// 다크 모드 보정은 코드가 아니라 tokens.css의 `color-mix` 규칙이 담당한다.
export const PALETTE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const
export type PaletteColor = (typeof PALETTE_COLORS)[number]

export function isPaletteColor(value: string): value is PaletteColor {
  return (PALETTE_COLORS as readonly string[]).includes(value)
}

// 자유 색은 6자리 hex만 — 이 정규식이 본문 데이터가 스타일에 닿는 유일한 관문이다.
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value)
}

// hex 값이 실려 나가는 커스텀 프로퍼티 이름 — remarkStudy(방출)·MarkdownView(통과)·
// tokens.css(색 계산)가 공유하는 단일 출처. 이름이 어긋나면 색이 조용히 사라진다.
export const HEX_INK_VAR = '--u-ink'
export const HEX_MARK_VAR = '--u-bg'
// 위 변수를 실제 color/background-color로 바꾸는 tokens.css 규칙의 클래스.
export const HEX_INK_CLASS = 'u-ink'
export const HEX_MARK_CLASS = 'u-mark'

// 기존 font_scale 명명(small|default|large) + xl — F53 size 통일 결정 연동(stage-26 지시서 리스크 절).
// 기본 크기는 속성 생략으로 표현하므로 여기엔 'default'가 없다.
export const TEXT_SIZES = ['small', 'large', 'xl'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export function isTextSize(value: string): value is TextSize {
  return (TEXT_SIZES as readonly string[]).includes(value)
}

export const PALETTE_LABEL: Record<PaletteColor, string> = {
  red: '빨강',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  gray: '회색',
}

export const TEXT_SIZE_LABEL: Record<TextSize, string> = {
  small: '작게',
  large: '크게',
  xl: '아주 크게',
}

// 크기는 상대 배율(em) — 절대 px 금지(문서 §5.3 계약). 부모 폰트 크기(font_scale·F53)와 곱으로 합성된다.
export const TEXT_SIZE_CLASS: Record<TextSize, string> = {
  small: 'text-[0.85em]',
  large: 'text-[1.25em]',
  xl: 'text-[1.6em]',
}

// Tailwind JIT는 소스 안에 **완전한 리터럴 클래스 문자열**이 있어야 유틸을 생성한다(정규식 스캐너 —
// AST 평가 없음). `bg-mark-${color}`처럼 템플릿 리터럴로 조립하면 실제 색상별 클래스가 생성되지
// 않아 스타일이 조용히 사라진다 — 그래서 완성된 문자열을 그대로 나열한 조회 테이블로 둔다.
export const MARK_BG_CLASS: Record<PaletteColor, string> = {
  red: 'bg-mark-red',
  orange: 'bg-mark-orange',
  yellow: 'bg-mark-yellow',
  green: 'bg-mark-green',
  blue: 'bg-mark-blue',
  purple: 'bg-mark-purple',
  gray: 'bg-mark-gray',
}

export const INK_TEXT_CLASS: Record<PaletteColor, string> = {
  red: 'text-ink-red',
  orange: 'text-ink-orange',
  yellow: 'text-ink-yellow',
  green: 'text-ink-green',
  blue: 'text-ink-blue',
  purple: 'text-ink-purple',
  gray: 'text-ink-gray',
}

// 인쇄 시 형광펜·글자색만 배경 그래픽 설정 무관하게 그대로 찍히게 한다(결정 ⑤ — 코드블록 등
// 나머지 배경은 계속 인쇄 생략). Tailwind 임의 속성 문법으로 표준 유틸 없이 바로 명시한다.
export const PRINT_COLOR_EXACT_CLASS = '[print-color-adjust:exact] [-webkit-print-color-adjust:exact]'
