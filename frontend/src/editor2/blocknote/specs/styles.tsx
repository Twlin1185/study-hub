// 방언 인라인 **스타일 스펙 3종**(stage-34 G-1) — `==형광==` · `||스포일러||` · `:t{…}`.
//
// stage-31 스파이크(`editor2/poc/specs.tsx`)에서 성립을 확인한 패턴을 **복제**한다(PoC는 D9 격리
// 계약상 수정하지 않는다). 값 도메인은 리더가 쓰는 `components/markdown/palette.ts`를 **재사용**
// 하고(신규 색 0 — 불변 규칙 5), 렌더 클래스·커스텀 프로퍼티도 `MarkdownView`와 **같은 경로**를
// 쓴다. 그래서 편집 표면과 읽기 화면의 색이 저절로 일치하고, 다크 모드는 `tokens.css`가 공짜로
// 처리한다(코드·CSS에 색 리터럴 0개).
//
// **셋 다 비-React 스펙이다**(stage-46 F-1 — FB-19 수정 + 브라우저 실측 후속). 자세한 사유는
// 아래 스포일러 절 머리말에 있다. 요지: `createReactStyleSpec`의 마크 뷰는 React 루트에 비동기로
// 커밋돼서, 접힌 커서로 마크를 걸고 이어 타자를 치면 **둘째 글자에서 캐럿이 문단 맨 앞으로
// 리셋**된다(`1231231` + 스포일러 + `abc` → `bc1231231a`). 2026-09-02 브라우저 실측에서
// **형광펜·`:t`(글자색)도 같은 패턴으로 재현**돼(규약 E의 "실측 재현 시에만 동일 전환" 조건 충족)
// 스포일러와 함께 코어 `createStyleSpec`(vanilla)으로 옮겼다. 렌더 클래스·토큰 경로·저장 포맷·
// 방언 왕복·리더 경로는 전부 그대로다(색 리터럴 0 · `<mark>` 시맨틱 유지).
import { createStyleSpec } from '@blocknote/core'
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

/**
 * 팔레트 밖 hex 색은 커스텀 프로퍼티로만 흘려보낸다(임의 CSS 문자열이 스타일에 닿는 경로 0).
 *
 * `isHexColor` 통과분만 `style.setProperty`로 적는다 — 값 도메인 검사가 여기 한 곳에 남아 있어야
 * `#rrggbb` 밖의 문자열이 인라인 스타일로 새지 않는다(리더 `MarkdownView`와 같은 규칙).
 */
function applyHexCustomProps(dom: HTMLElement, ink: string | undefined, bg: string | undefined): void {
  if (ink && isHexColor(ink)) dom.style.setProperty(HEX_INK_VAR, ink)
  if (bg && isHexColor(bg)) dom.style.setProperty(HEX_MARK_VAR, bg)
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
//
// 상태가 없는 스펙인데도 vanilla로 옮긴 이유 = 파일 머리말(FB-19와 **같은 캐럿 리셋이 실측 재현**).
// 태그는 `<mark>` 그대로다(시맨틱 유지 — 리더와 같은 요소).
const HIGHLIGHT_CLASS = `rounded bg-mark-yellow px-0.5 text-primary ${PRINT_COLOR_EXACT_CLASS}`

export const highlightStyleSpec = createStyleSpec(
  { type: 'highlight', propSchema: 'boolean' },
  {
    render: () => {
      const dom = document.createElement('mark')
      dom.className = HIGHLIGHT_CLASS
      return { dom, contentDOM: dom }
    },
  },
)

// ---------------------------------------------------------------- 스포일러(`||…||`)
//
// 클릭 공개 / 재클릭 비공개 토글(2026-08-15 사용자 실측 피드백 — PoC `specs.tsx` 17~30줄 패턴).
// 가린 상태 = 배경·글자색을 같은 토큰으로 맞춘 "먹칠"(다크 모드도 토큰만으로 자동 대응),
// 인쇄는 항상 공개(리더 `InlineSpoiler`와 같은 관례).
//
// **비-React 스펙이다**(stage-46 F-1 · 규약 E 후보 (a) — FB-19 수정). 원래는
// `createReactStyleSpec` + `useState` 노드 뷰였는데, 접힌 커서로 스포일러를 걸고 이어서 타자를
// 치면 **둘째 글자에서 캐럿이 문단 맨 앞으로 리셋**됐다("1231231" → 스포일러 → "abc" 입력 시
// `"bc1231231a"`). React 마크 뷰는 `ReactMarkViewRenderer`가 자기 루트에 **비동기로** 커밋하는데,
// 갓 생긴 마크의 contentDOM이 아직 자리 잡기 전에 ProseMirror가 다음 입력을 DOM에 반영하면서
// 위치 매핑이 어긋나는 것이 원인이다(대조군: 인라인 코드 = 코어 vanilla 스펙 — 정상).
// 코어 `createStyleSpec`은 `addMarkView`가 **동기로** `{dom, contentDOM}`을 돌려주므로 그 창이
// 아예 없다. 공개/비공개는 `useState` 대신 **DOM 리스너 + `aria-expanded` 토글**로 옮겼다
// (React 상태가 사라졌을 뿐, 클래스·토큰 경로·인쇄 규칙은 그대로 — 색 리터럴 0).
//
// 불변: 저장 포맷 `spoiler: true`(boolean) · 방언 `||…||` 왕복 · `schema.ts` 등재 키 `spoiler` ·
// 리더(`MarkdownView`의 `InlineSpoiler`) 무접촉.

/** 가린 상태 — 배경·글자색이 같은 토큰이라 "먹칠"로 보인다. 인쇄는 항상 공개. */
const SPOILER_HIDDEN_CLASS =
  'cursor-pointer select-none rounded bg-primary px-0.5 text-primary print:cursor-auto print:select-auto print:bg-transparent print:text-inherit'

/** 공개 상태 — 배경만 옅게 남겨 "여기가 스포일러였다"를 알린다. */
const SPOILER_REVEALED_CLASS = 'cursor-pointer rounded bg-bg px-0.5 print:cursor-auto print:bg-transparent'

/**
 * 공개 여부를 **DOM 자신에 적는다**(`aria-expanded`) — 별도 상태 저장소를 두지 않는다.
 * 마크 뷰가 다시 만들어지면 가린 상태로 돌아가는데, 이는 React `useState` 판과 같은 동작이다.
 */
function setSpoilerRevealed(dom: HTMLElement, revealed: boolean): void {
  dom.setAttribute('aria-expanded', revealed ? 'true' : 'false')
  dom.className = revealed ? SPOILER_REVEALED_CLASS : SPOILER_HIDDEN_CLASS
}

export const spoilerStyleSpec = createStyleSpec(
  { type: 'spoiler', propSchema: 'boolean' },
  {
    render: () => {
      const dom = document.createElement('span')
      dom.setAttribute('role', 'button')
      dom.tabIndex = -1
      setSpoilerRevealed(dom, false)
      dom.addEventListener('click', () => {
        setSpoilerRevealed(dom, dom.getAttribute('aria-expanded') !== 'true')
      })
      // contentDOM = dom — React 판(`<span ref={contentRef}>`)과 같은 구조다(ProseMirror는
      // `contentDOM`을 생략하면 `dom`을 그대로 쓴다 — 여기서는 명시해 의도를 남긴다).
      return { dom, contentDOM: dom }
    },
  },
)

// ---------------------------------------------------------------- `:t[…]{c= bg= s= …}`

//
// **값(`stringValue`)이 바뀌면 어떻게 다시 그려지는가**(vanilla 전환 시 확인한 지점): ProseMirror의
// 마크 뷰는 `MarkViewDesc.matchesMark()`가 `this.mark.eq(mark)`(= 타입 + **attrs** 비교)라
// (`prosemirror-view` dist `index.js:1241` 실측), `stringValue`가 달라지면 기존 뷰가 매치되지 않아
// **뷰째 버리고 `render(새 값)`으로 다시 만든다**. 즉 vanilla 스펙에 별도 `update` 훅이 없어도
// 색·크기 변경이 즉시 반영된다(React 판과 동일한 결과 — 렌더 함수가 순수 파생이라 성립한다).
//
// 파생 로직은 React 판과 **같은 함수**를 그대로 쓴다(`decodeTextStylePairs` → `interpretTextStyle` /
// `textStyleClasses`). 달라진 것은 산출을 JSX 대신 DOM에 적는 방식뿐이다.
export const textStyleSpec = createStyleSpec(
  { type: 't', propSchema: 'string' },
  {
    render: (value) => {
      const pairs = decodeTextStylePairs(value)
      const view = interpretTextStyle(pairs)
      const classes = textStyleClasses(pairs)
      const dom = document.createElement('span')
      if (classes.length > 0) dom.className = classes.join(' ')
      applyHexCustomProps(dom, view.ink, view.bg)
      return { dom, contentDOM: dom }
    },
  },
)
