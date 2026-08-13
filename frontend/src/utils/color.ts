// 색 유틸 — 전역 테마 커스텀(F53 ①, 설계 §4.26 ③)의 명도 대비 자동 검증·파생 토큰 계산용.
// 여기서 다루는 값은 전부 "사용자가 고른 색 데이터"이지 소스에 박힌 하드코딩 색이 아니다
// (불변 규칙 5 예외 — 배경·서피스 자유 색 선택 UI의 입력값 자체).

export function normalizeHex(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  return `#${h.toLowerCase()}`
}

export function isValidHex(hex: string | undefined | null): hex is string {
  return typeof hex === 'string' && normalizeHex(hex) !== null
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex) ?? '#000000'
  const num = parseInt(normalized.slice(1), 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function srgbChannel(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

// WCAG 2.x 상대 휘도.
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbChannel)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// WCAG 2.x 명도 대비율(1~21). 서버 최종 게이트(§4.26 ③ R27 ②)와 별개로 프론트 즉시 피드백용.
export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA)
  const l2 = relativeLuminance(hexB)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// WCAG AA 본문 텍스트 기준(4.5:1) — 백엔드 settings_service.CONTRAST_MIN과 값 동기(2026-08-13
// 검토 대응). 대비 임계값 구체 수치는 서버가 최종 게이트이므로 이 상수는 프론트 즉시 피드백
// 기준일 뿐이다.
export const CONTRAST_MIN = 4.5

// --text-muted(보조 텍스트) 축 — 서버 검증의 두 번째 대비 축(검토 중요-1). 백엔드
// settings_service.CONTRAST_MIN_MUTED 확정치와 값 동기(tokens.css --text-muted 라이트·다크
// hex 미러는 백엔드 pytest로 봉인됨).
export const CONTRAST_MIN_MUTED = 3.0

export function meetsContrast(hexA: string, hexB: string, min: number = CONTRAST_MIN): boolean {
  return contrastRatio(hexA, hexB) >= min
}

// hexA를 ratio 비중으로 hexB와 섞는다(0~1). --accent-soft 같은 파생 토큰 계산용.
export function mixHex(hexA: string, hexB: string, ratio: number): string {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  const clamped = Math.min(1, Math.max(0, ratio))
  const mixed = a.map((v, i) => Math.round(v * clamped + b[i] * (1 - clamped)))
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

// accent 배경 위에서 더 잘 보이는 글자색(흑/백)을 고른다 — --on-accent 자동 파생용.
export function pickReadableOnColor(bgHex: string): '#ffffff' | '#111111' {
  return contrastRatio(bgHex, '#ffffff') >= contrastRatio(bgHex, '#111111') ? '#ffffff' : '#111111'
}
