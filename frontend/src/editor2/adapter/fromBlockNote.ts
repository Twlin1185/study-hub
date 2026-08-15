// BlockNote 블록 JSON → 앱 중립 블록 (M33 / stage-33 F-4 · 규약 B)
//
// **순수 JSON 변환**(에디터 인스턴스·`@blocknote/*` import 없음). 저장 경로의 첫 단계다:
//   BlockNote 문서 → **여기** → `blocksToMarkdown` 프로젝션 → `PATCH {content_blocks, content}`
//
// 규약:
//   · **id 왕복 보존** — BlockNote가 부여한 id를 앱 블록 `id`로 그대로 쓴다(동형성 비교 제외 필드).
//   · **규약 D(말미 빈 문단 트림)** — 문서 **말미**의 연속 빈 문단은 1개만 남긴다. 저장 직전 이
//     한 곳에서만 적용한다(화면 코드에 흩뿌리지 않는다). 본문 중간의 빈 문단은 불변이며
//     Markdown 프로젝션에서만 사라진다(프로젝션 비대칭 계약).
//   · BlockNote의 줄바꿈(텍스트 안 `\n`)은 **softBreak**로 읽는다(toBlockNote 주석 참조).
//   · 이 함수는 **항상 성공한다** — 저장 경로가 막히면 안 되기 때문이다. 앱 모델이 표현하지
//     못하는 편집기 고유 표현(표 열 너비·셀 병합·이미지 파일명 등)은 프로젝션 대상이 아니므로
//     담지 않는다(GFM에 대응물이 없다 — 아래 표 참조).
//
// 앱 모델에 대응물이 없어 저장 시 남지 않는 편집기 표현(알려진 경계 — stage-33 보고 대상):
//   | 편집기 표현            | 사유 |
//   |------------------------|------|
//   | 표 열 너비(columnWidths) | GFM 표에 열 너비 표기가 없다 |
//   | 표 셀 병합(colspan/rowspan) | GFM 표가 병합 셀을 표현하지 못한다 |
//   | 이미지 파일명(name)·미리보기 토글(showPreview) | Markdown 이미지에 대응 필드가 없다 |
import { BLOCK_SCHEMA_VERSION } from '../schema/blocks'
import type { Block, BlockDocument, InlineNode, InlineStyles, ListItemBlock } from '../schema/blocks'
import type { BnBlock, BnInline, BnStyles, BnTableCell, BnTableRow } from './types'

let fallbackId = 0

function idOf(block: { id?: string }): string {
  return block.id ?? `bn${++fallbackId}`
}

// ---------------------------------------------------------------- 인라인

function appStyles(styles: BnStyles | undefined): InlineStyles | undefined {
  const out: InlineStyles = {}
  let any = false
  if (styles?.bold) {
    out.bold = true
    any = true
  }
  if (styles?.italic) {
    out.italic = true
    any = true
  }
  if (styles?.strike) {
    out.strike = true
    any = true
  }
  if (styles?.underline) {
    out.underline = true
    any = true
  }
  return any ? out : undefined
}

function sameAppStyles(a: InlineStyles | undefined, b: InlineStyles | undefined): boolean {
  return (
    !!a?.bold === !!b?.bold &&
    !!a?.italic === !!b?.italic &&
    !!a?.strike === !!b?.strike &&
    !!a?.underline === !!b?.underline
  )
}

function withStyles<T extends InlineNode>(node: T, styles: InlineStyles | undefined): T {
  if (styles) node.styles = styles
  return node
}

/** 텍스트 run을 `\n` 기준으로 잘라 softBreak를 끼워 넣는다(BlockNote 줄바꿈 = `\n`). */
function pushTextRun(out: InlineNode[], text: string, styles: InlineStyles | undefined, code: boolean) {
  const parts = text.split('\n')
  parts.forEach((part, i) => {
    if (i > 0) out.push(withStyles({ type: 'softBreak' } as InlineNode, styles))
    if (part === '') return
    if (code) {
      out.push(withStyles({ type: 'inlineCode', value: part } as InlineNode, styles))
      return
    }
    const last = out[out.length - 1]
    if (last && last.type === 'text' && sameAppStyles(last.styles, styles)) {
      last.text += part
      return
    }
    out.push(withStyles({ type: 'text', text: part } as InlineNode, styles))
  })
}

function inlineToApp(nodes: BnInline[] | undefined): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes ?? []) {
    if (node.type === 'link') {
      const children: InlineNode[] = []
      for (const child of node.content ?? []) {
        pushTextRun(children, child.text ?? '', appStyles(child.styles), !!child.styles?.code)
      }
      out.push({ type: 'link', url: node.href ?? '', children })
      continue
    }
    pushTextRun(out, node.text ?? '', appStyles(node.styles), !!node.styles?.code)
  }
  return out
}

function cellToApp(cell: BnInline[] | BnTableCell): InlineNode[] {
  if (Array.isArray(cell)) return inlineToApp(cell)
  return inlineToApp(cell?.content)
}

// ---------------------------------------------------------------- 블록

function childrenToApp(block: BnBlock): Block[] | undefined {
  const kids = blocksToApp(block.children)
  return kids.length > 0 ? kids : undefined
}

function listItemToApp(block: BnBlock, ordered: boolean, checked?: boolean): ListItemBlock {
  const item: ListItemBlock = {
    id: idOf(block),
    type: 'listItem',
    ordered,
    content: inlineToApp('content' in block ? (block.content as BnInline[]) : []),
  }
  if (checked !== undefined) item.checked = checked
  const kids = childrenToApp(block)
  if (kids) item.children = kids
  return item
}

function blockToApp(block: BnBlock): Block | null {
  switch (block.type) {
    case 'paragraph': {
      const out: Block = { id: idOf(block), type: 'paragraph', content: inlineToApp(block.content) }
      // 문단의 자식 블록(BlockNote는 어떤 블록이든 중첩할 수 있다)은 앱 모델에 자리가 없으므로
      // **형제로 편다** — 내용이 사라지는 경로를 만들지 않는다.
      return out
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(block.props?.level ?? 1))) as 1 | 2 | 3 | 4 | 5 | 6
      return { id: idOf(block), type: 'heading', level, content: inlineToApp(block.content) }
    }
    case 'bulletListItem':
      return listItemToApp(block, false)
    case 'numberedListItem': {
      const item = listItemToApp(block, true)
      const start = block.props?.start
      if (typeof start === 'number') item.start = start
      return item
    }
    case 'checkListItem':
      return listItemToApp(block, false, !!block.props?.checked)
    case 'quote': {
      const id = idOf(block)
      const kids = blocksToApp(block.children)
      const content = inlineToApp(block.content)
      // toBlockNote의 끌어올리기 규칙(첫 자식이 "내용 있는 문단"일 때만)과 대칭:
      // 인라인이 비었으면 앞에 빈 문단을 만들지 않는다.
      const children =
        content.length > 0 ? [{ id: `${id}-p`, type: 'paragraph', content } as Block, ...kids] : kids
      return { id, type: 'quote', children }
    }
    case 'codeBlock': {
      const code = (block.content ?? []).map((run) => run.text ?? '').join('')
      const language = block.props?.language
      const info = block.props?.info
      const out: Block = { id: idOf(block), type: 'codeBlock', code }
      // 'text'는 BlockNote의 "언어 없음" 기본값이다 — 펜스에 언어를 붙이지 않는다.
      if (language && language !== 'text') out.language = language
      if (info) out.info = info
      return out
    }
    case 'table': {
      const rows: BnTableRow[] = block.content?.rows ?? []
      const cols = rows.reduce((max, row) => Math.max(max, (row.cells ?? []).length), 0)
      return {
        id: idOf(block),
        type: 'table',
        // 열 정렬은 편집 표면에 없다(stage-33) — 언제나 미지정.
        align: new Array(cols).fill(null),
        rows: rows.map((row) => (row.cells ?? []).map((cell) => cellToApp(cell))),
      }
    }
    case 'image': {
      const out: Block = {
        id: idOf(block),
        type: 'image',
        url: block.props?.url ?? '',
        alt: block.props?.caption ?? '',
      }
      const width = block.props?.previewWidth
      if (typeof width === 'number' && width > 0) out.width = Math.round(width)
      return out
    }
    case 'divider':
      return { id: idOf(block), type: 'divider' }
    default:
      return null
  }
}

function blocksToApp(blocks: BnBlock[] | undefined): Block[] {
  const out: Block[] = []
  for (const block of blocks ?? []) {
    const converted = blockToApp(block)
    if (!converted) continue
    out.push(converted)
    // 문단·헤딩·이미지 등 "자식을 담을 수 없는" 앱 블록의 BlockNote 자식은 형제로 편다.
    if (converted.type !== 'listItem' && converted.type !== 'quote' && block.children?.length) {
      out.push(...blocksToApp(block.children))
    }
  }
  return out
}

function isEmptyParagraph(block: Block | undefined): boolean {
  return !!block && block.type === 'paragraph' && block.content.length === 0
}

/**
 * 규약 D — 문서 **말미**의 연속 빈 문단을 1개만 남긴다.
 * (BlockNote가 말미 빈 문단을 항상 유지하므로 트림이 없으면 저장할 때마다 누적된다.)
 */
function trimTrailingEmptyParagraphs(blocks: Block[]): Block[] {
  let end = blocks.length
  while (end >= 2 && isEmptyParagraph(blocks[end - 1]) && isEmptyParagraph(blocks[end - 2])) end -= 1
  return end === blocks.length ? blocks : blocks.slice(0, end)
}

/** BlockNote 블록 JSON → 앱 블록 문서(저장 대상 `content_blocks`). */
export function fromBlockNoteBlocks(blocks: BnBlock[] | undefined): BlockDocument {
  return {
    version: BLOCK_SCHEMA_VERSION,
    blocks: trimTrailingEmptyParagraphs(blocksToApp(blocks)),
  }
}
