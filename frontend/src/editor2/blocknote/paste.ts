// 에디터 v2 — 붙여넣기 파이프라인(stage-34 G-10, 규약 G).
//
// 네 갈래(⓪ 이후는 구현 힌트 순서 그대로 — 이미지 우선 판정이 핵심이다):
//   ⓪ `blocknote/html`(에디터 내부 복사의 무손실 포맷)이 있으면 → 기본 핸들러에 통째로 위임.
//      내부 복사·붙여넣기는 방언 변환기를 타면 안 된다(2026-08-21 실사용 재현 — 본체 ⓪ 주석).
//   ① `clipboardData.files`에 **이미지가 1개 이상** 있으면 → 규약 H 업로드 루프(`uploads.ts`
//      공유)로 처리하고 여기서 끝낸다(`return true`). **HTML 분기보다 먼저 검사한다** — Word/웹
//      붙여넣기는 `text/html`과 실제 이미지 `Files`를 동시에 실어 보내는 경우가 흔하고, BlockNote
//      0.54 기본 판정 순서(`acceptedMIMETypes`)는 `text/html`을 `Files`보다 먼저 보므로 그대로
//      두면 이미지가 통째로 사라진다(실측).
//      비이미지 파일이 섞여 있으면(이 앱 스키마에 범용 file 블록이 없다) **조용히 무시하지
//      않는다** — 건너뛴 개수를 `describeSkippedNonImageFiles`로 `pasteNotice`에 알린다(DoD 4·6
//      "조용한 손실 0" — 드래그앤드롭도 `NoteEditPage.tsx`가 같은 문구·같은 배너 경로를 공유한다).
//      **단, 이미지가 0개면 이 분기에서 이벤트를 끝내지 않는다** — 파일 탐색기에서 복사한 PDF나
//      일부 앱의 "첨부+본문" 클립보드처럼 이미지 없이 비이미지 파일만 실려 왔을 때, 같은
//      클립보드의 `text/html` 본문(②)까지 통째로 버려지던 사고(검토 경미-1)를 막는다 — 안내는
//      쌓아 두고(`notices`) 아래 ②·③으로 계속 흘려보낸다.
//   ② `text/html`이 있으면 → 기존 화이트리스트 변환기(`htmlToDialectMarkdown`, import만·무수정)
//      → `markdownToBlocks` → 어댑터(`toBlockNoteBlocks`) → 규약 C(마이크로 상호 배타) 강제
//      → 커서 위치에 삽입. 정화 규칙이 앱에 이 경로 1벌만 남는다(F52 raw HTML 기각 방어선 유지).
//   ③ HTML도 없으면 → 이미지 없이 비이미지 파일만 있었던 경우(①에서 흘러온 경우)는 BlockNote
//      기본 `defaultPasteHandler`에 위임하지 않는다 — 그 내부 로직이 `Files` 포맷을 만나면 이
//      스키마에 없는 범용 `file` 블록 타입으로 삽입을 시도해 실패할 위험이 있다. 대신 같은
//      클립보드의 `text/plain`만(있다면) `editor.pasteText`로 직접 살린다. 파일이 아예 없었던
//      "진짜 평문 붙여넣기"만 **가로채지 않는다** — BlockNote 공식 `pasteHandler` 훅의
//      `defaultPasteHandler({ plainTextAsMarkdown: false })`에 위임해 Markdown으로 해석되지
//      않게만 만든다(평문 속 `*`·`#`이 서식으로 둔갑하는 사고 방지).
//
// BlockNote 0.54는 붙여넣기 커스터마이즈용 공식 지점(`useCreateBlockNote({ pasteHandler })`)을
// 제공한다(`@blocknote/core` `pasteExtension.ts` 실측 — 라이브러리가 이미 `event.preventDefault()`를
// 호출하고 이 콜백에 전권을 위임하는 구조라 DOM 레벨 캡처 가로채기가 필요 없다).
//
// **`unsupported` 처리가 어댑터 로드 경로와 다른 이유**: `toBlockNote.ts`의 `ToBlockNoteResult`
// 주석은 "blocks는 unsupported가 빈 배열일 때만 편집 표면에 올려도 된다"고 못박는다 — 하지만 그건
// **노트 전체 로드**(NoteEditPage의 `NoteEditor`) 얘기다. 문서 하나를 통째로 올릴지 말지는 전부-
// 아니면-전무라 읽기 전용 폴백이 맞다. **여기(붙여넣기)는 삽입 단위가 훨씬 작고 방금 사용자가
// 한 조작**이라 전부-아니면-전무로 버리면 손실이 더 크다 — 그래서 `blocks`(부분 변환분 포함,
// `blocksToBn`이 null만 걸러내 항상 구조적으로 유효하다)를 그대로 삽입하고 `unsupported`는
// 안내 문구로만 알린다. 두 경로 모두 "조용히 버리지 않는다"는 같은 원칙의 다른 적용이다.
import { htmlToDialectMarkdown } from '../../utils/htmlPasteMarkdown'
import { markdownToBlocks } from '../transform'
import { collapseMicroMarks, describeUnsupported, toBlockNoteBlocks } from '../adapter'
import type { AdapterSidecar, BnBlock, BnInline, BnStyledText } from '../adapter'
// `BnStyles`·`BnTableCell`·`BnTableContent`·`BnTableRow`는 어댑터의 **공개 배럴**(`adapter/index.ts`)
// 에는 재수출되어 있지 않다. 그 배럴은 절대 불변 파일이 아니다 — 실제로 stage-34 Phase 1에서
// 순수 추가 8줄로 확장된 이력이 있다(헤더 주석의 "stage-34 확장" 표기가 그 흔적이다). 다만
// **이번 사이클엔 내 담당 범위 밖**(수정 금지 — 파일 소유 규약)이라 손대지 않고, 배럴을
// 건드리지 않는 선에서 구조 타입만 선언 파일(`adapter/types.ts`)에서 직접 import한다(런타임
// 코드는 여전히 배럴 `../adapter`만 쓴다).
import type { BnStyles, BnTableCell, BnTableContent, BnTableRow } from '../adapter/types'
import type { InlineStyles } from '../schema/blocks'
import { asEditorBlocks, type NoteBlockNoteEditor } from './schema'
import { expandLooseLists } from './looseList'
import { describeSkippedNonImageFiles, insertUploadedImages, isImageFile } from './uploads'

// ---------------------------------------------------------------- 규약 C 강제 지점 ③
//
// `collapseMicroMarks`(어댑터 `marks.ts`)는 앱 스키마의 `InlineStyles`(`t?: AttrPair[]`)를
// 다루고, 붙여넣기가 다루는 값은 어댑터의 `BnStyles`(`t?: string` — JSON 인코딩)다. 두 타입은
// `bold`~`spoiler` 6개 불리언 필드가 동일하고 `collapseMicroMarks`는 그 6개만 읽고 지운다
// (`t`는 그대로 spread 보존) — 그래서 경계 캐스트 1쌍으로 안전하게 재사용한다
// (`blocknote/schema.ts`의 어댑터↔편집기 경계 캐스트와 같은 전례).
function collapseBnStyles(styles: BnStyles): { styles: BnStyles; removed: number } {
  const result = collapseMicroMarks(styles as unknown as InlineStyles)
  if (result.removed.length === 0) return { styles, removed: 0 }
  return { styles: result.styles as unknown as BnStyles, removed: result.removed.length }
}

function collapseInlineList(list: BnInline[]): { list: BnInline[]; collapsed: number } {
  let collapsed = 0
  const next = list.map((item): BnInline => {
    if (item.type === 'text') {
      const result = collapseBnStyles(item.styles)
      if (result.removed === 0) return item
      collapsed += result.removed
      return { ...item, styles: result.styles }
    }
    if (item.type === 'link') {
      const inner = collapseInlineList(item.content)
      collapsed += inner.collapsed
      return inner.collapsed > 0 ? { ...item, content: inner.list as BnStyledText[] } : item
    }
    return item
  })
  return { list: next, collapsed }
}

function collapseTableCell(cell: BnInline[] | BnTableCell): { cell: BnInline[] | BnTableCell; collapsed: number } {
  if (Array.isArray(cell)) {
    const inner = collapseInlineList(cell)
    return { cell: inner.list, collapsed: inner.collapsed }
  }
  const inner = collapseInlineList(cell.content)
  if (inner.collapsed === 0) return { cell, collapsed: 0 }
  return { cell: { ...cell, content: inner.list }, collapsed: inner.collapsed }
}

function collapseTableContent(content: BnTableContent): { content: BnTableContent; collapsed: number } {
  let collapsed = 0
  const rows = content.rows.map((row: BnTableRow): BnTableRow => {
    const cells = (row.cells as (BnInline[] | BnTableCell)[]).map((cell) => {
      const result = collapseTableCell(cell)
      collapsed += result.collapsed
      return result.cell
    })
    return { cells } as BnTableRow
  })
  return { content: collapsed > 0 ? { ...content, rows } : content, collapsed }
}

function collapseBlock(block: BnBlock): { block: BnBlock; collapsed: number } {
  let collapsed = 0
  let next: BnBlock = block

  if (block.type === 'table') {
    const result = collapseTableContent(block.content)
    collapsed += result.collapsed
    if (result.collapsed > 0) next = { ...block, content: result.content }
  } else if ('content' in block && Array.isArray((block as { content?: unknown }).content)) {
    const result = collapseInlineList((block as unknown as { content: BnInline[] }).content)
    collapsed += result.collapsed
    if (result.collapsed > 0) next = { ...next, content: result.list } as BnBlock
  }

  if (block.children && block.children.length > 0) {
    const childResult = collapseBlocks(block.children)
    collapsed += childResult.collapsed
    if (childResult.collapsed > 0) next = { ...next, children: childResult.blocks }
  }

  return { block: next, collapsed }
}

/** 어댑터 산출 블록 트리 전체를 훑어 마이크로 마크 상호 배타(규약 C)를 강제한다. 접힌 건수는
 * 조용히 버리지 않고 합산해 돌려준다(호출부가 사용자에게 한 줄로 알린다). */
export function collapseBlocks(blocks: BnBlock[]): { blocks: BnBlock[]; collapsed: number } {
  let collapsed = 0
  const out = blocks.map((block) => {
    const result = collapseBlock(block)
    collapsed += result.collapsed
    return result.block
  })
  return { blocks: out, collapsed }
}

// ---------------------------------------------------------------- 붙여넣기 블록 id 재발급
//
// **왜 필요한가**: `mdastToBlocks.nextId`는 변환 1회마다 `b1, b2, …`를 **결정적으로** 발급한다.
// 그래서 붙여넣기로 만든 블록 id가 이미 문서에 있는 블록 id와 정면으로 겹친다(본문도 같은 변환기가
// 만든 것이라면 `b1`부터 시작한다). BlockNote의 UniqueID 플러그인은 **바뀐 범위(newRange) 안의**
// 중복만 재발급하므로, 멀리 떨어진 자리에 같은 id를 밀어 넣으면 **중복 id가 그대로 남는다**(실측).
// 사이드카는 블록 id를 키로 쓰므로, 중복이 남으면 `sidecar['b3']` 하나가 **서로 다른 두 블록**에
// 적용된다 — 링크 제목·표 정렬이 엉뚱한 블록으로 번지는 조용한 오염이다.
//
// 종전에는 붙여넣기 사이드카를 통째로 버렸으므로 이 위험이 잠재적이었지만, 흡수 3종(느슨한 목록·
// 목록 경계·표 정렬)이 들어오면서 사이드카가 실제로 채워지는 빈도가 크게 올랐다. 그래서 삽입 **전에**
// 블록 id를 이 세션에서 유일한 값으로 갈아 끼우고 사이드카 키도 같이 옮긴다. 접두사 `pasted-`는
// 변환기(`b<n>`)와도 BlockNote 기본 id(UUID v4)와도 절대 겹치지 않는다.
let pasteIdSeq = 0

function nextPastedId(): string {
  pasteIdSeq += 1
  return `pasted-${Date.now().toString(36)}-${pasteIdSeq}`
}

function collectIdMap(blocks: BnBlock[], map: Map<string, string>): void {
  for (const block of blocks) {
    if (block.id !== undefined && !map.has(block.id)) map.set(block.id, nextPastedId())
    if (block.children?.length) collectIdMap(block.children, map)
  }
}

function applyIdMap(blocks: BnBlock[], map: Map<string, string>): BnBlock[] {
  return blocks.map((block) => {
    const next = { ...block } as BnBlock
    if (block.id !== undefined) next.id = map.get(block.id) ?? block.id
    if (block.children?.length) next.children = applyIdMap(block.children, map)
    return next
  })
}

/**
 * 붙여넣기 변환 결과의 블록 id를 세션 유일 id로 갈아 끼우고, 사이드카 키도 함께 옮긴다.
 *
 * quote 끌어올리기 주의: `toBlockNote`는 끌어올린 첫 문단의 사이드카를 **`${quoteId}-p`** 키로
 * 적는다(`adapter/types.ts` 사이드카 절). 그 키는 문서에 존재하는 블록 id가 아니므로 위 맵에
 * 잡히지 않는다 — `-p` 접미사를 벗겨 부모 quote id로 찾아 같은 규칙으로 다시 붙인다.
 */
function reassignPastedIds(
  blocks: BnBlock[],
  sidecar: AdapterSidecar,
): { blocks: BnBlock[]; sidecar: AdapterSidecar } {
  const map = new Map<string, string>()
  collectIdMap(blocks, map)

  const nextSidecar: AdapterSidecar = {}
  for (const [key, entry] of Object.entries(sidecar)) {
    const direct = map.get(key)
    if (direct) {
      nextSidecar[direct] = entry
      continue
    }
    if (key.endsWith('-p')) {
      const parent = map.get(key.slice(0, -2))
      if (parent) {
        nextSidecar[`${parent}-p`] = entry
        continue
      }
    }
    // 어느 블록에도 매달리지 않는 항목(도달 불가) — 옮겨 봐야 복원되지 않으므로 버린다.
    // 실제로 여기 오는 경로는 없다(사이드카 키는 전부 변환한 블록 id에서 나온다).
  }
  return { blocks: applyIdMap(blocks, map), sidecar: nextSidecar }
}

// ---------------------------------------------------------------- 커서 삽입(빈 문단 대체 · 인라인)

function isEmptyParagraphAnchor(block: { type: string; content?: unknown }): boolean {
  return block.type === 'paragraph' && Array.isArray(block.content) && block.content.length === 0
}

/**
 * 커서가 놓인 블록이 **인라인 삽입을 받아도 구조가 깨지지 않는 자리**인지(검토 중요-3).
 * 코드 블록·수식 블록은 `content`가 배열이어도 **평문 전용**이라 서식 있는 인라인(굵게·링크·
 * 참조 칩 등)이 섞이면 그 제약이 깨진다 — 후보에서 뺀다. 표 셀 안에서는 `getTextCursorPosition()`
 * 이 셀이 아니라 **표 블록 자체**를 돌려주고, 표 블록의 `content`는 배열이 아닌 `tableContent`
 * 객체이므로 아래 `Array.isArray` 검사에서 자연히 걸러진다(별도 표 셀 판정 불필요).
 */
function supportsInlineInsertion(block: { type: string; content?: unknown }): boolean {
  return Array.isArray(block.content) && block.type !== 'codeBlock' && block.type !== 'mathBlock'
}

/** 변환 결과가 **문단 1개뿐**(children 없음)인지 — 이때만 인라인 삽입 후보다. 다중 블록이거나
 * 비문단 블록(제목·목록·표…)이 하나라도 섞이면 문단 경계를 넘으므로 블록 삽입 그대로 둔다. */
function isSingleInlineParagraph(
  blocks: BnBlock[],
): blocks is [Extract<BnBlock, { type: 'paragraph' }>] {
  if (blocks.length !== 1) return false
  const [only] = blocks
  return only.type === 'paragraph' && (!only.children || only.children.length === 0)
}

function asInlineContent(content: BnInline[]): Parameters<NoteBlockNoteEditor['insertInlineContent']>[0] {
  return content as unknown as Parameters<NoteBlockNoteEditor['insertInlineContent']>[0]
}

function insertAtCursor(editor: NoteBlockNoteEditor, blocks: BnBlock[]): void {
  if (blocks.length === 0) return
  const current = editor.getTextCursorPosition().block

  // 빈 문단에 붙여넣을 때는(커서가 놓인 빈 줄) 그 문단을 통째로 대체한다 — 빈 문단이 남지
  // 않는 기존 동작이 옳다(이 경로는 이번 수정 대상이 아니다).
  if (isEmptyParagraphAnchor(current)) {
    editor.replaceBlocks([current.id], asEditorBlocks(blocks))
    return
  }

  // 중요-3(2라운드 검토, 34ef43f부터 있던 결함) — 문장 한가운데 붙여넣기가 커서 위치를 무시한 채
  // 항상 "아랫줄에 새 문단"으로 떨어지던 문제. 변환 결과가 **단일 문단**이고 커서 자리가 인라인
  // 삽입을 받을 수 있으면 `insertInlineContent`로 커서 위치에 밀어 넣는다 — 선택이 있으면
  // ProseMirror가 그 선택 범위를 그대로 대체한다(`StyleManager.insertInlineContent`가
  // `tr.selection.from/to`를 삽입 범위로 쓴다 — 붙여넣기 표준 동작). 다중 블록·비문단 블록·
  // 코드 블록/표 안 같은 자리는 문단 경계를 넘으므로 여전히 블록 삽입으로 떨어뜨린다(구조가
  // 깨지는 쪽보다 "새 줄에 삽입"이 안전하다).
  if (isSingleInlineParagraph(blocks) && supportsInlineInsertion(current)) {
    editor.insertInlineContent(asInlineContent(blocks[0].content))
    return
  }

  editor.insertBlocks(asEditorBlocks(blocks), current, 'after')
}

// ---------------------------------------------------------------- pasteHandler 본체

export interface PasteHandlerDeps {
  /** 이미지 3진입점 공유 업로드(규약 H) — `uploads.ts`의 `useImageUploadQueue().uploadFile`. */
  runUpload: (file: File) => Promise<string>
  /** 파일 개수를 미리 아는 이 경로가 "N/M" 진행 표시를 정확히 맞춘다. */
  beginUploadBatch: (count: number) => void
  /** 미지원 보고·마이크로 마크 정리 집계·건너뛴 비이미지 파일 개수를 한 줄로 알린다(조용히
   * 버리지 않는다 — 여러 갈래가 겹치면 이 함수 호출 전에 이미 한 문자열로 합쳐져 들어온다). */
  onNotice: (message: string) => void
  /**
   * 붙여넣은 블록의 **사이드카 흡수분**(느슨한 목록·목록 경계·표 정렬·링크 제목·블록 메타)을
   * 편집 세션 사이드카에 합류시킨다 — 저장 시 `fromBlockNoteBlocks(doc, sidecar)`가 그 값을
   * 되살린다. 이 결선이 없으면 붙여넣기 경로에서만 흡수분이 **안내도 없이** 사라진다.
   * 키는 `reassignPastedIds`가 세션 유일 id로 바꾼 뒤라 기존 항목과 충돌하지 않는다.
   */
  mergeSidecar: (entries: AdapterSidecar) => void
}

interface PasteHandlerContext {
  event: ClipboardEvent
  editor: NoteBlockNoteEditor
  defaultPasteHandler: (opts?: {
    prioritizeMarkdownOverHTML?: boolean
    plainTextAsMarkdown?: boolean
  }) => boolean | undefined
}

/** `useCreateBlockNote({ pasteHandler })`에 그대로 꽂는 팩토리. */
export function createPasteHandler(deps: PasteHandlerDeps) {
  return (context: PasteHandlerContext): boolean | undefined => {
    const { event, editor, defaultPasteHandler } = context
    const clipboardData = event.clipboardData
    if (!clipboardData) return defaultPasteHandler({ plainTextAsMarkdown: false })

    // ⓪ 에디터 내부 복사 — BlockNote는 복사 시 무손실 내부 포맷(`blocknote/html`)을 함께 싣고,
    // 기본 핸들러는 acceptedMIMETypes 순서상 그것을 최우선으로 집어 원형 그대로 되살린다
    // (`pasteExtension.ts` 실측 — `pasteHTML(data, true)`; 붙여넣기로 생긴 중복 블록 id는 코어
    // `uniqueID` 플러그인이 자동으로 새 id를 발급한다 = 사이드카 키 오염 없음. 단 새 id가 되므로
    // 원본 블록의 사이드카 흡수분은 복사본에 승계되지 않는다 — looseList.ts 머리말 ①과 같은
    // 계열의 알려진 한계). 이 분기가 없으면 내부 복사분까지 아래 ②의 외부 HTML 방언 변환기를
    // 타서, 클립보드 HTML에 실린 테마 색 인라인 스타일이 색상 방언 `[…]{c= bg=}`으로 흡수되고
    // 커스텀 블록(콜아웃 등)이 방언 원문 노출로 뭉개진다(2026-08-21 실사용 재현 결함).
    // 내부 복사 클립보드에는 Files가 실리지 않으므로 ①의 이미지 우선 판정과 충돌하지 않는다.
    if (clipboardData.getData('blocknote/html')) return defaultPasteHandler()

    // 안내는 이 이벤트 안에서 여러 갈래가 동시에 쌓일 수 있다(예: 비이미지 파일 건너뜀 + HTML
    // 미지원 보고) — 낱개로 여러 번 알리면 뒤엣것이 앞엣것을 덮어써 버리므로(`pasteNotice`는
    // 배너 1개) 한데 모았다가 이벤트 끝에서 한 번만 `deps.onNotice`로 합쳐 띄운다.
    const notices: string[] = []
    const flushNotices = () => {
      if (notices.length > 0) deps.onNotice(notices.join(' · '))
    }

    // ① 이미지 파일 — text/html 유무와 무관하게 먼저 판정한다(위 머리말 사유). **이미지가
    // 1개 이상 있을 때만** 여기서 이벤트를 끝낸다 — 이미지가 0개면(비이미지 파일만 있거나
    // 파일이 아예 없음) 안내만 쌓아 두고 아래 ②·③으로 계속 흘려보낸다(검토 경미-1).
    const files = Array.from(clipboardData.files ?? [])
    const imageFiles = files.filter(isImageFile)
    const skippedFileCount = files.length - imageFiles.length
    // 비이미지 파일이 섞여 있으면(이 앱 스키마에 범용 file 블록이 없다) 조용히 버리지 않는다.
    if (skippedFileCount > 0) notices.push(describeSkippedNonImageFiles(skippedFileCount))

    if (imageFiles.length > 0) {
      deps.beginUploadBatch(imageFiles.length)
      void insertUploadedImages(editor, imageFiles, deps.runUpload)
      flushNotices()
      return true
    }

    // ② HTML — 앱 방언 화이트리스트 변환기 1벌만 탄다.
    const html = clipboardData.getData('text/html')
    if (html && html.trim()) {
      // 느슨한 목록 전처리(결함 U-3) — CommonMark 렌더러가 남긴 유일한 느슨함 표식(`<li><p>…`)이
      // 변환기에서 접혀 사라지므로, 그 전에 항목당 한 벌의 목록으로 펴 둔다(`looseList.ts` 머리말).
      // 표식이 없으면 원본 문자열을 그대로 돌려주므로 다른 붙여넣기 경로는 무접촉이다.
      const markdown = htmlToDialectMarkdown(expandLooseLists(html))
      const doc = markdownToBlocks(markdown)
      // `converted.sidecar`(규약 I 흡수분)는 **세션 사이드카에 병합한다** — 저장 시 역변환이
      // 되살린다. 종전 주석은 "이 경로의 sidecar는 항상 빈 객체라 버려도 무해하다"고 적고 있었지만
      // **그 전제는 더 이상 참이 아니다**(2026-08-17 R34 판정으로 느슨한 목록·목록 경계가 사이드카로
      // 흡수됐다): 예컨대 `<ul><li>A</li><li>B</li></ul><ul><li>C</li><li>D</li></ul>`는
      // `htmlToDialectMarkdown`이 목록 사이에 빈 줄을 넣어 방출하므로 4항목 전원이 `spread: true`가
      // 되고, 사이드카가 실제로 채워진다. 게다가 흡수 후에는 `unsupported`가 0건이라 **안내 배너도
      // 뜨지 않아** 완전히 조용한 손실이 된다 — 어댑터 계약(`types.ts` `AdapterIssue` 주석) 위반.
      // 그래서 여기서 버리지 않고 상위 저장 경로(`NoteEditPage.tsx`의 `buildBody`)가 들고 있는
      // 세션 사이드카로 넘긴다.
      const converted = toBlockNoteBlocks(doc)
      // 삽입 **전에** 블록 id를 세션 유일 값으로 갈아 끼운다(사이드카 키 오염 방지 — 위 절 참조).
      const fresh = reassignPastedIds(converted.blocks, converted.sidecar)
      const { blocks, collapsed } = collapseBlocks(fresh.blocks)

      insertAtCursor(editor, blocks)
      deps.mergeSidecar(fresh.sidecar)

      if (converted.unsupported.length > 0) notices.push(describeUnsupported(converted.unsupported))
      if (collapsed > 0) notices.push(`중첩된 마이크로 서식 ${collapsed}건은 1개만 남기고 정리했습니다`)
      flushNotices()

      return true
    }

    // ③ HTML도 없다. 파일이 있었다면(①에서 흘러온 비이미지 파일뿐인 경우) BlockNote 기본
    // `defaultPasteHandler`에 위임하지 않는다 — 그 내부 로직이 `Files` 포맷을 만나면 이 스키마에
    // 없는 범용 `file` 블록 타입으로 삽입을 시도한다(회귀 위험). 대신 같은 클립보드의
    // `text/plain`만(있다면) 직접 살린다 — Markdown으로는 해석하지 않는다.
    if (files.length > 0) {
      const plainText = clipboardData.getData('text/plain')
      if (plainText) editor.pasteText(plainText)
      flushNotices()
      return true
    }

    // 파일이 아예 없었던 "진짜 평문 붙여넣기"만 가로채지 않는다(기본 동작에 맡기되 Markdown으로
    // 해석되지 않도록만 조정한다).
    flushNotices()
    return defaultPasteHandler({ plainTextAsMarkdown: false })
  }
}
