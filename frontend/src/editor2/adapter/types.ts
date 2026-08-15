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

/** 코어 범위 인라인 스타일(=우리가 채택한 styleSpecs 집합). 색 스타일은 **채택하지 않는다**. */
export interface BnStyles {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
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

export type BnInline = BnStyledText | BnLink

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

export interface BnImage extends BnBlockCommon {
  type: 'image'
  props: { url: string; caption?: string; previewWidth?: number; name?: string }
}

export interface BnDivider extends BnBlockCommon {
  type: 'divider'
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
] as const

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

export interface ToBlockNoteResult {
  /** **`unsupported`가 비어 있을 때만 유효하다**(부분 변환분을 편집 표면에 올리지 말 것). */
  blocks: BnBlock[]
  unsupported: AdapterIssue[]
}
