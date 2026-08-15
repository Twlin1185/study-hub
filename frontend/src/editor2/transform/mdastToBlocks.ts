// 에디터 v2 변환 계층 ① — **mdast → 앱 블록** (M32 / stage-32 묶음 2 · editor-v2.plan.md §5.3 D4)
//
// Markdown 파서는 여전히 remark **1개**다(F42/R19) — 이 파일은 파서를 만들지 않고, 기존
// `remarkStudy` 플러그인을 포함한 파이프라인이 낸 mdast를 앱 스키마로 옮길 뿐이다.
// 파이프라인 조립·공개 API는 `./index.ts`가 맡는다.
//
// 규약(stage-32 §확정 규약):
//  · A-1 정규형 — 인라인 트리는 **(텍스트, 마크 집합) run 배열로 평탄화**한다(강조 중첩 순서 흡수).
//  · B         — 목록은 list 컨테이너를 걷어내고 **listItem 블록 + children 중첩**으로 편다.
//  · D         — 팔레트 밖 노드는 원문 슬라이스를 담은 sourceFallback/inlineFallback으로 감싼다.
//  · E         — 이미지 직후 `{w=<px>}` 부속 표기를 image 노드에 **병합 해석**한다(remark 플러그인 추가 0).
import { mergeAttrPairs } from '../schema/blocks'
import type {
  AttrPair,
  Block,
  InlineNode,
  InlineStyles,
  ListItemBlock,
  MarkName,
  RefChipKind,
} from '../schema/blocks'

// ---- mdast 최소 형태 (외부 타입 의존을 만들지 않는다 — remarkStudy.ts와 같은 관례) ----

export interface MdNode {
  type: string
  name?: string
  value?: string
  url?: string
  title?: string | null
  alt?: string | null
  lang?: string | null
  meta?: string | null
  depth?: number
  ordered?: boolean | null
  start?: number | null
  spread?: boolean | null
  checked?: boolean | null
  align?: (string | null)[] | null
  children?: MdNode[]
  attributes?: Record<string, string | null | undefined> | null
  data?: Record<string, unknown>
  position?: { start?: { offset?: number }; end?: { offset?: number } }
}

interface Ctx {
  source: string
  seq: { n: number }
}

function nextId(ctx: Ctx): string {
  ctx.seq.n += 1
  return `b${ctx.seq.n}`
}

/** 노드의 원문 슬라이스(position 기반). position이 없으면 null. */
function sliceOf(node: MdNode, ctx: Ctx): string | null {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number') return null
  return ctx.source.slice(start, end)
}

function hProps(node: MdNode): Record<string, unknown> {
  const data = node.data as { hProperties?: Record<string, unknown> } | undefined
  return data?.hProperties ?? {}
}

function attrPairsOf(node: MdNode): AttrPair[] {
  const attrs = node.attributes ?? {}
  return Object.keys(attrs).map((key): AttrPair => [key, attrs[key] ?? ''])
}

// ---------------------------------------------------------------- 인라인

function hasStyles(styles: InlineStyles): boolean {
  return Object.keys(styles).length > 0
}

function attach<T extends InlineNode>(node: T, styles: InlineStyles): T {
  if (hasStyles(styles)) node.styles = { ...styles }
  return node
}

function withMark(styles: InlineStyles, mark: MarkName): InlineStyles {
  return { ...styles, [mark]: true }
}

function withT(styles: InlineStyles, pairs: AttrPair[]): InlineStyles {
  return { ...styles, t: mergeAttrPairs(styles.t, pairs) }
}

/** F52 마이크로 3종의 mdast 표현(studyInline)에서 마크 이름을 읽는다. */
function microMark(node: MdNode): MarkName {
  const data = node.data as { hName?: string } | undefined
  if (data?.hName === 'u') return 'underline'
  if (data?.hName === 'mark') return 'highlight'
  return 'spoiler'
}

function refKindOf(node: MdNode): RefChipKind {
  const kind = hProps(node)['data-ref-kind']
  if (kind === 'embed') return 'embed'
  if (kind === 'anchor') return 'anchor'
  return 'doc'
}

/** 평문 값을 개행 기준으로 잘라 text run + softBreak으로 편다(블록 인라인에는 개행이 없다). */
function pushText(out: InlineNode[], value: string, styles: InlineStyles): void {
  if (value === '') return
  const parts = value.split('\n')
  parts.forEach((part, idx) => {
    if (idx > 0) out.push(attach({ type: 'softBreak' }, styles))
    if (part !== '') out.push(attach({ type: 'text', text: part }, styles))
  })
}

/** 규약 E — 이미지 직후 `{w=400}`(선택 `h=`) 부속 표기. */
const SIZE_SUFFIX_RE = /^\{w=(\d+)(?:[ \t]+h=(\d+))?\}/

interface SizeSuffix {
  width: number
  height?: number
  /** 다음 text 노드 값에서 잘라낼 길이 */
  consumed: number
}

/**
 * 이미지 노드 뒤에 붙은 크기 부속 표기를 읽는다.
 * **원문 슬라이스가 실제로 `{`로 시작할 때만** 인정한다 — 사용자가 `\{w=400}`으로 이스케이프해
 * 평문을 적은 경우를 삼키지 않기 위해서다(조용한 본문 변형 0).
 */
function readSizeSuffix(next: MdNode | undefined, ctx: Ctx): SizeSuffix | null {
  if (!next || next.type !== 'text') return null
  const value = next.value ?? ''
  const m = SIZE_SUFFIX_RE.exec(value)
  if (!m) return null
  const raw = sliceOf(next, ctx)
  if (raw === null || !raw.startsWith(m[0])) return null
  return {
    width: Number(m[1]),
    height: m[2] === undefined ? undefined : Number(m[2]),
    consumed: m[0].length,
  }
}

function convertInlines(nodes: MdNode[], styles: InlineStyles, ctx: Ctx): InlineNode[] {
  const out: InlineNode[] = []
  let skip = 0
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]

    if (node.type === 'text') {
      let value = node.value ?? ''
      if (skip > 0) {
        value = value.slice(skip)
        skip = 0
      }
      pushText(out, value, styles)
      continue
    }
    skip = 0

    switch (node.type) {
      case 'strong':
        out.push(...convertInlines(node.children ?? [], withMark(styles, 'bold'), ctx))
        break
      case 'emphasis':
        out.push(...convertInlines(node.children ?? [], withMark(styles, 'italic'), ctx))
        break
      case 'delete':
        out.push(...convertInlines(node.children ?? [], withMark(styles, 'strike'), ctx))
        break
      case 'studyInline':
        out.push(...convertInlines(node.children ?? [], withMark(styles, microMark(node)), ctx))
        break
      case 'textDirective': {
        if (node.name === 't') {
          out.push(...convertInlines(node.children ?? [], withT(styles, attrPairsOf(node)), ctx))
          break
        }
        out.push(
          attach(
            { type: 'inlineFallback', markdown: sliceOf(node, ctx) ?? '', nodeType: node.type },
            styles,
          ),
        )
        break
      }
      case 'inlineCode':
        out.push(attach({ type: 'inlineCode', value: node.value ?? '' }, styles))
        break
      case 'inlineMath':
        out.push(attach({ type: 'inlineMath', value: node.value ?? '' }, styles))
        break
      case 'link': {
        const link: InlineNode = {
          type: 'link',
          url: node.url ?? '',
          children: convertInlines(node.children ?? [], styles, ctx),
        }
        if (node.title) link.title = node.title
        out.push(attach(link, styles))
        break
      }
      case 'image': {
        const size = readSizeSuffix(nodes[i + 1], ctx)
        if (size) skip = size.consumed
        const image: InlineNode = { type: 'inlineImage', url: node.url ?? '', alt: node.alt ?? '' }
        if (node.title) image.title = node.title
        if (size) {
          image.width = size.width
          if (size.height !== undefined) image.height = size.height
        }
        out.push(attach(image, styles))
        break
      }
      case 'studyRef': {
        const props = hProps(node)
        const chip: InlineNode = {
          type: 'refChip',
          ref: refKindOf(node),
          target: String(props['data-ref-target'] ?? ''),
        }
        const alias = String(props['data-ref-alias'] ?? '')
        if (alias !== '') chip.label = alias
        out.push(attach(chip, styles))
        break
      }
      case 'break':
        out.push(attach({ type: 'hardBreak' }, styles))
        break
      default:
        out.push(
          attach(
            { type: 'inlineFallback', markdown: sliceOf(node, ctx) ?? '', nodeType: node.type },
            styles,
          ),
        )
        break
    }
  }
  return out
}

/**
 * 블록 **가장자리** 공백을 떨어낸다.
 * Markdown은 문단·헤딩·셀 가장자리의 공백을 표현할 수 없다(모든 파서가 버린다). 문단 안 임베드가
 * 블록으로 승격되며 남는 `"앞 문장 "` 같은 꼬리 공백이 여기 해당한다 — 표현 불가한 표기 잔여이지
 * 본문이 아니므로 변환기와 검증 스크립트의 정규형이 **같은 규칙으로** 떨어낸다.
 */
function trimEdges(nodes: InlineNode[]): InlineNode[] {
  const out = nodes.slice()
  const first = out[0]
  if (first && first.type === 'text') {
    const text = first.text.replace(/^[ \t]+/, '')
    if (text === '') out.shift()
    else out[0] = { ...first, text }
  }
  const lastIdx = out.length - 1
  const last = out[lastIdx]
  if (last && last.type === 'text') {
    const text = last.text.replace(/[ \t]+$/, '')
    if (text === '') out.pop()
    else out[lastIdx] = { ...last, text }
  }
  return out
}

function inlineContent(node: MdNode, ctx: Ctx): InlineNode[] {
  return trimEdges(convertInlines(node.children ?? [], {}, ctx))
}

// ---------------------------------------------------------------- 블록

function headingLevel(depth: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = Math.min(6, Math.max(1, depth ?? 1))
  return level as 1 | 2 | 3 | 4 | 5 | 6
}

function fallbackBlock(node: MdNode, ctx: Ctx): Block {
  return {
    id: nextId(ctx),
    type: 'sourceFallback',
    markdown: sliceOf(node, ctx) ?? '',
    nodeType: node.type,
  }
}

/** 문단이 이미지 하나로만 이뤄졌으면 image **블록**으로 승격한다. */
function paragraphBlock(node: MdNode, ctx: Ctx): Block {
  const content = inlineContent(node, ctx)
  const only = content.length === 1 ? content[0] : null
  if (only && only.type === 'inlineImage' && !only.styles) {
    const block: Block = { id: nextId(ctx), type: 'image', url: only.url, alt: only.alt }
    if (only.title !== undefined) block.title = only.title
    if (only.width !== undefined) block.width = only.width
    if (only.height !== undefined) block.height = only.height
    return block
  }
  return { id: nextId(ctx), type: 'paragraph', content }
}

function listItemBlocks(list: MdNode, ctx: Ctx): ListItemBlock[] {
  const ordered = list.ordered === true
  const start = typeof list.start === 'number' ? list.start : undefined
  const spread = list.spread === true ? true : undefined
  return (list.children ?? []).map((item, idx): ListItemBlock => {
    const children = item.children ?? []
    const hasLeadParagraph = children[0]?.type === 'paragraph'
    const block: ListItemBlock = {
      id: nextId(ctx),
      type: 'listItem',
      ordered,
      content: hasLeadParagraph ? inlineContent(children[0], ctx) : [],
    }
    if (typeof item.checked === 'boolean') block.checked = item.checked
    if (ordered && idx === 0 && start !== undefined && start !== 1) block.start = start
    if (spread) block.spread = true
    const rest = hasLeadParagraph ? children.slice(1) : children
    const kids = convertBlocks(rest, ctx)
    if (kids.length) block.children = kids
    return block
  })
}

function tableBlock(node: MdNode, ctx: Ctx): Block {
  const align = (node.align ?? []).map((value) =>
    value === 'left' || value === 'right' || value === 'center' ? value : null,
  )
  const rows = (node.children ?? []).map((row) =>
    (row.children ?? []).map((cell) => inlineContent(cell, ctx)),
  )
  return { id: nextId(ctx), type: 'table', align, rows }
}

function calloutBlock(node: MdNode, ctx: Ctx): Block {
  const label = hProps(node)['data-directive-label']
  const attrs = attrPairsOf(node)
  const block: Block = {
    id: nextId(ctx),
    type: 'callout',
    variant: node.name ?? '',
    title: typeof label === 'string' ? label : '',
    children: convertBlocks(node.children ?? [], ctx),
  }
  if (attrs.length) block.attrs = attrs
  return block
}

function convertBlocks(nodes: MdNode[], ctx: Ctx): Block[] {
  const out: Block[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
        out.push(paragraphBlock(node, ctx))
        break
      case 'heading':
        out.push({
          id: nextId(ctx),
          type: 'heading',
          level: headingLevel(node.depth),
          content: inlineContent(node, ctx),
        })
        break
      case 'list': {
        const items = listItemBlocks(node, ctx)
        // 앞 형제도 같은 종류의 목록이었다면 **여기가 목록 경계**다(원본이 마커·구분자를 바꿔
        // 두 목록으로 적었다는 뜻) — 평평한 listItem 모델에서 그 사실을 잃지 않게 표시해 둔다.
        const prev = out[out.length - 1]
        const first = items[0]
        if (first && prev && prev.type === 'listItem' && prev.ordered === first.ordered) {
          first.groupBreak = true
        }
        out.push(...items)
        break
      }
      case 'blockquote':
        out.push({ id: nextId(ctx), type: 'quote', children: convertBlocks(node.children ?? [], ctx) })
        break
      case 'code': {
        const block: Block = { id: nextId(ctx), type: 'codeBlock', code: node.value ?? '' }
        if (node.lang) block.language = node.lang
        if (node.meta) block.info = node.meta
        out.push(block)
        break
      }
      case 'table':
        out.push(tableBlock(node, ctx))
        break
      case 'math':
        out.push({ id: nextId(ctx), type: 'mathBlock', value: node.value ?? '' })
        break
      case 'thematicBreak':
        out.push({ id: nextId(ctx), type: 'divider' })
        break
      case 'containerDirective':
        out.push(calloutBlock(node, ctx))
        break
      case 'studyRef': {
        // remarkStudy가 문단 밖으로 끌어올린 임베드(문단 안에 남은 것은 인라인 refChip이다).
        const props = hProps(node)
        const block: Block = {
          id: nextId(ctx),
          type: 'docEmbed',
          target: String(props['data-ref-target'] ?? ''),
        }
        const alias = String(props['data-ref-alias'] ?? '')
        if (alias !== '') block.label = alias
        out.push(block)
        break
      }
      default:
        out.push(fallbackBlock(node, ctx))
        break
    }
  }
  return out
}

/** mdast 루트 → 블록 배열. `source`는 fallback·규약 E 판정에 쓰는 원문이다. */
export function mdastToBlocks(root: MdNode, source: string): Block[] {
  return convertBlocks(root.children ?? [], { source, seq: { n: 0 } })
}
