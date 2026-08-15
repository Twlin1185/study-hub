// WYSIWYG 인라인 편집 — 인라인 모델(설계 §5.3 S30 ⓐ·ⓑ / stage-30 A-1·A-2·B-1).
//
// 이 파일은 **파서를 새로 만들지 않는다.** 블록 소스를 `MarkdownView`와 **똑같은 remark 파이프라인**
// (gfm · math · directive · remarkStudyDirectives · remarkStudyRefs · breaks)으로 파싱해 그 결과
// mdast에서 인라인 노드 모델을 뽑을 뿐이다 — 렌더와 해석이 갈리는 경로를 원천 차단한다.
//
// unified·remark-parse는 **react-markdown이 이미 쓰고 있는 자기 의존**이다(package.json 무변경 ·
// 신규 npm 설치 0). react-markdown이 프로세서를 외부에 노출하지 않아 같은 플러그인 목록으로
// 파이프라인을 한 번 더 조립하는 것이며, 플러그인 인스턴스는 `MarkdownView`와 같은 모듈을 쓴다.
//
// 모델의 3층 계약(설계 S30 ⓑ) 중 이 파일이 지는 몫:
//  · 각 노드는 `{range(원본 오프셋), raw(원본 슬라이스), 서식 속성, text, dirty}`를 가진다.
//  · 원자 노드(inlineCode·inlineMath·F43 참조 3종)는 **항상 원본 슬라이스를 보존**하고 내용 편집
//    대상이 아니다(표면이 contenteditable=false로 감싼다).
//  · 직렬화(2층·3층)는 `inlineSerialize.ts`가 맡는다.
import type { PluggableList } from 'unified'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import remarkDirective from 'remark-directive'
import { remarkStudyDirectives, remarkStudyRefs } from './remarkStudy'
import { isHexColor, isPaletteColor, isTextSize } from './palette'
import type { TextSize } from './palette'

// ---- mdast 최소 형태 (외부 타입 의존을 만들지 않는다 — remarkStudy.ts와 같은 관례) ----

export interface MdNode {
  type: string
  name?: string
  value?: string
  url?: string
  title?: string | null
  depth?: number
  children?: MdNode[]
  attributes?: Record<string, string | null | undefined> | null
  data?: Record<string, unknown>
  position?: { start?: { offset?: number }; end?: { offset?: number } }
}

// ---- 파이프라인 ----

export interface RichParseOptions {
  /**
   * 단일 개행을 `break` 노드로 쪼갤지(F51 remark-breaks). **모델 기본값은 false**다 —
   * remark-breaks는 파싱 확장이 아니라 **파싱 뒤 mdast를 손보는 변환**이라 "무엇이 굵게·링크·
   * 코드인가"라는 해석은 켜든 끄든 완전히 같고(= 렌더와 같은 해석 계약 유지), 대신 그것이
   * 새로 만드는 break·text 노드에는 **position이 없다**. 위치 없는 노드는 2층 계약(원본 슬라이스
   * 재출력)을 무력화하므로 모델은 기본적으로 끈다. 렌더(MarkdownView)는 종전대로 켠 채다.
   */
  breaks?: boolean
  /** F52 인라인 표현 문법 전체(기본 true) */
  inlineFormat?: boolean
}

type Processor = ReturnType<typeof buildProcessor>

function buildProcessor(breaks: boolean, inlineFormat: boolean) {
  // 순서는 MarkdownView.buildRemarkPlugins와 **동일**해야 한다(breaks는 항상 study 변환 뒤).
  const plugins: PluggableList = [
    remarkGfm,
    remarkMath,
    remarkDirective,
    [remarkStudyDirectives, { inlineFormat }],
    [remarkStudyRefs, { inlineFormat }],
  ]
  if (breaks) plugins.push(remarkBreaks)
  return unified().use(remarkParse).use(plugins)
}

const processorCache = new Map<string, Processor>()

function getProcessor(opts?: RichParseOptions) {
  const breaks = opts?.breaks ?? false
  const inlineFormat = opts?.inlineFormat ?? true
  const key = `${breaks ? 1 : 0}${inlineFormat ? 1 : 0}`
  let proc = processorCache.get(key)
  if (!proc) {
    proc = buildProcessor(breaks, inlineFormat)
    processorCache.set(key, proc)
  }
  return proc
}

/** 소스를 렌더와 같은 파이프라인으로 파싱한 mdast 루트. 실패하면 null(호출부가 소스 편집으로 폴백). */
export function parseMarkdown(source: string, opts?: RichParseOptions): MdNode | null {
  try {
    const proc = getProcessor(opts)
    const tree = proc.parse(source)
    // 파일 값을 함께 넘겨야 remarkStudy가 원본 슬라이스(이스케이프·퇴로 복원)를 볼 수 있다.
    return proc.runSync(tree, source) as unknown as MdNode
  } catch {
    return null
  }
}

// ---- B-1. 리치 대상 판정 술어 (설계 S30 ⓐ) ----

/** 최상위 자식으로 허용되는 블록 종류 */
const RICH_TOP_TYPES = new Set(['paragraph', 'heading', 'list', 'blockquote'])

/**
 * 서브트리 어디에도 있으면 안 되는 배제 노드.
 * `code`(펜스·인라인 코드가 아닌 블록 코드) · `table`(및 행/셀) · 블록 수식(`math`) ·
 * `containerDirective`(콜아웃·fold·hide) · `html` · `image` · `footnoteDefinition` · `definition`.
 * 보수적 원자화(R28) — 하나라도 있으면 S27 소스 textarea 그대로 간다(회귀 0).
 */
const RICH_EXCLUDED_TYPES = new Set([
  'code',
  'table',
  'tableRow',
  'tableCell',
  'math',
  'containerDirective',
  'leafDirective',
  'html',
  'image',
  'imageReference',
  'footnoteDefinition',
  'definition',
  'thematicBreak',
])

function hasExcluded(node: MdNode): boolean {
  if (RICH_EXCLUDED_TYPES.has(node.type)) return true
  for (const child of node.children ?? []) {
    if (hasExcluded(child)) return true
  }
  return false
}

/**
 * S27 `scanBlocks`가 낸 블록 소스가 리치 편집 표면 대상인지 판정한다(신규 블록 분해 로직 0).
 * 판정은 **기존 remark 파이프라인 파싱 결과**로만 한다 — 별도 정규식 판별 금지(렌더와 같은 해석).
 */
export function isRichEditableBlock(blockSource: string, opts?: RichParseOptions): boolean {
  const root = parseMarkdown(blockSource, opts)
  if (!root) return false
  const children = root.children ?? []
  if (children.length === 0) return false
  for (const child of children) {
    if (!RICH_TOP_TYPES.has(child.type)) return false
    if (hasExcluded(child)) return false
  }
  return true
}

// ---- A-1·A-2. 인라인 모델 ----

export type AtomKind =
  | 'inlineCode'
  | 'inlineMath'
  | 'refEmbed'
  | 'refLink'
  | 'refAnchor'
  /** 모델이 다루지 않는 인라인 노드(각주 참조·참조식 링크·인라인 html 등) — 슬라이스 통째 보존 */
  | 'raw'

/** `:t[…]{c= bg= s=}`가 싣는 표현 속성(값은 이미 화이트리스트를 통과한 것만 들어온다) */
export interface StyleAttrs {
  /** 글자색 — 팔레트 이름 또는 `#rrggbb` */
  ink?: string
  /** 바탕색(형광펜) — 팔레트 이름 또는 `#rrggbb` */
  bg?: string
  size?: TextSize
}

/** 정규 표기 표(설계 S30 ⓑ)가 직접 대응하는 감싸기 서식 */
export type WrapMark = 'strong' | 'emphasis' | 'delete' | 'underline' | 'highlight' | 'spoiler'

export interface InlineRange {
  start: number
  end: number
}

interface InlineBase {
  /** 블록 소스 기준 반개구간. 편집으로 새로 생긴 노드는 null */
  range: InlineRange | null
  /** 원본 슬라이스(문법 기호 포함) — 2층 계약의 출력 원본. range가 없으면 null */
  raw: string | null
  /** 이 노드 자신이 편집되었는가(자손 dirty는 별도 — `isDirty()`가 서브트리로 판정) */
  dirty: boolean
}

export interface InlineTextNode extends InlineBase {
  kind: 'text'
  /** 평문(이스케이프가 풀린 값) — 편집 표면이 보여 주는 글자 */
  text: string
}

export interface InlineBreakNode extends InlineBase {
  kind: 'break'
}

export interface InlineAtomNode extends InlineBase {
  kind: 'atom'
  atom: AtomKind
  /** 원자 노드의 표시 텍스트 = 원본 슬라이스(문법 포함). 내용 편집 불가 */
  text: string
}

export interface InlineWrapNode extends InlineBase {
  kind: 'wrap'
  mark: WrapMark
  children: InlineNode[]
}

export type AttrPair = [string, string]

export interface InlineStyleNode extends InlineBase {
  kind: 'style'
  /**
   * 원본 속성 쌍(순서 보존) — **직렬화의 단일 출처**. 화이트리스트 밖 값(`c=rebeccapurple`)이나
   * 미지 속성도 여기 남아 있어 편집해도 소실되지 않는다(2026-08-14 툴바 병합 관례 계승).
   */
  attrPairs: AttrPair[]
  /** 위 쌍에서 **화이트리스트를 통과한 것만** 해석한 뷰(툴바 상태 표시용 — 읽기 전용으로 다룬다) */
  attrs: StyleAttrs
  children: InlineNode[]
}

export interface InlineLinkNode extends InlineBase {
  kind: 'link'
  url: string
  title?: string | null
  children: InlineNode[]
}

export type InlineNode =
  | InlineTextNode
  | InlineBreakNode
  | InlineAtomNode
  | InlineWrapNode
  | InlineStyleNode
  | InlineLinkNode

export type InlineParentNode = InlineWrapNode | InlineStyleNode | InlineLinkNode

export function isParentNode(node: InlineNode): node is InlineParentNode {
  return node.kind === 'wrap' || node.kind === 'style' || node.kind === 'link'
}

/** 서브트리에 편집이 있었는가 — 2층 계약(dirty 아닌 노드는 원본 슬라이스 그대로)의 판정자. */
export function isDirty(node: InlineNode): boolean {
  if (node.dirty) return true
  if (isParentNode(node)) return node.children.some(isDirty)
  return false
}

/** 인라인 노드를 담는 블록 안의 컨테이너(문단·헤딩) — 목록/인용 안쪽 문단도 각각 하나씩. */
export interface InlineContainer {
  type: 'paragraph' | 'heading'
  /** heading일 때만 */
  depth?: number
  /**
   * **내용** 범위(블록 소스 기준) — 헤딩 `#` 접두·목록 마커·인용 `>` 접두는 이 범위 **밖**이다
   * (첫 자식 시작 ~ 마지막 자식 끝). 직렬화가 블록 문법을 건드리지 않게 하는 핵심.
   */
  range: InlineRange
  children: InlineNode[]
}

export interface BlockInlineModel {
  /** 모델이 파싱한 블록 소스 원본 */
  source: string
  /** 최상위 블록 종류(paragraph·heading·list·blockquote…) */
  topTypes: string[]
  containers: InlineContainer[]
  /** B-1 판정 결과(리치 표면 대상인가) */
  rich: boolean
}

function rangeOf(node: MdNode): InlineRange | null {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number') return null
  return { start, end }
}

function sliceOf(source: string, range: InlineRange | null): string | null {
  if (!range) return null
  return source.slice(range.start, range.end)
}

function refAtomKind(node: MdNode): AtomKind {
  const props = (node.data?.hProperties ?? {}) as Record<string, unknown>
  const kind = props['data-ref-kind']
  if (kind === 'embed') return 'refEmbed'
  if (kind === 'anchor') return 'refAnchor'
  return 'refLink'
}

function microMark(node: MdNode): WrapMark {
  const data = node.data as { hName?: string; hProperties?: Record<string, unknown> } | undefined
  if (data?.hName === 'u') return 'underline'
  if (data?.hName === 'mark') return 'highlight'
  return 'spoiler'
}

function attrPairsOf(node: MdNode): AttrPair[] {
  const attrs = node.attributes ?? {}
  return Object.keys(attrs).map((key): AttrPair => [key, attrs[key] ?? ''])
}

/** 속성 쌍 → 해석된 표현 속성. 화이트리스트는 remarkStudy와 **같은 판정 함수**를 쓴다(이원화 금지). */
export function interpretAttrPairs(pairs: AttrPair[]): StyleAttrs {
  const out: StyleAttrs = {}
  for (const [key, value] of pairs) {
    if (key === 'c' && (isPaletteColor(value) || isHexColor(value))) out.ink = value
    else if (key === 'bg' && (isPaletteColor(value) || isHexColor(value))) out.bg = value
    else if (key === 's' && isTextSize(value)) out.size = value
  }
  return out
}

/**
 * `:t` 속성 하나를 설정·해제한다(툴바 관례 계승 — 같은 키는 새 값으로 교체, 같은 값 재적용은
 * 제거, 다른 키는 순서 보존). 모델을 dirty로 세우는 것은 호출부의 몫이다.
 */
export function setStyleAttr(node: InlineStyleNode, key: 'c' | 'bg' | 's', value: string | null): void {
  const idx = node.attrPairs.findIndex(([k]) => k === key)
  if (value === null) {
    if (idx !== -1) node.attrPairs.splice(idx, 1)
  } else if (idx === -1) {
    node.attrPairs.push([key, value])
  } else if (node.attrPairs[idx][1] === value) {
    node.attrPairs.splice(idx, 1)
  } else {
    node.attrPairs[idx] = [key, value]
  }
  node.attrs = interpretAttrPairs(node.attrPairs)
}

function makeAtom(source: string, node: MdNode, atom: AtomKind): InlineAtomNode {
  const range = rangeOf(node)
  const raw = sliceOf(source, range)
  return {
    kind: 'atom',
    atom,
    // 원자 노드의 텍스트 = 원본 슬라이스. 슬라이스를 못 얻으면(위치 미상) 값으로 최소 복원한다.
    text: raw ?? node.value ?? '',
    range,
    raw,
    dirty: false,
  }
}

function toInlineNode(source: string, node: MdNode): InlineNode {
  const range = rangeOf(node)
  const raw = sliceOf(source, range)
  const base = { range, raw, dirty: false }

  switch (node.type) {
    case 'text':
      return { kind: 'text', text: node.value ?? '', ...base }
    case 'break':
      return { kind: 'break', ...base }
    case 'inlineCode':
      return makeAtom(source, node, 'inlineCode')
    case 'inlineMath':
      return makeAtom(source, node, 'inlineMath')
    case 'studyRef':
      return makeAtom(source, node, refAtomKind(node))
    case 'strong':
      return { kind: 'wrap', mark: 'strong', children: toInlineNodes(source, node.children), ...base }
    case 'emphasis':
      return { kind: 'wrap', mark: 'emphasis', children: toInlineNodes(source, node.children), ...base }
    case 'delete':
      return { kind: 'wrap', mark: 'delete', children: toInlineNodes(source, node.children), ...base }
    case 'studyInline':
      return { kind: 'wrap', mark: microMark(node), children: toInlineNodes(source, node.children), ...base }
    case 'link':
      return {
        kind: 'link',
        url: node.url ?? '',
        title: node.title ?? null,
        children: toInlineNodes(source, node.children),
        ...base,
      }
    case 'textDirective': {
      if (node.name !== 't') return makeAtom(source, node, 'raw')
      const attrPairs = attrPairsOf(node)
      return {
        kind: 'style',
        attrPairs,
        attrs: interpretAttrPairs(attrPairs),
        children: toInlineNodes(source, node.children),
        ...base,
      }
    }
    default:
      // 모델이 모르는 인라인 노드는 통째로 원자화한다(보수적 — 슬라이스가 그대로 살아남는다).
      return makeAtom(source, node, 'raw')
  }
}

function toInlineNodes(source: string, children: MdNode[] | undefined): InlineNode[] {
  return (children ?? []).map((child) => toInlineNode(source, child))
}

function collectContainers(source: string, node: MdNode, out: InlineContainer[]): void {
  if (node.type === 'paragraph' || node.type === 'heading') {
    const children = node.children ?? []
    const first = children.length ? rangeOf(children[0]) : null
    const last = children.length ? rangeOf(children[children.length - 1]) : null
    if (first && last) {
      out.push({
        type: node.type === 'heading' ? 'heading' : 'paragraph',
        depth: node.depth,
        range: { start: first.start, end: last.end },
        children: toInlineNodes(source, children),
      })
    }
    return
  }
  for (const child of node.children ?? []) collectContainers(source, child, out)
}

/**
 * A-1 — 블록 소스 슬라이스를 기존 파이프라인으로 파싱해 인라인 모델을 만든다.
 * 파싱 실패 시 컨테이너 0개·rich=false 모델을 돌려준다(호출부는 소스 편집으로 폴백).
 */
export function buildInlineModel(blockSource: string, opts?: RichParseOptions): BlockInlineModel {
  const root = parseMarkdown(blockSource, opts)
  if (!root) return { source: blockSource, topTypes: [], containers: [], rich: false }
  const topChildren = root.children ?? []
  const containers: InlineContainer[] = []
  for (const child of topChildren) collectContainers(blockSource, child, containers)
  const rich =
    topChildren.length > 0 &&
    topChildren.every((child) => RICH_TOP_TYPES.has(child.type) && !hasExcluded(child))
  return {
    source: blockSource,
    topTypes: topChildren.map((child) => child.type),
    containers,
    rich,
  }
}

// ---- 표면용 평탄화 ----

/** 리프에 조상 서식을 모두 합친 형태 — 툴바 상태 표시·선택 영역 서식 적용의 입력. */
export interface FlatInlineAttrs {
  strong?: boolean
  emphasis?: boolean
  delete?: boolean
  underline?: boolean
  highlight?: boolean
  spoiler?: boolean
  ink?: string
  bg?: string
  size?: TextSize
  /** 링크 안이면 URL */
  link?: string
}

export interface FlatInline {
  /** 모델 트리의 리프 노드 그 자체(참조 — 여기에 dirty를 세우면 직렬화가 반영한다) */
  node: InlineTextNode | InlineAtomNode | InlineBreakNode
  attrs: FlatInlineAttrs
  /** 리프에서 조상까지의 경로(가장 안쪽 부모가 [0]) — 서식 해제 시 어떤 래퍼를 벗길지 판단용 */
  ancestors: InlineParentNode[]
}

type BoolAttrKey = 'strong' | 'emphasis' | 'delete' | 'underline' | 'highlight' | 'spoiler'

const MARK_ATTR_KEY: Record<WrapMark, BoolAttrKey> = {
  strong: 'strong',
  emphasis: 'emphasis',
  delete: 'delete',
  underline: 'underline',
  highlight: 'highlight',
  spoiler: 'spoiler',
}

function flattenInto(
  nodes: InlineNode[],
  attrs: FlatInlineAttrs,
  ancestors: InlineParentNode[],
  out: FlatInline[],
): void {
  for (const node of nodes) {
    if (node.kind === 'text' || node.kind === 'atom' || node.kind === 'break') {
      out.push({ node, attrs: { ...attrs }, ancestors: [...ancestors] })
      continue
    }
    const next: FlatInlineAttrs = { ...attrs }
    if (node.kind === 'wrap') next[MARK_ATTR_KEY[node.mark]] = true
    else if (node.kind === 'style') {
      if (node.attrs.ink) next.ink = node.attrs.ink
      if (node.attrs.bg) next.bg = node.attrs.bg
      if (node.attrs.size) next.size = node.attrs.size
    } else next.link = node.url
    flattenInto(node.children, next, [node, ...ancestors], out)
  }
}

/** 인라인 트리 → 리프 목록(조상 서식 병합). 트리 노드 참조를 그대로 물고 있다. */
export function flattenInline(nodes: InlineNode[]): FlatInline[] {
  const out: FlatInline[] = []
  flattenInto(nodes, {}, [], out)
  return out
}

/** 편집으로 새로 만든 텍스트 노드(위치 없음 = 항상 dirty). */
export function createTextNode(text: string): InlineTextNode {
  return { kind: 'text', text, range: null, raw: null, dirty: true }
}

/** 서브트리 전체를 dirty로 — 정규 표기 표를 강제로 태울 때(테스트·전면 재작성) 쓴다. */
export function markSubtreeDirty(node: InlineNode): void {
  node.dirty = true
  if (isParentNode(node)) node.children.forEach(markSubtreeDirty)
}
