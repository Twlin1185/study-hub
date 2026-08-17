// BlockNote 블록 JSON → 앱 중립 블록 (M33 F-4 / M34 stage-34 G-8 · 규약 B)
//
// **순수 JSON 변환**(에디터 인스턴스·`@blocknote/*` import 없음). 저장 경로의 첫 단계다:
//   BlockNote 문서 → **여기** → `blocksToMarkdown` 프로젝션 → `PATCH {content_blocks, content}`
//
// 규약:
//   · **id 왕복 보존** — BlockNote가 부여한 id를 앱 블록 `id`로 그대로 쓴다(동형성 비교 제외 필드).
//   · **규약 D(말미 빈 문단 트림)** — 문서 **말미**의 연속 빈 문단은 1개만 남긴다. 저장 직전 이
//     한 곳에서만 적용한다(화면 코드에 흩뿌리지 않는다). 본문 중간의 빈 문단은 불변이며
//     Markdown 프로젝션에서만 사라진다(프로젝션 비대칭 계약).
//   · BlockNote의 줄바꿈(텍스트 안 `\n`)은 **softBreak**로 읽는다. 경성 줄바꿈은 원자 인라인
//     `lineBreak`가 따로 담는다(stage-34 규약 I 흡수 ①).
//   · **규약 C 방어적 정규화** — 마이크로 마크(밑줄·형광펜·스포일러)가 같은 구간에 2개 이상
//     걸려 있으면 `collapseMicroMarks`로 1개만 남긴다. 접은 건수는 `fromBlockNoteResult`가
//     **집계 보고**한다(조용히 접지 않는다).
//   · 이 함수는 **항상 성공한다** — 저장 경로가 막히면 안 되기 때문이다.
//
// 앱 모델에 대응물이 없어 저장 시 남지 않는 편집기 표현(알려진 경계):
//   | 편집기 표현            | 사유 |
//   |------------------------|------|
//   | 표 열 너비(columnWidths) | GFM 표에 열 너비 표기가 없다 |
//   | 표 셀 병합(colspan/rowspan) | GFM 표가 병합 셀을 표현하지 못한다 |
//   | 이미지 파일명(name)·미리보기 토글(showPreview) | Markdown 이미지에 대응 필드가 없다 |
import { BLOCK_SCHEMA_VERSION } from '../schema/blocks'
import type {
  AttrPair,
  Block,
  BlockDocument,
  InlineNode,
  InlineStyles,
  ListItemBlock,
} from '../schema/blocks'
import { collapseMicroMarks } from './marks'
import type { MicroMark } from './marks'
import type {
  AdapterSidecar,
  AdapterSidecarEntry,
  BnBlock,
  BnInline,
  BnStyledText,
  BnStyles,
  BnTableCell,
  BnTableRow,
} from './types'

let fallbackId = 0

function idOf(block: { id?: string }): string {
  return block.id ?? `bn${++fallbackId}`
}

interface Ctx {
  sidecar: AdapterSidecar
  /** 규약 C 방어적 정규화로 접은 마이크로 마크 목록(집계 보고용). */
  collapsed: MicroMark[]
  /**
   * 사이드카에 표 열 정렬이 있는데 **열 수가 달라져 되살리지 못한** 표의 블록 id.
   * 흡수(R34 판정)로 로드 시점 보고가 사라진 대신, 실제로 값이 폐기되는 **저장 시점**에
   * 여기서 집계해 보고한다 — `collapsed`(마이크로 마크)와 같은 "조용히 버리지 않는다" 장치다.
   */
  alignDrops: string[]
  /** 지금 읽고 있는 블록의 사이드카 항목. */
  entry: AdapterSidecarEntry | undefined
}

// ---------------------------------------------------------------- 인라인

/** `:t` prop 문자열 → 속성 쌍. 형태가 깨져 있으면 **버리지 않고 무시**한다(저장 경로는 막히지 않는다). */
function decodeAttrPairs(value: string | undefined): AttrPair[] | undefined {
  if (!value) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const out: AttrPair[] = []
  for (const pair of parsed) {
    if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
      out.push([pair[0], pair[1]])
    }
  }
  return out.length > 0 ? out : undefined
}

function appStyles(ctx: Ctx, styles: BnStyles | undefined): InlineStyles | undefined {
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
  if (styles?.highlight) {
    out.highlight = true
    any = true
  }
  if (styles?.spoiler) {
    out.spoiler = true
    any = true
  }
  const pairs = decodeAttrPairs(styles?.t)
  if (pairs) {
    out.t = pairs
    any = true
  }
  if (!any) return undefined
  // 규약 C — 마이크로 마크 상호 배타(접은 건수는 집계해 보고한다).
  const collapsed = collapseMicroMarks(out)
  ctx.collapsed.push(...collapsed.removed)
  return collapsed.styles
}

/** 원자 인라인의 `styles` prop(JSON) → 앱 서식. */
function decodeInlineStyles(ctx: Ctx, value: string | undefined): InlineStyles | undefined {
  if (!value) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  return appStyles(ctx, parsed as BnStyles)
}

function sameAppStyles(a: InlineStyles | undefined, b: InlineStyles | undefined): boolean {
  return (
    !!a?.bold === !!b?.bold &&
    !!a?.italic === !!b?.italic &&
    !!a?.strike === !!b?.strike &&
    !!a?.underline === !!b?.underline &&
    !!a?.highlight === !!b?.highlight &&
    !!a?.spoiler === !!b?.spoiler &&
    JSON.stringify(a?.t ?? null) === JSON.stringify(b?.t ?? null)
  )
}

function withStyles<T extends InlineNode>(node: T, styles: InlineStyles | undefined): T {
  if (styles) node.styles = styles
  return node
}

/**
 * 텍스트 run을 `\n` 기준으로 잘라 softBreak를 끼워 넣는다(BlockNote 줄바꿈 = `\n`).
 *
 * **run 끝의 `\n`은 서식을 싣지 않는다**(실측 대응): BlockNote는 PM 문서를 되읽을 때 `hardBreak`
 * 노드를 **바로 앞 run에 `\n`으로 붙여** 버린다(그 노드에 걸린 mark는 무시한다). 그래서
 * `첫 줄 **굵게**\n둘째 줄`처럼 줄바꿈 **직전**이 서식 구간이면, 왕복 뒤 `\n`이 굵게 run 끝에
 * 얹혀 softBreak가 없던 서식을 얻는다. run **안쪽**의 `\n`(= 서식이 줄바꿈을 실제로 가로지르는
 * 경우, 예: `**첫\n둘**`)은 그대로 run의 서식을 유지하므로 이 규칙으로 두 방향이 모두 맞는다.
 */
function pushTextRun(out: InlineNode[], text: string, styles: InlineStyles | undefined, code: boolean) {
  const parts = text.split('\n')
  parts.forEach((part, i) => {
    if (i > 0) {
      const atRunEnd = i === parts.length - 1 && part === ''
      out.push(withStyles({ type: 'softBreak' } as InlineNode, atRunEnd ? undefined : styles))
    }
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

/** content `'plain'`(수식)은 편집기가 문자열로 돌려준다 — 관대하게 run 배열도 읽는다. */
function plainText(content: string | BnStyledText[] | undefined): string {
  if (typeof content === 'string') return content
  return (content ?? []).map((run) => run.text ?? '').join('')
}

function numberProp(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? Math.round(value) : undefined
}

function inlineToApp(ctx: Ctx, nodes: BnInline[] | undefined): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'link': {
        const children: InlineNode[] = []
        for (const child of node.content ?? []) {
          pushTextRun(children, child.text ?? '', appStyles(ctx, child.styles), !!child.styles?.code)
        }
        const url = node.href ?? ''
        const link: InlineNode = { type: 'link', url, children }
        // 규약 I 흡수 ② — 링크 제목은 사이드카(href → title)에서 되살린다.
        const title = ctx.entry?.linkTitles?.[url]
        if (typeof title === 'string') link.title = title
        out.push(link)
        break
      }
      case 'refChip':
        out.push(
          withStyles(
            {
              type: 'refChip',
              ref: (node.props?.refType ?? 'doc') as 'doc' | 'anchor' | 'embed',
              target: node.props?.target ?? '',
              // 규약 C: 빈 라벨 ⇔ 라벨 추종형(앱 `label === undefined`).
              ...(node.props?.label ? { label: node.props.label } : {}),
            } as InlineNode,
            decodeInlineStyles(ctx, node.props?.styles),
          ),
        )
        break
      case 'inlineImage': {
        const image: InlineNode = {
          type: 'inlineImage',
          url: node.props?.url ?? '',
          alt: node.props?.alt ?? '',
        }
        if (node.props?.title) image.title = node.props.title
        const width = numberProp(node.props?.width)
        if (width !== undefined) image.width = width
        const height = numberProp(node.props?.height)
        if (height !== undefined) image.height = height
        out.push(withStyles(image, decodeInlineStyles(ctx, node.props?.styles)))
        break
      }
      case 'inlineFallback':
        out.push(
          withStyles(
            {
              type: 'inlineFallback',
              markdown: node.props?.markdown ?? '',
              nodeType: node.props?.nodeType ?? 'unknown',
            } as InlineNode,
            decodeInlineStyles(ctx, node.props?.styles),
          ),
        )
        break
      case 'lineBreak':
        // 규약 I 흡수 ① — 경성 줄바꿈(`\`+개행). 부드러운 줄바꿈은 텍스트 안 `\n`이 담는다.
        out.push(withStyles({ type: 'hardBreak' } as InlineNode, decodeInlineStyles(ctx, node.props?.styles)))
        break
      case 'math':
        out.push({ type: 'inlineMath', value: plainText(node.content) })
        break
      default:
        pushTextRun(out, node.text ?? '', appStyles(ctx, node.styles), !!node.styles?.code)
        break
    }
  }
  return out
}

function cellToApp(ctx: Ctx, cell: BnInline[] | BnTableCell): InlineNode[] {
  if (Array.isArray(cell)) return inlineToApp(ctx, cell)
  return inlineToApp(ctx, cell?.content)
}

// ---------------------------------------------------------------- 블록

function childrenToApp(ctx: Ctx, block: BnBlock): Block[] | undefined {
  const kids = blocksToApp(ctx, block.children)
  return kids.length > 0 ? kids : undefined
}

function listItemToApp(
  ctx: Ctx,
  id: string,
  block: BnBlock,
  ordered: boolean,
  checked?: boolean,
): ListItemBlock {
  const item: ListItemBlock = {
    id,
    type: 'listItem',
    ordered,
    content: inlineToApp(ctx, 'content' in block ? (block.content as BnInline[]) : []),
  }
  if (checked !== undefined) item.checked = checked
  const kids = childrenToApp(ctx, block)
  if (kids) item.children = kids
  return item
}

/** 사이드카 항목을 이 블록으로 바꾸고 읽는다(중첩 블록이 부모 항목을 물려받지 않게 한다). */
function withEntry<T>(ctx: Ctx, key: string, run: () => T): T {
  const prev = ctx.entry
  ctx.entry = ctx.sidecar[key]
  try {
    return run()
  } finally {
    ctx.entry = prev
  }
}

function blockToApp(ctx: Ctx, block: BnBlock): Block | null {
  const id = idOf(block)
  const converted = withEntry(ctx, id, () => blockToAppInner(ctx, id, block))
  // 규약 I 흡수 ④ — 블록 메타(provenance) 복원.
  const meta = ctx.sidecar[id]?.meta
  if (converted && meta) converted.meta = meta
  return converted
}

function blockToAppInner(ctx: Ctx, id: string, block: BnBlock): Block | null {
  switch (block.type) {
    case 'paragraph':
      // 문단의 자식 블록(BlockNote는 어떤 블록이든 중첩할 수 있다)은 앱 모델에 자리가 없으므로
      // **형제로 편다**(blocksToApp) — 내용이 사라지는 경로를 만들지 않는다.
      return { id, type: 'paragraph', content: inlineToApp(ctx, block.content) }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(block.props?.level ?? 1))) as 1 | 2 | 3 | 4 | 5 | 6
      return { id, type: 'heading', level, content: inlineToApp(ctx, block.content) }
    }
    case 'bulletListItem':
      return listItemToApp(ctx, id, block, false)
    case 'numberedListItem': {
      const item = listItemToApp(ctx, id, block, true)
      const start = block.props?.start
      if (typeof start === 'number') item.start = start
      return item
    }
    case 'checkListItem':
      return listItemToApp(ctx, id, block, false, !!block.props?.checked)
    case 'quote': {
      // toBlockNote의 끌어올리기 규칙(첫 자식이 "내용 있는 문단"일 때만)과 대칭:
      // 인라인이 비었으면 앞에 빈 문단을 만들지 않는다.
      // 끌어올려진 문단의 사이드카는 **`${id}-p` 키**에 있다(toBlockNote가 그리로 옮겨 적는다).
      const paragraphId = `${id}-p`
      const content = withEntry(ctx, paragraphId, () => inlineToApp(ctx, block.content))
      const kids = blocksToApp(ctx, block.children)
      if (content.length === 0) return { id, type: 'quote', children: kids }
      const paragraph: Block = { id: paragraphId, type: 'paragraph', content }
      const meta = ctx.sidecar[paragraphId]?.meta
      if (meta) paragraph.meta = meta
      return { id, type: 'quote', children: [paragraph, ...kids] }
    }
    case 'codeBlock': {
      const code = (block.content ?? []).map((run) => run.text ?? '').join('')
      const language = block.props?.language
      const info = block.props?.info
      const out: Block = { id, type: 'codeBlock', code }
      // 'text'는 BlockNote의 "언어 없음" 기본값이다 — 펜스에 언어를 붙이지 않는다.
      if (language && language !== 'text') out.language = language
      if (info) out.info = info
      return out
    }
    case 'table': {
      const rows: BnTableRow[] = block.content?.rows ?? []
      const cols = rows.reduce((max, row) => Math.max(max, (row.cells ?? []).length), 0)
      // 열 정렬은 편집 표면에 없다(UI는 M35). 사이드카에 남은 값을 **열 수가 그대로일 때만**
      // 되살린다(열을 넣거나 빼면 어긋나므로 버린다).
      // (규약 I 흡수 ⑦ — 값이 왕복하므로 toBlockNote는 로드 시점에 보고하지 않는다. 대신 편집으로
      //  열이 증감해 **실제로 폐기되는 이 시점**을 집계한다: 보고 시점(로드)과 폐기 시점(저장)이
      //  시간축으로 어긋나 있어, 로드 시점 판정만으로는 "편집 중에 생긴 손실"을 덮지 못한다.)
      const saved = ctx.sidecar[id]?.tableAlign
      const restorable = !!saved && saved.length === cols
      if (saved && !restorable && saved.some((value) => value !== null)) ctx.alignDrops.push(id)
      const align = restorable
        ? (saved as (('left' | 'right' | 'center') | null)[]).map((value) => value ?? null)
        : new Array(cols).fill(null)
      return {
        id,
        type: 'table',
        align,
        rows: rows.map((row) => (row.cells ?? []).map((cell) => cellToApp(ctx, cell))),
      }
    }
    case 'image': {
      const out: Block = {
        id,
        type: 'image',
        url: block.props?.url ?? '',
        alt: block.props?.caption ?? '',
      }
      // 규약 I 흡수 ③ — 확장 prop(title·height)에서 되살린다(`''`/`0` = 없음).
      if (block.props?.title) out.title = block.props.title
      const width = numberProp(block.props?.previewWidth)
      if (width !== undefined) out.width = width
      const height = numberProp(block.props?.height)
      if (height !== undefined) out.height = height
      return out
    }
    case 'divider':
      return { id, type: 'divider' }
    case 'mathBlock':
      return { id, type: 'mathBlock', value: plainText(block.content) }
    case 'callout': {
      const out: Block = {
        id,
        type: 'callout',
        variant: block.props?.variant ?? 'note',
        title: block.props?.title ?? '',
        children: blocksToApp(ctx, block.children),
      }
      const attrs = decodeAttrPairs(block.props?.attrs)
      if (attrs) out.attrs = attrs
      return out
    }
    case 'docEmbed': {
      const out: Block = { id, type: 'docEmbed', target: block.props?.target ?? '' }
      if (block.props?.label) out.label = block.props.label
      return out
    }
    case 'sourceFallback':
      return {
        id,
        type: 'sourceFallback',
        markdown: block.props?.markdown ?? '',
        nodeType: block.props?.nodeType ?? 'unknown',
      }
    default:
      return null
  }
}

/**
 * 규약 I 흡수 ⑤·⑥ — 사이드카에 실린 목록 그룹 정보(`listSpread`·`listGroupBreak`)를 **한 형제
 * 배열 안에서** 되살린다(R34 판정 완료 2026-08-17).
 *
 * 왜 항목별로 그대로 되돌리지 않는가: 느슨함(spread)은 CommonMark에서 **항목이 아니라 목록의
 * 성질**이다 — 항목 중 하나라도 빈 줄로 갈라지면 그 목록 **전체**가 loose다. 앱 모델도 그렇게
 * 다룬다(`mdastToBlocks`는 그룹 전원에 `spread: true`를 찍고, `blocksToMarkdown`은
 * `items.some(spread)`로 그룹을 판정한다). 그래서 복원도 **런(run) 단위**로 한다:
 * 연속한 같은 종류의 목록 항목 런 안에서 사이드카에 `spread === true`가 **하나라도** 있으면
 * 런 전원을 loose로 되돌린다. 이러면 사용자가 항목을 추가·삭제·재정렬해도(새 항목은 사이드카에
 * 아예 없다) 결과가 흔들리지 않는다 — 항목별 복원이었다면 같은 목록 안에서 간격이 들쭉날쭉해진다.
 *
 * `groupBreak`는 반대로 **항목 하나의 위치 표시**(여기서 새 목록이 시작된다)라 항목별로 되돌리되,
 * 앞 형제가 **같은 종류의 목록 항목일 때만** 적용한다. 사용자가 그 항목을 목록 맨 앞이나 다른
 * 문맥으로 옮겼다면 "경계"라는 개념 자체가 사라진 것이므로 표시를 버린다(되살리면 아무 데도
 * 안 걸리는 죽은 플래그가 남는다). 런 경계 계산은 `blocksToMarkdown.serializeBlockSeq`의 그룹
 * 규칙(같은 `ordered` + `groupBreak`에서 끊김)과 **같은 판정**을 쓴다.
 */
function restoreListGroups(ctx: Ctx, blocks: Block[]): void {
  // ① groupBreak — 앞 형제가 같은 종류의 목록 항목인 자리에서만 되살린다.
  blocks.forEach((block, i) => {
    if (block.type !== 'listItem') return
    if (!ctx.sidecar[block.id]?.listGroupBreak) return
    const prev = blocks[i - 1]
    if (prev && prev.type === 'listItem' && prev.ordered === block.ordered) block.groupBreak = true
  })

  // ② spread — 런 단위. (①이 끝난 뒤에 돌아야 런 경계가 확정된다.)
  let i = 0
  while (i < blocks.length) {
    const head = blocks[i]
    if (head.type !== 'listItem') {
      i += 1
      continue
    }
    let j = i
    while (j + 1 < blocks.length) {
      const next = blocks[j + 1]
      if (next.type !== 'listItem' || next.ordered !== head.ordered || next.groupBreak === true) break
      j += 1
    }
    const run = blocks.slice(i, j + 1) as ListItemBlock[]
    // `true`가 하나라도 있으면 런 전체가 loose. 아무도 true가 아닌데 명시적 `false`가 남아
    // 있으면 그 값을 그대로 되돌린다(원본이 `spread: false`를 실어 왔다는 뜻이다).
    let value: boolean | undefined
    for (const item of run) {
      const saved = ctx.sidecar[item.id]?.listSpread
      if (saved === true) {
        value = true
        break
      }
      if (saved === false) value = false
    }
    if (value !== undefined) for (const item of run) item.spread = value
    i = j + 1
  }
}

function blocksToApp(ctx: Ctx, blocks: BnBlock[] | undefined): Block[] {
  const out: Block[] = []
  for (const block of blocks ?? []) {
    const converted = blockToApp(ctx, block)
    if (!converted) continue
    out.push(converted)
    // 문단·헤딩·이미지 등 "자식을 담을 수 없는" 앱 블록의 BlockNote 자식은 형제로 편다.
    if (
      converted.type !== 'listItem' &&
      converted.type !== 'quote' &&
      converted.type !== 'callout' &&
      block.children?.length
    ) {
      out.push(...blocksToApp(ctx, block.children))
    }
  }
  // 형제 배열이 확정된 뒤에 목록 런을 판정한다(중첩 목록도 각자의 children 배열에서 이 경로를 탄다).
  restoreListGroups(ctx, out)
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

export interface FromBlockNoteResult {
  document: BlockDocument
  /**
   * 규약 C 방어적 정규화로 접은 마이크로 마크 목록(조용히 접지 않는다는 계약의 집계).
   * 비어 있지 않으면 편집기에서 상호 배타 규칙을 벗어난 서식이 들어왔다는 뜻이다.
   */
  microMarkCollapses: MicroMark[]
  /**
   * 표 열 정렬을 **되살리지 못하고 버린** 표의 블록 id 목록(사용자가 편집 중 열을 넣거나 뺐다).
   * 정렬 편집 UI가 M35 범위라 화면에는 정렬이 보이지 않으므로, 호출부(화면)는 이 값이 비어
   * 있지 않으면 **반드시 사용자에게 알려야 한다** — 알리지 않으면 조용한 손실이 된다.
   */
  tableAlignDrops: string[]
}

/**
 * BlockNote 블록 JSON → 앱 블록 문서 + 정규화 집계.
 * `sidecar`는 `toBlockNoteBlocks`가 돌려준 것을 그대로 넘긴다(없으면 흡수분이 복원되지 않을 뿐
 * 저장은 정상 동작한다 — 두 번째 인자는 **선택**이다).
 */
export function fromBlockNoteResult(
  blocks: BnBlock[] | undefined,
  sidecar?: AdapterSidecar,
): FromBlockNoteResult {
  const ctx: Ctx = { sidecar: sidecar ?? {}, collapsed: [], alignDrops: [], entry: undefined }
  return {
    document: {
      version: BLOCK_SCHEMA_VERSION,
      blocks: trimTrailingEmptyParagraphs(blocksToApp(ctx, blocks)),
    },
    microMarkCollapses: ctx.collapsed,
    tableAlignDrops: ctx.alignDrops,
  }
}

/** BlockNote 블록 JSON → 앱 블록 문서(저장 대상 `content_blocks`). */
export function fromBlockNoteBlocks(
  blocks: BnBlock[] | undefined,
  sidecar?: AdapterSidecar,
): BlockDocument {
  return fromBlockNoteResult(blocks, sidecar).document
}
