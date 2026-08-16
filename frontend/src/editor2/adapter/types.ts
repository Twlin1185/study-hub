// 에디터 v2 어댑터 — **BlockNote 블록 JSON의 구조 타입**(M33 / stage-33 규약 B)
//
// 규약 B: 어댑터는 **BlockNote 에디터 인스턴스를 쓰지 않는다** — 앱 블록(JSON) ↔ BlockNote
// 블록(JSON)의 순수 함수뿐이다. 이 파일은 그 JSON 형태를 **구조 타입으로 재선언**한다:
//   ① DOM 없이 Node 스크립트(`scripts/s33-adapter-roundtrip.mjs`)로 왕복 검증이 가능해야 하고
//   ② 엔진 교체 시 영향이 이 디렉터리로 국소화돼야 한다(R33).
// `@blocknote/*`를 **런타임으로도 타입으로도 import하지 않는다** — 어댑터 모듈이 편집기 청크를
// 끌어오면 R37(초기 청크 ≤ +5KB)이 무너진다. 실제 스키마와의 정합은 `blocknote/schema.ts`의
// 경계 캐스트 1곳 + 왕복 스크립트가 지킨다.
//
// 형태 출처(실측 — `@blocknote/core` 0.54.0):
//   · StyledText  = { type:'text', text, styles }             (schema/inlineContent/types.ts)
//   · Link        = { type:'link', href, content: StyledText[] }
//   · TableContent= { type:'tableContent', columnWidths, headerRows?, rows:[{cells}] }
//   · 줄바꿈은 **StyledText.text 안의 `\n`**이다(hardBreak 노드는 JSON에 나오지 않는다 —
//     nodeToBlock이 `\n`으로 접는다).
//
// `BlockMeta`만은 앱 스키마에서 타입으로 가져온다 — `schema/blocks.ts`도 런타임 의존이 0인
// 순수 타입·헬퍼 모듈이라 규약 B(편집기 청크 유출 금지)를 깨지 않는다.
import type { BlockMeta } from '../schema/blocks'

/**
 * 우리가 채택한 styleSpecs 집합(코어 5종 + 방언 3종 — stage-34 G-1).
 *
 * BlockNote **기본 색 스타일**(`textColor`/`backgroundColor`)은 여전히 채택하지 않는다 —
 * 하드코딩 hex 팔레트를 끌고 들어와 불변 규칙 5와 부딪힌다. 색은 앱 방언 `:t`가 담고,
 * 렌더는 `tokens.css` 변수를 경유한다.
 */
export interface BnStyles {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
  /** `==형광==` — **boolean**이다(색을 값으로 갖지 않는다. 색은 `t`의 `bg=`가 담는다). */
  highlight?: true
  /** `||스포일러||` */
  spoiler?: true
  /**
   * `:t[…]{c= bg= s= …}`의 **원본 속성 쌍 전체** = `JSON.stringify(AttrPair[])`.
   *
   * ink/bg/size 3개 스타일로 쪼개지 않는 이유: 앱 스키마의 `t`는 화이트리스트 **밖** 값·미지 키·
   * 비-ASCII 키·중복 키·**순서**까지 그대로 보존한다(코퍼스에 실재하는 표본이다). 화이트리스트
   * prop 3개로 투영하면 그 표본들이 조용히 사라진다(손실 0 계약 위반). 툴바·렌더가 보는
   * ink/bg/size 뷰는 `schema/blocks.ts`의 `interpretTextStyle(pairs)`로 **파생**한다.
   */
  t?: string
}

export interface BnStyledText {
  type: 'text'
  text: string
  styles: BnStyles
}

export interface BnLink {
  type: 'link'
  href: string
  content: BnStyledText[]
}

// ---------------------------------------------------------------- 방언 인라인 콘텐츠(원자)
//
// 전부 `createReactInlineContentSpec` + `content:'none'`(원자 — 내부 편집 불가, 한 단위로 삭제·이동).
//
// **`styles` prop이 왜 있는가**: BlockNote는 커스텀 인라인 노드에 걸린 mark를 되읽을 때 **버린다**
// (`nodeToInlineContent` 실측 — 커스텀 IC는 `{type,props,content}`만 돌려준다). 그래서 앱 모델의
// `styles`를 그대로 두면 `**굵게 [[DOC-0012]] 안쪽**`·`:t[색 있는 [[DOC-0003]] 칩]{c=blue}` 같은
// 표본이 실제 스키마 적재에서 서식을 잃는다. 원자의 서식은 **prop(JSON)으로 들고 다니고**
// 렌더가 그 값을 읽어 칠한다.
export type BnInlineStylesProp = string

export interface BnRefChip {
  type: 'refChip'
  /** `label: ''` ⇔ 앱 `label === undefined`(라벨 추종형 — 규약 C). */
  props: { refType: string; target: string; label: string; styles: BnInlineStylesProp }
}

/** 문단 **안**의 이미지 — 보존·표시·삭제 전용(규약 D). 블록으로 승격하지 않는다(문단이 쪼개진다). */
export interface BnInlineImage {
  type: 'inlineImage'
  /** `title:''` ⇔ undefined · `width`/`height`의 `0` ⇔ undefined. */
  props: {
    url: string
    alt: string
    title: string
    width: number
    height: number
    styles: BnInlineStylesProp
  }
}

/** 팔레트 밖 인라인 mdast 노드의 원문 슬라이스 보존(읽기 전용). */
export interface BnInlineFallback {
  type: 'inlineFallback'
  props: { markdown: string; nodeType: string; styles: BnInlineStylesProp }
}

/**
 * 경성 줄바꿈(`\`+개행) — 규약 I 흡수 4종 중 하나. **원자 인라인**으로 담는다.
 *
 * 타입 이름이 `hardBreak`가 **아닌** 이유: BlockNote 코어 PM 스키마에 이미 `hardBreak` 노드가 있고
 * `nodeToInlineContent`가 그 이름을 만나면 무조건 `\n`으로 접어 버린다(실측). 이름이 겹치면 우리
 * 원자가 되읽기에서 사라지므로 편집기 표현만 `lineBreak`로 둔다(앱 스키마는 `hardBreak` 그대로).
 */
export interface BnLineBreak {
  type: 'lineBreak'
  props: { styles: BnInlineStylesProp }
}

/** 인라인 수식 — `@blocknote/math-block`의 `math`(content `'plain'` = 문자열). */
export interface BnInlineMath {
  type: 'math'
  props?: Record<string, never>
  /** 편집기는 문자열로 돌려준다. 관대하게 텍스트 run 배열도 읽는다. */
  content: string | BnStyledText[]
}

export type BnInline =
  | BnStyledText
  | BnLink
  | BnRefChip
  | BnInlineImage
  | BnInlineFallback
  | BnLineBreak
  | BnInlineMath

export interface BnTableCell {
  type: 'tableCell'
  props?: Record<string, unknown>
  content: BnInline[]
}

export interface BnTableRow {
  cells: BnInline[][] | BnTableCell[]
}

export interface BnTableContent {
  type: 'tableContent'
  columnWidths?: (number | undefined)[]
  headerRows?: number
  headerCols?: number
  rows: BnTableRow[]
}

interface BnBlockCommon {
  id?: string
  children?: BnBlock[]
}

export interface BnParagraph extends BnBlockCommon {
  type: 'paragraph'
  content: BnInline[]
}

export interface BnHeading extends BnBlockCommon {
  type: 'heading'
  props: { level: number }
  content: BnInline[]
}

export interface BnBulletListItem extends BnBlockCommon {
  type: 'bulletListItem'
  content: BnInline[]
}

export interface BnNumberedListItem extends BnBlockCommon {
  type: 'numberedListItem'
  props?: { start?: number }
  content: BnInline[]
}

export interface BnCheckListItem extends BnBlockCommon {
  type: 'checkListItem'
  props: { checked: boolean }
  content: BnInline[]
}

export interface BnQuote extends BnBlockCommon {
  type: 'quote'
  content: BnInline[]
}

/** `info`는 앱 전용 확장 prop(규약 E — 편집 UI 없이 왕복 보존만). */
export interface BnCodeBlock extends BnBlockCommon {
  type: 'codeBlock'
  props: { language: string; info?: string }
  content: BnStyledText[]
}

export interface BnTable extends BnBlockCommon {
  type: 'table'
  content: BnTableContent
}

/**
 * 내장 image 스펙 + **앱 확장 prop 2개**(`title`·`height` — 규약 I 흡수 2종).
 * `codeBlockSpecWithInfo`(펜스 info)와 같은 전례다: 편집 UI 없이 **왕복 보존만** 한다.
 * `title:''` ⇔ undefined · `height:0` ⇔ undefined.
 */
export interface BnImage extends BnBlockCommon {
  type: 'image'
  props: {
    url: string
    caption?: string
    previewWidth?: number
    name?: string
    title?: string
    height?: number
  }
}

export interface BnDivider extends BnBlockCommon {
  type: 'divider'
}

/** `$$ … $$` — `@blocknote/math-block`의 `mathBlock`(content `'plain'` = 텍스트 run 배열). */
export interface BnMathBlock extends BnBlockCommon {
  type: 'mathBlock'
  content: BnStyledText[]
}

/**
 * `:::note[제목]{…} … :::` — content `'none'` + **children으로 본문 블록**(앱 `CalloutBlock.children`).
 * `attrs` = `JSON.stringify(AttrPair[])`(`t`와 같은 이유로 통짜 보존 — 자유 편집 UI 없음, 규약 E).
 */
export interface BnCallout extends BnBlockCommon {
  type: 'callout'
  props: { variant: string; title: string; attrs: string }
}

/** `![[DOC-0007]]` — 원자·읽기 전용 카드. `label:''` ⇔ undefined(규약 C). */
export interface BnDocEmbed extends BnBlockCommon {
  type: 'docEmbed'
  props: { target: string; label: string }
}

/** 팔레트 밖 mdast 노드의 원문 Markdown 보존(읽기 전용 — 편집 불가·삭제만). */
export interface BnSourceFallback extends BnBlockCommon {
  type: 'sourceFallback'
  props: { markdown: string; nodeType: string }
}

export type BnBlock =
  | BnParagraph
  | BnHeading
  | BnBulletListItem
  | BnNumberedListItem
  | BnCheckListItem
  | BnQuote
  | BnCodeBlock
  | BnTable
  | BnImage
  | BnDivider
  | BnMathBlock
  | BnCallout
  | BnDocEmbed
  | BnSourceFallback

/** 우리가 채택하는 BlockNote 블록 타입 전수 — `blocknote/schema.ts`가 이 목록으로 스키마를 좁힌다. */
export const BN_BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
  'codeBlock',
  'table',
  'image',
  'divider',
  'mathBlock',
  'callout',
  'docEmbed',
  'sourceFallback',
] as const

/** 커스텀 인라인 콘텐츠 타입 전수(내장 `text`·`link` 제외). */
export const BN_INLINE_TYPES = ['refChip', 'inlineImage', 'inlineFallback', 'lineBreak', 'math'] as const

/** 콜아웃 variant **고정 목록**(규약 E — 자유 입력 UI 금지). */
export const CALLOUT_VARIANTS = ['note', 'warn', 'tip', 'fold', 'hide'] as const

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number]

export function isCalloutVariant(value: string): value is CalloutVariant {
  return (CALLOUT_VARIANTS as readonly string[]).includes(value)
}

export type BnBlockType = (typeof BN_BLOCK_TYPES)[number]

// ---------------------------------------------------------------- 미지원 보고(손실 0 계약)

/**
 * 어댑터가 **BlockNote 코어 팔레트로 옮길 수 없는** 내용을 만났을 때의 보고 단위.
 * 조용히 버리는 경로는 없다 — 호출자(화면)는 `unsupported.length > 0`이면 편집 표면에 올리지
 * 않고 읽기 전용 폴백으로 간다(stage-33 F-3·F-8. 덮어쓰기 사고 0).
 */
export interface AdapterIssue {
  /** 블록 트리 위치(예: `blocks[3].content[1]`) */
  path: string
  /** 미지원 사유 식별자(집계·검증용 — 왕복 스크립트가 이 값을 고정한다) */
  kind: string
  /** 사람이 읽는 보조 설명 */
  detail?: string
}

// ---------------------------------------------------------------- 사이드카(규약 I 흡수 나머지)
//
// BlockNote 문서에 담을 자리가 **없는데도** 왕복 보존해야 하는 값은 블록 id를 키로 여기 둔다.
// 중첩 블록(목록 children·quote children·callout children)도 각자 id가 있으므로 **평평한 id 맵**
// 하나로 어느 깊이든 커버된다.
//
// 주의 — quote 끌어올리기와의 상호작용: `toBlockNote`는 quote 첫 자식 문단의 내용을 quote 인라인
// 으로 끌어올리고 `fromBlockNote`는 그것을 id `${quoteId}-p` 문단으로 되돌린다. 그래서 끌어올려진
// 문단의 사이드카 항목은 **`${quoteId}-p` 키로 옮겨 적는다**(그러지 않으면 복원되지 않는다).

export interface AdapterSidecarEntry {
  /** `block:meta` — provenance 예약 필드(편집 표면에 올릴 자리가 없다). */
  meta?: BlockMeta
  /**
   * `link:title` — **href → title**(같은 블록 안).
   * 인덱스가 아니라 href를 키로 두는 이유: content 배열 인덱스는 사용자 편집에 곧바로 어긋난다.
   * 같은 블록에 같은 href가 여러 번 나오고 title이 서로 다르면 **마지막 값이 남는다**(허용).
   */
  linkTitles?: Record<string, string>
  /**
   * `table:align` — 열 정렬. **열 수가 그대로일 때만** 복원한다(열을 넣고 빼면 어긋나므로 버린다).
   * 보존은 하지만 `unsupported` 보고는 **유지한다** — 정렬 편집 UI가 M35 범위라, 편집 표면에
   * 올리지 않은 값이 조용히 따라다니는 것을 사용자가 알아야 한다(R34 판정 대기 3종).
   */
  tableAlign?: (('left' | 'right' | 'center') | null)[]
}

/** 블록 id → 사이드카 항목. */
export type AdapterSidecar = Record<string, AdapterSidecarEntry>

export interface ToBlockNoteResult {
  /** **`unsupported`가 비어 있을 때만 유효하다**(부분 변환분을 편집 표면에 올리지 말 것). */
  blocks: BnBlock[]
  unsupported: AdapterIssue[]
  /** 역변환(`fromBlockNoteBlocks(blocks, sidecar)`)에 그대로 넘기면 흡수분이 복원된다. */
  sidecar: AdapterSidecar
}
