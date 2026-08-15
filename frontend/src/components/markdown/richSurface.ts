// 리치 편집 표면 — 렌더된 DOM ↔ 인라인 모델 매핑 (설계 §5.3 S30 ⓑ·ⓕ·ⓖ·ⓙ / stage-30 B-2·B-7).
//
// 이 파일은 **파서도 렌더러도 아니다.** 파싱은 `inlineModel.ts`(기존 remark 파이프라인), 렌더는
// 공용 `MarkdownView`(sourcePos on)가 하고, 여기서는 그 둘을 이어 붙이는 일만 한다:
//   ① 스탬프(stamp) — 렌더된 DOM의 노드에 모델 노드 id(`data-il`)를 심는다. 텍스트 리프는
//      `<span data-il>`로 감싸고, 원자 노드(코드 스팬·수식·F43 참조 3종)는 `contenteditable=false`.
//   ② 읽기(sync) — 사용자가 편집한 DOM을 다시 읽어 모델 텍스트/구조에 반영한다(dirty 표시).
//   ③ 스냅샷(snapshot) — 모델을 직렬화(2층)하고 재파싱 동형성(3층)을 검사해 소스 문자열을 낸다.
//      캐럿·선택 위치는 **센티넬 문자**를 모델 텍스트에 끼워 함께 직렬화해 소스 오프셋으로 얻는다
//      (직렬화가 위치를 보고하지 않아도 되는, 계약을 건드리지 않는 방식).
//
// 정합이 깨지면(스탬프 실패·3층 실패) **언제나 소스 편집으로 폴백**한다 — 조용한 본문 변형 0이
// 이 파일의 유일한 불변 계약이며, 애매하면 실패를 택한다.
//
// 주의(1차 실측 계승): 모델 파이프라인은 remark-breaks **off**(break/text 노드에 position이 없어
// 2층 계약이 깨진다), 렌더는 breaks **on**이다. 그래서 DOM의 `<br>`에는 data-sp가 없을 수 있고,
// 매핑은 **data-sp가 있는 조상 + 텍스트 오프셋**으로만 한다(break 노드 position에 기대지 않는다).
import { buildInlineModel, createTextNode, isDirty, isParentNode } from './inlineModel'
import type {
  BlockInlineModel,
  InlineContainer,
  InlineNode,
  InlineParentNode,
  InlineRange,
  InlineTextNode,
} from './inlineModel'
import { isRoundTripSafe, serializeBlock } from './inlineSerialize'

/** 모델 노드 id를 심는 속성 — 표면 안에서만 쓰이고 본문(Markdown)에는 절대 남지 않는다. */
export const RICH_STAMP_ATTR = 'data-il'
/** 캐럿 위치를 직렬화 결과에서 되찾기 위한 임시 표식(본문에 남지 않는다). */
const SENTINEL = '\uE000'

export interface DomPoint {
  node: Node
  offset: number
}

interface DomRecord {
  node: Node
  /** 이 DOM 노드가 모델 텍스트의 몇 번째 문자에서 시작하는가 */
  start: number
  length: number
}

export interface RichSession {
  host: HTMLElement
  /** 세션을 연 시점의 블록 소스(모델이 파싱한 원본) */
  source: string
  model: BlockInlineModel
  /** 스탬프 id → 모델 노드 */
  registry: InlineNode[]
  containers: RichContainer[]
  charMap: Map<Node, { node: InlineTextNode; start: number }>
  domMap: Map<InlineTextNode, DomRecord[]>
}

interface RichContainer {
  container: InlineContainer
  el: HTMLElement
  /**
   * **빈 목록 항목**을 위해 표면이 만들어 낸 컨테이너(mdast에는 문단이 없다 — 그래서 캐럿이
   * 들어갈 모델 자리도 없다). 내용이 채워지기 전까지는 직렬화 대상에서 뺀다.
   */
  synthetic?: boolean
}

// ---- DOM 소도구 ----

function isText(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE
}

function isBr(node: Node): boolean {
  return isElement(node) && node.tagName === 'BR'
}

// 중첩 목록처럼 "다른 컨테이너의 영역"을 알아보는 최소 태그 집합(인라인 서식 태그는 없다).
const BLOCKISH_TAGS = new Set(['UL', 'OL', 'LI', 'P', 'BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

function isBlockish(node: Node): boolean {
  return isElement(node) && BLOCKISH_TAGS.has(node.tagName)
}

function stampIdOf(el: Element): number | null {
  const raw = el.getAttribute(RICH_STAMP_ATTR)
  if (raw === null) return null
  const id = Number(raw)
  return Number.isInteger(id) ? id : null
}

// ---- 스탬프(초기 1회) ----

interface SpEl {
  el: HTMLElement
  start: number
  end: number
}

function collectSpEls(host: HTMLElement): SpEl[] {
  const out: SpEl[] = []
  host.querySelectorAll<HTMLElement>('[data-sp-start][data-sp-end]').forEach((el) => {
    const start = Number(el.getAttribute('data-sp-start'))
    const end = Number(el.getAttribute('data-sp-end'))
    if (Number.isFinite(start) && Number.isFinite(end)) out.push({ el, start, end })
  })
  return out
}

/**
 * 컨테이너(문단·헤딩)의 **내용 범위**를 담는 가장 좁은 element를 찾는다.
 * 느슨하지 않은 목록 항목처럼 `<p>`가 사라진 경우엔 `<li>`가 잡힌다(둘 다 data-sp를 갖는다).
 * 범위가 같은 후보가 여럿이면(예: 문단 전체가 하나의 `**…**`) **바깥쪽**을 고른다.
 */
function findContainerEl(spEls: SpEl[], range: InlineRange): HTMLElement | null {
  let best: SpEl | null = null
  for (const cand of spEls) {
    if (cand.start > range.start || cand.end < range.end) continue
    // **블록 요소만** 후보다 — 문단·헤딩 전체가 하나의 인라인 서식(`## __제목__`)이면 그 인라인
    // 요소의 범위가 더 좁아 그쪽이 뽑히고, 그러면 정합이 깨져 소스 편집으로 떨어진다(실측).
    if (!isBlockish(cand.el)) continue
    if (!best) {
      best = cand
      continue
    }
    const span = cand.end - cand.start
    const bestSpan = best.end - best.start
    if (span < bestSpan) best = cand
    else if (span === bestSpan && cand.el.contains(best.el)) best = cand
  }
  return best?.el ?? null
}

function wrapRun(el: Element, run: ChildNode[], before: ChildNode | null, id: number): void {
  const span = el.ownerDocument.createElement('span')
  span.setAttribute(RICH_STAMP_ATTR, String(id))
  if (run.length > 0) {
    el.insertBefore(span, run[0])
    run.forEach((node) => span.appendChild(node))
    return
  }
  el.insertBefore(span, before)
}

/**
 * 모델 노드 목록을 el의 자식들과 **순서대로 맞춰** 스탬프한다.
 * 하나라도 어긋나면 false — 호출부는 리치 표면을 열지 않고 소스 편집으로 간다(보수적).
 */
function stampChildren(el: HTMLElement, nodes: InlineNode[], registry: InlineNode[]): boolean {
  const children = Array.from(el.childNodes)
  let i = 0

  for (const node of nodes) {
    if (node.kind === 'text') {
      const target = node.text
      const run: ChildNode[] = []
      let acc = ''
      while (i < children.length && acc.length < target.length) {
        const child = children[i]
        if (isText(child)) {
          acc += child.data
          run.push(child)
          i += 1
          continue
        }
        if (isBr(child)) {
          // 렌더는 breaks on이라 텍스트 안의 개행이 <br>로 나온다(모델에서는 같은 텍스트 리프).
          acc += '\n'
          run.push(child)
          i += 1
          continue
        }
        break
      }
      if (acc.length > target.length) {
        // DOM 텍스트 노드 하나가 모델 리프 경계를 넘어 병합된 경우 — 뒤쪽을 잘라 다음 리프에 남긴다.
        const last = run[run.length - 1]
        if (!last || !isText(last)) return false
        const over = acc.length - target.length
        if (over > last.data.length) return false
        const tail = last.splitText(last.data.length - over)
        children.splice(i, 0, tail)
        acc = acc.slice(0, target.length)
      }
      if (acc !== target) return false
      const id = registry.push(node) - 1
      wrapRun(el, run, children[i] ?? null, id)
      continue
    }

    const child = children[i]
    if (!child || !isElement(child)) return false
    if (node.kind === 'break' && !isBr(child)) return false
    const id = registry.push(node) - 1
    child.setAttribute(RICH_STAMP_ATTR, String(id))
    if (node.kind === 'atom') {
      // 원자 노드(코드 스팬·수식·참조 3종·미지 노드) — 캐럿이 안으로 들어가 문법이 드러나거나
      // 파괴되는 경로를 구조로 차단한다(내용 편집은 [소스로 편집]에서).
      child.setAttribute('contenteditable', 'false')
      child.setAttribute('data-rich-atom', '')
    }
    if (isParentNode(node) && !stampChildren(child, node.children, registry)) return false
    i += 1
  }

  return true
}

// ---- 읽기(DOM → 모델) ----

function sameNodes(a: InlineNode[], b: InlineNode[]): boolean {
  if (a.length !== b.length) return false
  return a.every((node, idx) => node === b[idx])
}

/** 위치 없는 노드가 생기면 직렬화의 구간 메우기가 무력해진다 — 이웃을 보고 0폭 범위를 채운다. */
function fixRanges(nodes: InlineNode[], cursorStart: number): void {
  let cursor = cursorStart
  for (const node of nodes) {
    if (node.range) {
      cursor = Math.max(cursor, node.range.end)
      continue
    }
    node.range = { start: cursor, end: cursor }
  }
}

/**
 * 사라진 노드는 **빈 텍스트 자리표시자**로 남긴다(같은 range 보존).
 * 그냥 빼 버리면 직렬화가 "노드 사이의 원본 구간"을 메우면서 지워진 내용을 되살린다.
 */
function patchRemoved(out: InlineNode[], original: InlineNode[]): InlineNode[] {
  const present = new Set(out)
  const result: InlineNode[] = []
  let oi = 0
  for (const orig of original) {
    if (present.has(orig)) {
      while (oi < out.length && out[oi] !== orig) {
        result.push(out[oi])
        oi += 1
      }
      result.push(out[oi])
      oi += 1
      continue
    }
    if (orig.range) {
      result.push({ kind: 'text', text: '', range: orig.range, raw: null, dirty: true })
    }
  }
  while (oi < out.length) {
    result.push(out[oi])
    oi += 1
  }
  return result
}

interface ReadCtx {
  registry: InlineNode[]
  charMap: Map<Node, { node: InlineTextNode; start: number }>
  domMap: Map<InlineTextNode, DomRecord[]>
}

function readNodes(el: HTMLElement, original: InlineNode[], ctx: ReadCtx, cursorStart: number): InlineNode[] {
  const out: InlineNode[] = []
  let buf = ''
  let owners: InlineTextNode[] = []
  /** 스탬프 밖(브라우저가 새로 만든) 텍스트가 섞였는가 */
  let foreign = false
  let records: DomRecord[] = []

  function absorb(node: ChildNode): void {
    if (isText(node)) {
      records.push({ node, start: buf.length, length: node.data.length })
      buf += node.data
      return
    }
    if (!isElement(node)) return
    if (isBr(node)) {
      records.push({ node, start: buf.length, length: 1 })
      buf += '\n'
      return
    }
    const id = stampIdOf(node)
    const stamped = id === null ? null : ctx.registry[id]
    if (stamped && (stamped.kind === 'atom' || stamped.kind === 'break')) {
      // 브라우저가 만든 껍데기 안에 원자 노드가 들어간 경우 — 표시 텍스트를 본문으로 삼으면
      // 참조·코드·수식이 평문으로 변질된다. 노드 자체를 살려 보낸다.
      flush()
      out.push(stamped)
      return
    }
    if (stamped) foreign = true
    node.childNodes.forEach(absorb)
  }

  function flush(): void {
    if (buf === '' && owners.length === 0 && records.length === 0) return
    let node: InlineTextNode
    if (owners.length === 1 && !foreign) {
      node = owners[0]
      if (node.text !== buf) {
        node.text = buf
        node.dirty = true
      }
    } else {
      node = createTextNode(buf)
      const first = owners[0]
      const last = owners[owners.length - 1]
      if (first?.range && last?.range) node.range = { start: first.range.start, end: last.range.end }
    }
    records.forEach((rec) => ctx.charMap.set(rec.node, { node, start: rec.start }))
    ctx.domMap.set(node, [...(ctx.domMap.get(node) ?? []), ...records])
    out.push(node)
    buf = ''
    owners = []
    foreign = false
    records = []
  }

  el.childNodes.forEach((child) => {
    if (isText(child)) {
      foreign = true
      absorb(child)
      return
    }
    if (!isElement(child)) return
    const id = stampIdOf(child)
    const node = id === null ? null : ctx.registry[id]
    if (!node) {
      // 스탬프 없는 블록 요소가 **다른 컨테이너의 스탬프를 품고 있으면** 그건 중첩 목록처럼
      // 남의 영역이다 — 건드리지 않는다(그 컨테이너가 자기 el에서 따로 읽는다).
      if (isBlockish(child) && child.querySelector(`[${RICH_STAMP_ATTR}]`)) return
      // 그 밖의 스탬프 없는 요소 = 브라우저가 만든 것 — 텍스트만 흡수하고 태그는 버린다.
      foreign = true
      absorb(child)
      return
    }
    if (node.kind === 'text') {
      owners.push(node)
      if (child.childNodes.length === 0) {
        // 빈 텍스트 리프(예: 갓 만든 빈 목록 항목) — 캐럿이 들어갈 수 있게 span 자체를 기록한다.
        records.push({ node: child, start: buf.length, length: 0 })
        return
      }
      child.childNodes.forEach(absorb)
      return
    }
    if (node.kind === 'break' || node.kind === 'atom') {
      flush()
      out.push(node)
      return
    }
    flush()
    const before = node.children
    const kids = readNodes(child, before, ctx, node.range?.start ?? cursorStart)
    if (!sameNodes(kids, before)) node.dirty = true
    node.children = kids
    out.push(node)
  })
  flush()

  const patched = patchRemoved(out, original)
  fixRanges(patched, cursorStart)
  return patched
}

/** 편집된 DOM을 모델에 반영한다(dirty 표시 포함). 캐럿 매핑용 인덱스도 이때 다시 만든다. */
export function syncSession(session: RichSession): void {
  const ctx: ReadCtx = { registry: session.registry, charMap: new Map(), domMap: new Map() }
  for (const { container, el } of session.containers) {
    container.children = readNodes(el, container.children, ctx, container.range.start)
  }
  session.charMap = ctx.charMap
  session.domMap = ctx.domMap
}

// ---- 세션 만들기 ----

/**
 * 빈 목록 항목(`- ` 한 줄)은 mdast에 문단이 없어 컨테이너도, 캐럿이 앉을 모델 자리도 없다.
 * Enter로 갓 만든 항목이 정확히 이 모양이므로, 그 `<li>`에 **빈 텍스트 리프 1개짜리 컨테이너**를
 * 만들어 붙인다(내용이 채워지기 전까지는 직렬화에서 빠진다 — 소스는 1바이트도 달라지지 않는다).
 */
function addEmptyItemContainers(
  host: HTMLElement,
  source: string,
  model: BlockInlineModel,
  registry: InlineNode[],
  containers: RichContainer[],
): void {
  host.querySelectorAll('li').forEach((li) => {
    if (li.querySelector(`[${RICH_STAMP_ATTR}]`)) return
    if ((li.textContent ?? '').trim() !== '') return
    const start = Number(li.getAttribute('data-sp-start'))
    if (!Number.isFinite(start)) return
    // 마커·뒤 공백을 지난 자리(= 그 항목의 내용이 들어갈 오프셋).
    const at = parseLine(source, start).contentStart
    const range: InlineRange = { start: at, end: at }
    const node: InlineTextNode = { kind: 'text', text: '', range, raw: null, dirty: false }
    const container: InlineContainer = { type: 'paragraph', range, children: [node] }
    const span = li.ownerDocument.createElement('span')
    span.setAttribute(RICH_STAMP_ATTR, String(registry.push(node) - 1))
    li.appendChild(span)
    containers.push({ container, el: li, synthetic: true })
    model.containers.push(container) // 직렬화는 range 기준으로 정렬하므로 순서는 상관없다
  })
}

/**
 * 렌더된 DOM(host) 위에 리치 편집 세션을 세운다. 리치 대상이 아니거나 DOM↔모델 정합이
 * 어긋나면 null — 호출부는 S27 소스 textarea로 간다(회귀 0).
 */
export function buildRichSession(host: HTMLElement, source: string): RichSession | null {
  const model = buildInlineModel(source)
  if (!model.rich || model.containers.length === 0) return null
  const spEls = collectSpEls(host)
  const registry: InlineNode[] = []
  const containers: RichContainer[] = []
  for (const container of model.containers) {
    const el = findContainerEl(spEls, container.range)
    if (!el) return null
    if (!stampChildren(el, container.children, registry)) return null
    containers.push({ container, el })
  }
  addEmptyItemContainers(host, source, model, registry, containers)
  const session: RichSession = {
    host,
    source,
    model,
    registry,
    containers,
    charMap: new Map(),
    domMap: new Map(),
  }
  // 갓 스탬프한 DOM을 한 번 읽어 캐럿 매핑 인덱스를 채운다(내용은 그대로라 dirty가 생기지 않는다).
  syncSession(session)
  return session
}

// ---- 캐럿·선택 ↔ 모델 ----

function firstTextRecord(node: Node): Node | null {
  if (isText(node) || isBr(node)) return node
  if (!isElement(node)) return null
  for (const child of Array.from(node.childNodes)) {
    const found = firstTextRecord(child)
    if (found) return found
  }
  return null
}

function lastTextRecord(node: Node): Node | null {
  if (isText(node) || isBr(node)) return node
  if (!isElement(node)) return null
  const children = Array.from(node.childNodes)
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const found = lastTextRecord(children[i])
    if (found) return found
  }
  return null
}

/** DOM 캐럿 → (모델 텍스트 노드, 그 안의 문자 오프셋). 못 찾으면 null. */
function domPointToModel(
  session: RichSession,
  point: DomPoint,
): { node: InlineTextNode; char: number } | null {
  const { node, offset } = point
  if (isText(node)) {
    const rec = session.charMap.get(node)
    if (!rec) return null
    return { node: rec.node, char: rec.start + Math.min(offset, node.data.length) }
  }
  if (!isElement(node)) return null
  // 빈 텍스트 리프의 span 자체에 캐럿이 있는 경우(갓 만든 목록 항목).
  const selfRec = session.charMap.get(node)
  if (selfRec) return { node: selfRec.node, char: selfRec.start }
  const children = Array.from(node.childNodes)
  // 요소 안의 자식 경계에 캐럿이 있는 경우 — 앞/뒤 텍스트 노드로 접어 준다.
  const after = children[offset] ? firstTextRecord(children[offset]) : null
  if (after) {
    const rec = session.charMap.get(after)
    if (rec) return { node: rec.node, char: rec.start }
  }
  const beforeNode = offset > 0 ? lastTextRecord(children[offset - 1]) : null
  if (beforeNode) {
    const rec = session.charMap.get(beforeNode)
    if (rec) {
      const len = isText(beforeNode) ? beforeNode.data.length : 1
      return { node: rec.node, char: rec.start + len }
    }
  }
  const inner = firstTextRecord(node)
  if (inner) {
    const rec = session.charMap.get(inner)
    if (rec) return { node: rec.node, char: rec.start }
  }
  return null
}

/** 소스 오프셋 → DOM 위치(가장 가까운 텍스트 리프 기준). */
function sourceOffsetToDom(session: RichSession, offset: number): DomPoint | null {
  const leaves: InlineTextNode[] = []
  for (const { container } of session.containers) collectTextLeaves(container.children, leaves)
  if (leaves.length === 0) return null

  let target: InlineTextNode | null = null
  let char = 0
  for (const leaf of leaves) {
    if (!leaf.range) continue
    if (offset >= leaf.range.start && offset <= leaf.range.end) {
      target = leaf
      char = Math.min(Math.max(0, offset - leaf.range.start), leaf.text.length)
      break
    }
  }
  if (!target) {
    // 오프셋이 원자 노드·문법 기호 위라면 그 뒤(또는 마지막) 텍스트 리프로 붙인다.
    const following = leaves.find((leaf) => (leaf.range?.start ?? 0) >= offset)
    target = following ?? leaves[leaves.length - 1]
    char = following ? 0 : target.text.length
  }

  const records = session.domMap.get(target) ?? []
  if (records.length === 0) return null
  for (const rec of records) {
    if (char <= rec.start + rec.length) {
      if (isText(rec.node)) return { node: rec.node, offset: Math.max(0, char - rec.start) }
      // 빈 텍스트 리프의 span — 그 안이 캐럿 자리다.
      if (!isBr(rec.node)) return { node: rec.node, offset: 0 }
      // <br> 위치 — 그 앞/뒤 경계로 접는다.
      const parent = rec.node.parentNode
      if (!parent) return null
      const idx = Array.from(parent.childNodes).indexOf(rec.node as ChildNode)
      return { node: parent, offset: char <= rec.start ? idx : idx + 1 }
    }
  }
  const last = records[records.length - 1]
  if (isText(last.node)) return { node: last.node, offset: last.node.data.length }
  return null
}

function collectTextLeaves(nodes: InlineNode[], out: InlineTextNode[]): void {
  for (const node of nodes) {
    if (node.kind === 'text') out.push(node)
    else if (isParentNode(node)) collectTextLeaves(node.children, out)
  }
}

/** 소스 오프셋 구간을 화면 선택으로 되돌린다(툴바 적용 후 "선택 유지"의 실체). */
export function applySelection(session: RichSession, start: number, end: number): void {
  const from = sourceOffsetToDom(session, start)
  const to = sourceOffsetToDom(session, end)
  if (!from) return
  const sel = session.host.ownerDocument.defaultView?.getSelection()
  if (!sel) return
  const range = session.host.ownerDocument.createRange()
  try {
    range.setStart(from.node, from.offset)
    if (to) range.setEnd(to.node, to.offset)
    else range.collapse(true)
  } catch {
    return
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

export function placeCaretAtEnd(session: RichSession): void {
  const sel = session.host.ownerDocument.defaultView?.getSelection()
  if (!sel) return
  const range = session.host.ownerDocument.createRange()
  range.selectNodeContents(session.host)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

// ---- 빈 노드 정리 ----

function hasContent(nodes: InlineNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'atom' || node.kind === 'break') return true
    if (node.kind === 'text') return node.text !== ''
    return hasContent(node.children)
  })
}

/**
 * 내용이 통째로 지워진 서식 래퍼는 기호만 남기지 않고 없앤다(`**` `**` → 아무것도 아님).
 * 편집된(dirty) 서브트리에만 적용한다 — 손대지 않은 노드는 2층 계약대로 슬라이스 그대로다.
 */
function pruneEmpty(nodes: InlineNode[]): InlineNode[] {
  return nodes.map((node) => {
    if (!isParentNode(node)) return node
    node.children = pruneEmpty(node.children)
    if (!isDirty(node) || hasContent(node.children)) return node
    const placeholder: InlineTextNode = {
      kind: 'text',
      text: '',
      range: node.range,
      raw: null,
      dirty: true,
    }
    return placeholder
  })
}

/** 그 컨테이너 서브트리에 이 노드가 들어 있는가(캐럿이 어느 컨테이너에 있는지 판정). */
function containerHas(container: InlineContainer, target: InlineNode): boolean {
  const walk = (nodes: InlineNode[]): boolean =>
    nodes.some((node) => node === target || (isParentNode(node) && walk(node.children)))
  return walk(container.children)
}

// ---- 스냅샷(모델 → 소스 + 캐럿 오프셋) ----

export type RichSnapshot =
  | { ok: true; source: string; offsets: number[] }
  | { ok: false; source: string }

/**
 * 편집된 평문(text)의 인덱스를 **원본 슬라이스(raw)** 의 인덱스로 옮긴다.
 * 이스케이프(`\*`)·문자 참조(`&amp;`)는 raw에서 여러 글자, text에서 한 글자라 단순 인덱스가
 * 어긋난다. 캐럿 위치 계산 전용이므로 정확도가 조금 떨어져도 **본문은 영향받지 않는다**
 * (표식은 출력 문자열에만 끼워 넣고 모델의 편집 상태는 건드리지 않는다).
 */
function textIndexToRawIndex(raw: string, index: number): number {
  let ri = 0
  let ti = 0
  while (ti < index && ri < raw.length) {
    if (raw[ri] === '\\' && ri + 1 < raw.length) {
      ri += 2
      ti += 1
      continue
    }
    if (raw[ri] === '&') {
      const entity = /^&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(raw.slice(ri))
      if (entity) {
        ri += entity[0].length
        ti += 1
        continue
      }
    }
    ri += 1
    ti += 1
  }
  return Math.min(ri, raw.length)
}

/**
 * 캐럿·선택 위치를 직렬화 결과에서 되찾기 위한 표식을 심는다(되돌리는 함수를 반환).
 *
 * **2층 계약(중요)**: 편집하지 않은 노드는 `dirty`로 세우지 않는다 — 세우면 그 노드가 정규 표기로
 * 다시 쓰여(`__굵게__`→`**굵게**`, `&lt;`→`<`, NBSP→공백) **무편집 진입만으로 본문이 바뀐다**.
 * 그래서 미편집 노드에는 **원본 슬라이스(raw) 안에 표식만** 끼워 넣는다 — 직렬화가 그 슬라이스를
 * 그대로 뱉으므로 결과는 "깨끗한 직렬화 + 표식 1글자"와 정확히 같고, 표식을 빼면 원본으로 돌아온다.
 * 이미 편집된(dirty) 노드에만 종전처럼 text에 넣는다(그 노드는 어차피 다시 쓰인다).
 */
function findMarkPath(container: InlineContainer, target: InlineNode): InlineParentNode[] | null {
  const walk = (nodes: InlineNode[], acc: InlineParentNode[]): InlineParentNode[] | null => {
    for (const node of nodes) {
      if (node === target) return acc
      if (isParentNode(node)) {
        const found = walk(node.children, [...acc, node])
        if (found) return found
      }
    }
    return null
  }
  return walk(container.children, [])
}

/**
 * 표식을 실제로 **출력하는 노드**와 그 안에서의 위치를 찾는다.
 * 직렬화는 미편집 노드를 만나면 그 자리에서 원본 슬라이스를 통째로 뱉고 자식으로 내려가지 않는다 —
 * 그래서 `__굵게__` 안쪽 텍스트에 표식을 넣어 봐야 출력에 나타나지 않는다(실측). **바깥쪽부터
 * 훑어 가장 먼저 만나는 미편집 노드**가 표식을 실을 주인이다.
 */
function resolveMarkTarget(
  containers: InlineContainer[],
  node: InlineTextNode,
  char: number,
): { node: InlineNode; index: number } | null {
  if (node.dirty || node.raw === null || !node.range) return null
  const local = textIndexToRawIndex(node.raw, char)
  const abs = node.range.start + local
  for (const container of containers) {
    const path = findMarkPath(container, node)
    if (!path) continue
    for (const ancestor of path) {
      if (!isDirty(ancestor) && ancestor.raw !== null && ancestor.range) {
        const index = Math.min(Math.max(0, abs - ancestor.range.start), ancestor.raw.length)
        return { node: ancestor, index }
      }
    }
    break
  }
  return { node, index: local }
}

function applyCaretMarks(
  marks: { node: InlineTextNode; char: number }[],
  containers: InlineContainer[],
): () => void {
  const edits = marks.map((mark) => {
    const char = Math.min(Math.max(0, mark.char), mark.node.text.length)
    const target = resolveMarkTarget(containers, mark.node, char)
    return target
      ? { kind: 'raw' as const, node: target.node, index: target.index }
      : { kind: 'text' as const, node: mark.node, index: char }
  })
  // 같은 문자열 안에서는 뒤에서부터 넣어야 앞 위치가 밀리지 않는다(대상이 다르면 서로 무관).
  edits.sort((a, b) => b.index - a.index)

  const undo: (() => void)[] = []
  for (const edit of edits) {
    if (edit.kind === 'raw') {
      const node = edit.node
      const savedRaw = node.raw ?? ''
      node.raw = `${savedRaw.slice(0, edit.index)}${SENTINEL}${savedRaw.slice(edit.index)}`
      undo.push(() => {
        node.raw = savedRaw
      })
      continue
    }
    const node = edit.node
    const savedText = node.text
    const savedDirty = node.dirty
    node.text = `${savedText.slice(0, edit.index)}${SENTINEL}${savedText.slice(edit.index)}`
    node.dirty = true
    undo.push(() => {
      node.text = savedText
      node.dirty = savedDirty
    })
  }
  return () => {
    for (let i = undo.length - 1; i >= 0; i -= 1) undo[i]()
  }
}

/**
 * 지금 DOM 상태를 블록 소스로 직렬화하고(2층) 재파싱 동형성을 검사한다(3층).
 * `points`(DOM 캐럿/선택 경계)는 표식을 태워 **소스 오프셋**으로 함께 돌려준다.
 *
 * 직렬화는 **두 번**이다 — ⓐ 오프셋용(표식 포함, 모델의 편집 상태 불변) ⓑ **본문용**(실제 편집으로
 * dirty가 된 노드만 반영). 본문 커밋에 쓰이는 것은 언제나 ⓑ이고, 무편집이면 ⓑ는 원본과 1바이트도
 * 다르지 않다(그래서 확정 시 onChange 자체가 발화하지 않는다).
 */
export function snapshotSource(session: RichSession, points: DomPoint[]): RichSnapshot {
  syncSession(session)

  for (const { container } of session.containers) {
    container.children = pruneEmpty(container.children)
  }

  const marks = points
    .map((point) => domPointToModel(session, point))
    .filter((mark): mark is { node: InlineTextNode; char: number } => mark !== null)

  // 3층 동형성 검사는 컨테이너를 **배열 순서대로** 비교한다 — 표면이 나중에 덧붙인 컨테이너가
  // 섞여도 항상 문서 순서(소스 오프셋 순)여야 한다.
  const byOffset = (a: RichContainer, b: RichContainer) => a.container.range.start - b.container.range.start
  // 표면이 만든 빈 항목 컨테이너는 **내용이 생겼을 때만** 본문 직렬화·검사에 참여한다(그냥 두면
  // 원본에 없던 문단이 생겨 3층 검사가 어긋난다). 오프셋 계산에는 캐럿이 든 것도 넣는다.
  const body = session.containers
    .filter((entry) => !entry.synthetic || hasContent(entry.container.children))
    .sort(byOffset)
  const withMarks = session.containers
    .filter(
      (entry) =>
        !entry.synthetic ||
        hasContent(entry.container.children) ||
        marks.some((mark) => containerHas(entry.container, mark.node)),
    )
    .sort(byOffset)

  // ⓐ 오프셋용 직렬화 — 표식은 출력에만 들어가고 모델의 편집 상태(dirty)는 그대로다.
  session.model.containers = withMarks.map((entry) => entry.container)
  const restoreMarks = applyCaretMarks(
    marks,
    withMarks.map((entry) => entry.container),
  )
  const withSentinel = serializeBlock(session.model)
  restoreMarks()

  // ⓑ 본문용 직렬화 + 3층 검사 — 실제 편집으로 dirty가 된 노드만 반영된다.
  session.model.containers = body.map((entry) => entry.container)
  const source = serializeBlock(session.model)
  // 컨테이너가 하나도 없는 경우(빈 항목만 있는 목록 등)는 "다 지웠다"가 아니다 — 원본을 지킨다.
  const empty = body.length > 0 && body.every((entry) => !hasContent(entry.container.children))
  const safe = isRoundTripSafe(session.model, source)

  const positions: number[] = []
  let idx = withSentinel.indexOf(SENTINEL)
  while (idx !== -1) {
    positions.push(idx)
    idx = withSentinel.indexOf(SENTINEL, idx + 1)
  }
  const stripped = withSentinel.split(SENTINEL).join('')
  // 미편집 노드는 슬라이스에 표식만 끼워 넣으므로 두 문자열은 정확히 표식 개수만큼만 다르다.
  // 이미 편집된 노드는 이스케이프가 표식을 사이에 두고 갈릴 수 있어(드묾) 그때는 오프셋만 보정한다.
  const aligned = stripped === source
  const offsets = positions.map((pos, order) => {
    const raw = pos - order
    return aligned ? raw : Math.min(raw, source.length)
  })

  // 내용이 전부 지워졌으면 빈 블록 — S27 ⓔ(블록 제거)와 같은 결과로 넘긴다.
  if (empty) return { ok: true, source: '', offsets: offsets.map(() => 0) }
  if (!safe) return { ok: false, source }
  return { ok: true, source, offsets }
}

// ---- 목록·인용 줄 조작(설계 S30 ⓕ) — 전부 순수 문자열 연산 ----

interface LineParts {
  start: number
  end: number
  quote: string
  indent: string
  /** `-`·`*`·`+` 또는 `1.`·`1)` 전체 문자열. 목록이 아니면 null */
  marker: string | null
  ordered: number | null
  delim: string
  space: string
  contentStart: number
  content: string
}

// 목록 마커는 **뒤에 공백(또는 줄 끝)이 있어야** 마커다(CommonMark) — 이 전방탐색이 없으면
// `**굵게**`로 시작하는 줄이 `*` 항목으로 오독돼 Enter가 본문을 망가뜨린다(실측 확인).
const LINE_RE = /^((?:[ \t]*>[ \t]?)*)([ \t]*)(?:(?:([-*+])|(\d{1,9})([.)]))(?=[ \t]|$))?([ \t]*)/

function parseLine(source: string, offset: number): LineParts {
  const clamped = Math.min(Math.max(0, offset), source.length)
  const start = source.lastIndexOf('\n', clamped - 1) + 1
  const nl = source.indexOf('\n', clamped)
  const end = nl === -1 ? source.length : nl
  const line = source.slice(start, end)
  const m = LINE_RE.exec(line)
  const quote = m?.[1] ?? ''
  const indent = m?.[2] ?? ''
  const bullet = m?.[3]
  const num = m?.[4]
  const delim = m?.[5] ?? ''
  const space = m?.[6] ?? ''
  const marker = bullet ?? (num !== undefined ? `${num}${delim}` : null)
  const contentStart = start + (m?.[0].length ?? 0)
  return {
    start,
    end,
    quote,
    indent,
    marker,
    ordered: num !== undefined ? Number(num) : null,
    delim,
    space,
    contentStart,
    content: source.slice(contentStart, end),
  }
}

function removeLine(source: string, line: LineParts): string {
  if (line.end >= source.length) {
    return line.start > 0 ? source.slice(0, line.start - 1) : ''
  }
  return `${source.slice(0, line.start)}${source.slice(line.end + 1)}`
}

export type LineOp =
  /** 블록 안에서 해결되는 조작 — 새 소스로 다시 렌더하고 캐럿을 옮긴다 */
  | { kind: 'replace'; source: string; caret: number }
  /** 목록·인용 해제(문단화) — 블록에서 그 줄을 빼고 뒤에 새 블록을 연다 */
  | { kind: 'demote'; source: string }

/**
 * Enter 규약(설계 ⓕ). 문단·헤딩에서는 null(= 미지원, 호출부가 preventDefault만 한다).
 * 빈 항목에서의 Backspace도 같은 결과를 쓴다("위 강등과 같은 결과").
 */
/**
 * 줄을 쪼개는 조작(Enter)에서 캐럿이 **인라인 서식 기호 안**에 있으면 바깥으로 밀어낸다.
 * 화면상 "굵은 글자의 끝"은 소스에서 `**둘|**`(닫는 기호 앞)이라 그대로 자르면 `**둘` + `**`로
 * 문법이 깨진다 — 사용자 의도(그 서식의 바깥 끝)로 맞춘다.
 */
function snapOutOfMarkers(source: string, offset: number): number {
  const model = buildInlineModel(source)
  let out = offset
  const visit = (nodes: InlineNode[]): void => {
    for (const node of nodes) {
      if (!isParentNode(node)) continue
      const range = node.range
      const first = node.children.find((child) => child.range)?.range
      const last = [...node.children].reverse().find((child) => child.range)?.range
      if (range && first && last) {
        if (out >= last.end && out < range.end) out = range.end
        else if (out <= first.start && out > range.start) out = range.start
      }
      visit(node.children)
    }
  }
  for (const container of model.containers) visit(container.children)
  return out
}

export function enterOp(source: string, rawCaret: number): LineOp | null {
  const caret = snapOutOfMarkers(source, rawCaret)
  const line = parseLine(source, caret)
  const empty = line.content.trim() === ''

  if (line.marker !== null) {
    if (!empty) {
      const marker = line.ordered !== null ? `${line.ordered + 1}${line.delim}` : line.marker
      const space = line.space || ' '
      const insert = `\n${line.quote}${line.indent}${marker}${space}`
      return {
        kind: 'replace',
        source: `${source.slice(0, caret)}${insert}${source.slice(caret)}`,
        caret: caret + insert.length,
      }
    }
    if (line.indent.length > 0) {
      // 중첩 항목 — 한 수준 내어쓰기(2칸 관례).
      const indent = line.indent.slice(0, Math.max(0, line.indent.length - 2))
      const marker = line.ordered !== null ? `${line.ordered}${line.delim}` : line.marker
      const next = `${line.quote}${indent}${marker}${line.space || ' '}`
      return {
        kind: 'replace',
        source: `${source.slice(0, line.start)}${next}${source.slice(line.end)}`,
        caret: line.start + next.length,
      }
    }
    return { kind: 'demote', source: removeLine(source, line) }
  }

  // 인용은 여기서 다루지 않는다 — "인용 안 줄바꿈"은 소스에 빈 줄로 존재할 수 없어(Markdown이
  // 표현하지 못한다) DOM 줄바꿈(<br> = 문단 안 개행)으로 처리하고, 빈 인용 줄의 해제만
  // `quoteReleaseOp`가 맡는다. 문단·헤딩의 Enter(블록 분할)는 이 단계에서 하지 않는 조작이다.
  return null
}

/** 캐럿이 있는 줄이 ATX 헤딩(`#`~`######`)인가 — 헤딩 안 개행은 의미가 없어 Enter를 무시한다. */
export function lineIsHeadingAt(source: string, caret: number): boolean {
  return /^#{1,6}(\s|$)/.test(parseLine(source, caret).content)
}

/** 캐럿이 있는 줄에 내용이 없는가(빈 인용 줄 판정 — 해제 규약의 조건). */
export function lineIsEmptyAt(source: string, caret: number): boolean {
  return parseLine(source, caret).content.trim() === ''
}

/** 빈 인용 줄에서의 해제(문단화) — 그 줄을 걷어 낸 소스. */
export function quoteReleaseOp(source: string, caret: number): LineOp {
  return { kind: 'demote', source: removeLine(source, parseLine(source, caret)) }
}
