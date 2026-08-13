// 문서별 스타일(F53 ②, 설계 §4.26 ①) 화이트리스트 상수 — DocStyleFields·useDocStyle·DocEditor가
// 공유하는 단일 출처. bg 색 이름은 F52 팔레트(components/markdown/palette.ts)를 그대로 재사용하되
// 토큰 값은 분리한다(--doc-bg-* — 형광펜 --mark-*보다 훨씬 연한 틴트, §4.26 ②-3 ⓐ).
import { PALETTE_COLORS, PALETTE_LABEL, type PaletteColor } from '../components/markdown/palette'
import type { DocBg, DocFont, DocSize, DocumentStyle, FontScale, MarkdownScale } from '../api/types'

export const DOC_FONT_OPTIONS: DocFont[] = ['sans', 'serif', 'mono']

export const DOC_FONT_LABEL: Record<DocFont, string> = {
  sans: '고딕(sans)',
  serif: '명조(serif)',
  mono: '고정폭(mono)',
}

// Tailwind JIT는 완전한 리터럴 클래스 문자열이 필요하다(palette.ts MARK_BG_CLASS 관례와 동일) —
// 조립 금지, 조회 테이블로 고정.
export const DOC_FONT_CLASS: Record<DocFont, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  mono: 'font-mono',
}

// 기존 FontScale(small|default|large) 명명 + xl(§4.26 ①·②-3 ⓑ 통일 결정) — 지정 문서에서는
// study.font_scale을 대체한다(④ ⓒ, 곱연산 기각).
export const DOC_SIZE_OPTIONS: DocSize[] = ['small', 'default', 'large', 'xl']

export const DOC_SIZE_LABEL: Record<DocSize, string> = {
  small: '작게',
  default: '기본',
  large: '크게',
  xl: '아주 크게',
}

// bg 값은 F52 팔레트 7색 이름 그대로(설계 §4.26 ① 결정 — F52 결정 ③ 일관).
export const DOC_BG_OPTIONS: PaletteColor[] = [...PALETTE_COLORS]
export const DOC_BG_LABEL: Record<PaletteColor, string> = PALETTE_LABEL

export const DOC_BG_CLASS: Record<DocBg, string> = {
  red: 'bg-docbg-red',
  orange: 'bg-docbg-orange',
  yellow: 'bg-docbg-yellow',
  green: 'bg-docbg-green',
  blue: 'bg-docbg-blue',
  purple: 'bg-docbg-purple',
  gray: 'bg-docbg-gray',
}

// 인쇄는 문서 배경을 항상 무시한다(§4.26 ④ — 전역·문서 공통, --doc-bg-*에 print-color-adjust:exact
// 를 걸지 않는다는 결정의 프론트 짝). 배경을 쓰는 곳은 전부 이 클래스를 함께 붙인다.
export const DOC_BG_PRINT_RESET_CLASS = 'print:bg-transparent'

// MarkdownView의 SCALE_CLASS와 같은 값 — 단일 출처로 여기 두고 MarkdownView·문서 스타일이 적용된
// 화면의 "본문 렌더 영역"에 속하지만 MarkdownView를 거치지 않는 요소(문제 보기 목록 등, 검토
// 3차 잔여-3)가 같은 크기 단계를 재사용하게 한다. 토큰 기반 크기 클래스만 사용(색상·크기
// 하드코딩 금지) — small/default/large/xl 4단계.
export const MARKDOWN_SCALE_CLASS: Record<MarkdownScale, string> = {
  small: 'text-xs',
  default: 'text-sm',
  large: 'text-base',
  xl: 'text-lg',
}

export interface ResolvedDocStyle {
  // 문서 style.size가 있으면 그 값이 study.font_scale을 대체(§4.26 ④ — 곱연산 기각).
  scale: MarkdownScale
  // 빈 문자열 = 오버라이드 없음(전역 폰트 그대로 상속).
  fontClassName: string
  // 빈 문자열 = 오버라이드 없음(호출부가 기존 bg-surface 등 기본 배경을 그대로 쓰면 된다).
  bgClassName: string
}

// 훅이 아닌 순수 함수 — 루프 안(인쇄 뷰의 문서 여러 건 렌더 등)에서 훅 규칙 위반 없이 그대로
// 쓸 수 있다. globalScale은 호출부가 useFontScale()로 한 번만 구해 전달한다.
export function resolveDocStyle(style: DocumentStyle | null | undefined, globalScale: FontScale): ResolvedDocStyle {
  const scale: MarkdownScale = style?.size ?? globalScale
  const fontClassName = style?.font ? DOC_FONT_CLASS[style.font] : ''
  const bgClassName = style?.bg ? `${DOC_BG_CLASS[style.bg]} ${DOC_BG_PRINT_RESET_CLASS}` : ''
  return { scale, fontClassName, bgClassName }
}
