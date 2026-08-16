// 에디터 v2 — 붙여넣기 파이프라인(stage-34 G-10, 규약 G).
//
// 세 갈래(구현 힌트 순서 그대로 — 이미지 우선 판정이 핵심이다):
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
import type { BnBlock, BnInline, BnStyledText } from '../adapter'
// `BnStyles`·`BnTableCell`·`BnTableContent`·`BnTableRow`는 어댑터의 **공개 배럴**(`adapter/index.ts`)
// 에는 재수출되어 있지 않다. 그 배럴은 절대 불변 파일이 아니다 — 실제로 stage-34 Phase 1에서
// 순수 추가 8줄로 확장된 이력이 있다(헤더 주석의 "stage-34 확장" 표기가 그 흔적이다). 다만
// **이번 사이클엔 내 담당 범위 밖**(수정 금지 — 파일 소유 규약)이라 손대지 않고, 배럴을
// 건드리지 않는 선에서 구조 타입만 선언 파일(`adapter/types.ts`)에서 직접 import한다(런타임
// 코드는 여전히 배럴 `../adapter`만 쓴다).
import type { BnStyles, BnTableCell, BnTableContent, BnTableRow } from '../adapter/types'
import type { InlineStyles } from '../schema/blocks'
import { asEditorBlocks, type NoteBlockNoteEditor } from './schema'
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

// ---------------------------------------------------------------- 커서 삽입(빈 문단이면 대체)

function isEmptyParagraphAnchor(block: { type: string; content?: unknown }): boolean {
  return block.type === 'paragraph' && Array.isArray(block.content) && block.content.length === 0
}

function insertAtCursor(editor: NoteBlockNoteEditor, blocks: BnBlock[]): void {
  if (blocks.length === 0) return
  const current = editor.getTextCursorPosition().block
  const editorBlocks = asEditorBlocks(blocks)
  if (isEmptyParagraphAnchor(current)) {
    editor.replaceBlocks([current.id], editorBlocks)
  } else {
    editor.insertBlocks(editorBlocks, current, 'after')
  }
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
      const markdown = htmlToDialectMarkdown(html)
      const doc = markdownToBlocks(markdown)
      // `converted.sidecar`(링크 title·표 정렬 등 규약 I 흡수분)는 여기서 **의도적으로 버린다**
      // — 오늘은 안전하다: `htmlToDialectMarkdown`이 `<a title=…>`를 방출하지 않고(링크 title 없음)
      // 표 변환(`convertTable`)도 구분행을 `---`로만 찍어 정렬을 방출하지 않으므로, HTML 붙여넣기
      // 경로의 `sidecar`는 지금 **항상 빈 객체**다. **`htmlToDialectMarkdown`이 확장돼 title·정렬
      // 같은 흡수분을 방출하게 되면, 그때는 이 sidecar를 조용히 버리면 안 된다** — 노트 저장 시
      // `fromBlockNoteBlocks(editorDoc, sidecar)`를 부르는 상위 저장 경로(`NoteEditPage.tsx`의
      // `buildBody`)가 들고 있는 세션 사이드카에 이 삽입분을 병합해 주어야 한다(현재는 그 결선
      // 자체가 없다 — sidecar 없이 `fromBlockNoteBlocks`를 부르는 새 호출부가 이 지점 1곳 존재).
      const converted = toBlockNoteBlocks(doc)
      const { blocks, collapsed } = collapseBlocks(converted.blocks)

      insertAtCursor(editor, blocks)

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
