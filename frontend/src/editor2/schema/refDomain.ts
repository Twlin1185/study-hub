// 에디터 v2 — **참조 칩 라벨·target 문자 도메인의 단일 출처** (M33 / stage-34 규약 B)
//
// 배경: 칩 라벨은 `[[DOC-0012|라벨]]`의 `[^\]|\n]+` 안에 실리고, 그 줄을 **remark-parse가 먼저**
// 훑는다. 그래서 인라인 문법을 여는 문자가 라벨에 있으면 칩이 붕괴하거나 통째로 사라진다
// (M32 실측 — `scripts/s32-roundtrip-blocks.mjs` 계열 ⑥이 그 경계를 기계로 고정해 두었다).
//
// **정책 = 거절(치환 금지)** — 도메인 밖 문자를 앱이 몰래 제거·치환하면 "조용한 본문 변형 0"
// 계약(M32 규약 A)과 충돌한다. 입력 시점에 사유를 보여주고 사용자가 고치게 한다.
// **유일한 자동 정리 = 가장자리 공백 트림**(파서가 어차피 버리는 자리 = 표기 정규화이지 값 변경이
// 아니다 — M32 규약 A 예외 ⓓ와 같은 논리).
//
// **판정 함수는 1개다**(`isSafeRefText`) — 라벨과 target(앵커 제목)의 금지 집합이 실질적으로 같아
// 미리 쪼개지 않는다(YAGNI). 콜아웃 `[제목]`(규약 E)도 같은 함수를 재사용한다.
//
// 이 파일은 **런타임 의존이 0**이다 — `blocks.ts`와 같은 계약(순수 함수만). 검증 스크립트가
// jiti로 그대로 불러 도메인을 고정한다.
//
// 구현 메모: 금지 문자 판정에 **정규식 문자 클래스를 쓰지 않고 코드포인트로 본다** — 제어문자·행
// 구분자를 소스에 리터럴로 적으면 파일이 조용히 깨지기 때문이다(이스케이프 함정 회피).

/** `[[…|…]]` 문법 자체를 닫아 버리는 문자. */
const STRUCTURAL_CHARS = [']', '|']

/** 줄바꿈·행 구분자 코드포인트(LF · CR · LINE SEPARATOR · PARAGRAPH SEPARATOR). */
const LINE_BREAK_CODES = new Set([0x0a, 0x0d, 0x2028, 0x2029])

/**
 * **인라인 문법을 여는 문자** — 파서가 라벨 안에서 다른 노드를 만들어 칩을 깨뜨린다.
 * (`_`는 위치에 따라 달라 여기 넣지 않고 아래에서 따로 본다.)
 */
const INLINE_OPENERS = ['*', '`', '~', '$', '[', ':', '<', '&', '\\']

/** 제어문자·줄바꿈이 하나라도 있는가. */
function hasControlOrBreak(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i)
    if (code < 0x20 || code === 0x7f || LINE_BREAK_CODES.has(code)) return true
  }
  return false
}

/** 문자가 단어 구성 문자(라틴·한글·숫자 등)인가 — `_`의 강조 판정에 쓴다. */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
}

/**
 * `_`가 **강조를 열 수 있는 위치**에 있는가.
 * CommonMark는 `snake_case`처럼 **양쪽이 단어 문자인 `_`**(intraword)로는 강조를 만들지 않는다.
 * 그 하나만 허용하고 나머지 위치의 `_`는 거절한다(보수적 — 통과시킨 것은 반드시 왕복해야 한다).
 */
function hasEmphasisUnderscore(s: string): boolean {
  const chars = [...s]
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== '_') continue
    if (!isWordChar(chars[i - 1]) || !isWordChar(chars[i + 1])) return true
  }
  return false
}

/**
 * 참조 칩 라벨 · 앵커 target · 콜아웃 제목으로 **그대로 실어도 왕복이 성립하는** 문자열인가.
 *
 * 계약(검증 스크립트가 기계로 고정한다):
 *   **`isSafeRefText(s) === true`이면 그 문자열은 반드시 방언 Markdown 왕복을 통과한다.**
 * 역은 성립하지 않아도 된다 — 이 함수는 **보수적인 부분집합**이며, 애매한 문자는 거절이 안전하다
 * (거절은 사용자가 고칠 기회를 얻지만, 잘못 통과시키면 본문이 조용히 깨진다).
 *
 * 트림은 **하지 않는다** — 호출부가 `normalizeRefText`로 먼저 다듬은 뒤 검사한다(가장자리 공백이
 * 남은 문자열은 거절 대상이다: 파서가 버려서 왕복이 깨지기 때문).
 */
export function isSafeRefText(s: string): boolean {
  if (typeof s !== 'string') return false
  if (s === '') return false
  // 가장자리 공백(유니코드 공백 포함) — 파서가 버린다.
  if (s !== s.trim()) return false
  if (hasControlOrBreak(s)) return false
  if (STRUCTURAL_CHARS.some((ch) => s.includes(ch))) return false
  if (INLINE_OPENERS.some((ch) => s.includes(ch))) return false
  if (hasEmphasisUnderscore(s)) return false
  return true
}

/** 유일한 자동 정리 = 가장자리 공백 트림. 값을 바꾸지 않는다(표기 정규화). */
export function normalizeRefText(s: string): string {
  return typeof s === 'string' ? s.trim() : ''
}

/** 거절 사유(사용자에게 그대로 보여 주는 한 줄) — 통과면 `null`. */
export function refTextRejection(s: string): string | null {
  const value = typeof s === 'string' ? s : ''
  if (value === '') return '빈 값은 쓸 수 없습니다'
  if (value !== value.trim()) return '앞뒤 공백은 쓸 수 없습니다'
  for (const ch of STRUCTURAL_CHARS) {
    if (value.includes(ch)) return `${ch} 는 참조 문법이 쓰는 문자라 넣을 수 없습니다`
  }
  if (hasControlOrBreak(value)) return '줄바꿈·제어문자는 넣을 수 없습니다'
  for (const ch of INLINE_OPENERS) {
    if (value.includes(ch)) return `${ch} 는 서식 문법을 여는 문자라 넣을 수 없습니다`
  }
  if (hasEmphasisUnderscore(value)) return '_ 는 단어 안(예: snake_case)에서만 쓸 수 있습니다'
  if (!isSafeRefText(value)) return '쓸 수 없는 문자가 들어 있습니다'
  return null
}

// ---------------------------------------------------------------- target 도메인

/** doc·embed 대상 = 문서 번호(`DOC-0012`) — 피커가 고른 값만 실린다(자유 입력 경로 없음). */
export const DOC_NO_RE = /^DOC-\d{4,}$/

export function isDocNo(s: string): boolean {
  return typeof s === 'string' && DOC_NO_RE.test(s)
}

/**
 * 앵커 대상(`[[#절 제목]]`) — **현재 노트의 heading 텍스트에서 고른다**(자유 입력 없음).
 * 목록에 올릴 수 있는 제목인지 판정한다(도메인 밖 제목은 숨기지 않고 **비활성 + 사유**로 노출).
 */
export function isSafeAnchorTarget(s: string): boolean {
  return isSafeRefText(s) && !s.startsWith('#')
}
