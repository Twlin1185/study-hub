// 방언 인라인 **스타일 스펙 3종**(stage-34 G-1) — `==형광==` · `||스포일러||` · `:t{…}`.
//
// stage-31 스파이크(`editor2/poc/specs.tsx`)에서 성립을 확인한 패턴을 **복제**한다(PoC는 D9 격리
// 계약상 수정하지 않는다). 값 도메인은 리더가 쓰는 `components/markdown/palette.ts`를 **재사용**
// 하고(신규 색 0 — 불변 규칙 5), 렌더 클래스·커스텀 프로퍼티도 `MarkdownView`와 **같은 경로**를
// 쓴다. 그래서 편집 표면과 읽기 화면의 색이 저절로 일치하고, 다크 모드는 `tokens.css`가 공짜로
// 처리한다(코드·CSS에 색 리터럴 0개).
import { createReactStyleSpec } from '@blocknote/react'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { interpretTextStyle } from '../../schema/blocks'
import type { AttrPair } from '../../schema/blocks'
import {
  HEX_INK_CLASS,
  HEX_INK_VAR,
  HEX_MARK_CLASS,
  HEX_MARK_VAR,
  INK_TEXT_CLASS,
  MARK_BG_CLASS,
  PRINT_COLOR_EXACT_CLASS,
  TEXT_SIZE_CLASS,
  isHexColor,
  isPaletteColor,
} from '../../../components/markdown/palette'

/**
 * `t` 스타일의 값 = `JSON.stringify(AttrPair[])`.
 *
 * **왜 ink/bg/size 3개로 쪼개지 않는가**: 앱 스키마의 `t`는 화이트리스트 밖 값(`c=rebeccapurple`)·
 * 미지 키·비-ASCII 키·중복 키·**순서**까지 그대로 보존한다(코퍼스에 실재하는 표본이다). 화이트
 * 리스트 prop 3개로 투영하면 그 표본들이 조용히 사라진다(손실 0 계약 위반). 렌더·툴바가 보는
 * ink/bg/size 뷰는 `interpretTextStyle(pairs)`로 **파생**한다.
 */
export function decodeTextStylePairs(value: string | undefined): AttrPair[] {
  if (!value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: AttrPair[] = []
  for (const pair of parsed) {
    if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
      out.push([pair[0], pair[1]])
    }
  }
  return out
}

export function encodeTextStylePairs(pairs: AttrPair[]): string {
  return pairs.length > 0 ? JSON.stringify(pairs) : ''
}

/** 팔레트 밖 hex 색은 커스텀 프로퍼티로만 흘려보낸다(임의 CSS 문자열이 스타일에 닿는 경로 0). */
function hexStyle(ink: string | undefined, bg: string | undefined): CSSProperties | undefined {
  const out: Record<string, string> = {}
  if (ink && isHexColor(ink)) out[HEX_INK_VAR] = ink
  if (bg && isHexColor(bg)) out[HEX_MARK_VAR] = bg
  // CSS 커스텀 프로퍼티는 React 타입(CSSProperties)에 색인이 없어 캐스팅이 필요하다(런타임 정상).
  return Object.keys(out).length > 0 ? (out as CSSProperties) : undefined
}

/** `:t` 속성 쌍 → 렌더 클래스 목록. `MarkdownView`의 `data-ink`/`data-mark` 분기와 같은 규칙이다. */
export function textStyleClasses(pairs: AttrPair[]): string[] {
  const view = interpretTextStyle(pairs)
  const classes: string[] = []
  if (view.bg && isPaletteColor(view.bg)) {
    classes.push(MARK_BG_CLASS[view.bg], 'rounded', 'px-0.5', PRINT_COLOR_EXACT_CLASS)
  } else if (view.bg && isHexColor(view.bg)) {
    classes.push(HEX_MARK_CLASS, 'rounded', 'px-0.5', PRINT_COLOR_EXACT_CLASS)
  }
  if (view.ink && isPaletteColor(view.ink)) classes.push(INK_TEXT_CLASS[view.ink], PRINT_COLOR_EXACT_CLASS)
  else if (view.ink && isHexColor(view.ink)) classes.push(HEX_INK_CLASS, PRINT_COLOR_EXACT_CLASS)
  if (view.size) classes.push(TEXT_SIZE_CLASS[view.size])
  return classes
}

// ---------------------------------------------------------------- 형광펜(`==…==`)
//
// **boolean**이다 — 색을 값으로 갖지 않는다(앱 스키마 `InlineStyles.highlight?: true`와 1:1).
// 색은 `:t{bg=}`가 담는다. 기본 노랑 고정은 리더(`MarkdownView`의 `mark`)와 같은 클래스다.
export const highlightStyleSpec = createReactStyleSpec(
  { type: 'highlight', propSchema: 'boolean' },
  {
    render: ({ contentRef }) => (
      <mark className={`rounded bg-mark-yellow px-0.5 text-primary ${PRINT_COLOR_EXACT_CLASS}`} ref={contentRef} />
    ),
  },
)

// ---------------------------------------------------------------- 스포일러(`||…||`)
//
// 클릭 공개 / 재클릭 비공개 토글(2026-08-15 사용자 실측 피드백 — PoC `specs.tsx` 17~30줄 패턴).
// 가린 상태 = 배경·글자색을 같은 토큰으로 맞춘 "먹칠"(다크 모드도 토큰만으로 자동 대응),
// 인쇄는 항상 공개(리더 `InlineSpoiler`와 같은 관례).
function SpoilerStyleRender({ contentRef }: { contentRef: (el: HTMLElement | null) => void }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-expanded={revealed}
      onClick={() => setRevealed((v) => !v)}
      className={
        revealed
          ? 'cursor-pointer rounded bg-bg px-0.5 print:cursor-auto print:bg-transparent'
          : 'cursor-pointer select-none rounded bg-primary px-0.5 text-primary print:cursor-auto print:select-auto print:bg-transparent print:text-inherit'
      }
      ref={contentRef}
    />
  )
}

export const spoilerStyleSpec = createReactStyleSpec(
  { type: 'spoiler', propSchema: 'boolean' },
  { render: SpoilerStyleRender },
)

// ---------------------------------------------------------------- `:t[…]{c= bg= s= …}`

function TextStyleRender({
  value,
  contentRef,
}: {
  value: string | undefined
  contentRef: (el: HTMLElement | null) => void
}) {
  const pairs = decodeTextStylePairs(value)
  const view = interpretTextStyle(pairs)
  const classes = textStyleClasses(pairs)
  return (
    <span
      className={classes.length > 0 ? classes.join(' ') : undefined}
      style={hexStyle(view.ink, view.bg)}
      ref={contentRef}
    />
  )
}

export const textStyleSpec = createReactStyleSpec(
  { type: 't', propSchema: 'string' },
  { render: TextStyleRender },
)
