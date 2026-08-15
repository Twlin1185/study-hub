// WYSIWYG 인라인 편집 — 모델 → Markdown 직렬화와 재파싱 동형성 검사
// (설계 §5.3 S30 ⓑ 2층·3층 / stage-30 A-3·A-4).
//
// **2층 계약**: dirty가 아닌 노드는 정규 표기 표를 타지 않고 **원본 슬라이스를 그대로 재출력**한다.
// `node.value`에서는 백슬래시 이스케이프가 이미 풀려 있으므로 값 재직렬화는 `\*`를 소실시킨다 —
// 그래서 "모델 값 재직렬화 금지, 슬라이스 사용"이 규약이다. `__굵게__`도 `**`로 정규화되지 않는다.
//
// **직렬화 단위 = 구간 치환**: 블록 소스에서 각 인라인 컨테이너(문단·헤딩)의 **내용 범위**만
// 새 문자열로 갈아 끼운다. 헤딩 `#` 접두·목록 마커·인용 `>` 접두는 범위 밖이라 손대지 않는다
// (S27 1층 계약의 블록 내부 판박이).
//
// **3층(안전 밸브)**: 직렬화 결과를 다시 파싱해 인라인 트리(노드 종류·순서·평문 텍스트)가
// 모델과 동형인지 검사한다. 어긋나면 호출부가 그 편집을 적용하지 않고 소스 편집으로 폴백한다.
import { buildInlineModel, flattenInline, isDirty } from './inlineModel'
import type {
  AttrPair,
  BlockInlineModel,
  InlineContainer,
  InlineNode,
  InlineParentNode,
  RichParseOptions,
  WrapMark,
} from './inlineModel'

// ---- 정규 표기 표(설계 S30 ⓑ — dirty 노드에만 적용) ----

const WRAP_MARKER: Record<WrapMark, string> = {
  strong: '**', // `__`는 읽기만(미편집 시 슬라이스 보존)
  emphasis: '*', // `_`는 읽기만
  delete: '~~', // GFM
  underline: '++', // F52 마이크로
  highlight: '==', // 기본 노랑(색 지정은 :t{bg=…})
  spoiler: '||', // F52 마이크로
}

// ---- 이스케이프 ----

// 어디에 있든 인라인 구문을 열 수 있는 문자.
const ALWAYS_ESCAPE = new Set(['\\', '*', '_', '`', '[', ']', '~', '$'])

function isLineStart(text: string, i: number): boolean {
  return i === 0 || text[i - 1] === '\n'
}

// 줄머리에서만 블록 구문이 되는 문자들(`#` 헤딩 · `>` 인용 · `-`/`+` 목록·구분선 · `1.` 순서목록).
function needsLineStartEscape(text: string, i: number): boolean {
  const rest = text.slice(i)
  if (/^#{1,6}(\s|$)/.test(rest)) return true
  if (rest[0] === '>') return true
  if (/^[-+](\s|$)/.test(rest)) return true
  if (/^-{3,}\s*(\n|$)/.test(rest)) return true
  return false
}

/**
 * 편집된 평문을 Markdown 소스로 되돌릴 때의 이스케이프.
 * 목표는 "우연히 문법이 되어 본문이 조용히 변형되는 것"의 차단이며, 과잉 이스케이프로 소스가
 * 지저분해지지 않게 **문맥상 실제로 위험한 자리만** 막는다(최종 방어선은 3층 동형성 검사).
 */
export function escapeInlineText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1] ?? ''
    if (ALWAYS_ESCAPE.has(ch)) {
      out += `\\${ch}`
      continue
    }
    // 마이크로 3종(`++`·`==`·`||`)은 두 글자 표식일 때만 문법이다 — 앞 글자만 막으면 충분하다.
    if ((ch === '=' || ch === '+' || ch === '|') && next === ch) {
      out += `\\${ch}`
      continue
    }
    // 표 구분자(GFM)·`|` 단독은 문단 안에서 무해하지만, 줄머리 `|`는 표 행이 될 수 있다.
    if (ch === '|' && isLineStart(text, i)) {
      out += '\\|'
      continue
    }
    if (ch === '!' && next === '[') {
      out += '\\!'
      continue
    }
    if (ch === '<' && /[A-Za-z/!?]/.test(next)) {
      out += '\\<'
      continue
    }
    if (ch === '&' && /^&[#0-9A-Za-z]{1,32};/.test(text.slice(i))) {
      out += '\\&'
      continue
    }
    // directive(`:t[…]{…}` · `:::name`) — 실제 directive 모양일 때만 막는다.
    if (ch === ':' && (/^:{3,}/.test(text.slice(i)) || /^:[A-Za-z][A-Za-z0-9-]*[[{]/.test(text.slice(i)))) {
      out += '\\:'
      continue
    }
    if (isLineStart(text, i) && needsLineStartEscape(text, i)) {
      out += `\\${ch}`
      continue
    }
    if (isLineStart(text, i) && /^\d{1,9}[.)](\s|$)/.test(text.slice(i))) {
      // 숫자 자체는 이스케이프할 수 없으므로 구분자(`.`/`)`)를 막는다.
      const m = /^(\d{1,9})([.)])/.exec(text.slice(i)) as RegExpExecArray
      out += `${m[1]}\\${m[2]}`
      i += m[0].length - 1
      continue
    }
    out += ch
  }
  return out
}

// 여러 줄에 걸친 텍스트 노드는 원본에서 각 줄이 인용 `>`·들여쓰기 같은 **줄머리 접두**를 달고
// 있을 수 있다(예: `> a\n> b`의 text 노드 슬라이스 = "a\n> b"). dirty 텍스트를 새로 쓸 때 그
// 접두를 잃으면 블록이 깨지므로, 원본 슬라이스에서 줄별 접두를 뽑아 다시 입힌다.
const LINE_PREFIX_RE = /^[ \t]*(?:>[ \t]?)*/

function reapplyLinePrefixes(raw: string | null, serialized: string): string {
  if (!raw || !raw.includes('\n') || !serialized.includes('\n')) return serialized
  const prefixes = raw.split('\n').slice(1).map((line) => LINE_PREFIX_RE.exec(line)?.[0] ?? '')
  if (prefixes.every((prefix) => prefix === '')) return serialized
  const fallback = prefixes[prefixes.length - 1] ?? ''
  return serialized
    .split('\n')
    .map((line, idx) => (idx === 0 ? line : `${prefixes[idx - 1] ?? fallback}${line}`))
    .join('\n')
}

// ---- `:t[…]{…}` 속성 병합 ----

function attrString(pairs: AttrPair[]): string {
  return pairs
    .map(([key, value]) => {
      if (value === '') return key
      // 원본에 없던 형태를 만들지 않도록, 공백·닫는 중괄호가 있을 때만 따옴표로 감싼다.
      return /[\s"'}]/.test(value) ? `${key}="${value.replace(/(["\\])/g, '\\$1')}"` : `${key}=${value}`
    })
    .join(' ')
}

/**
 * 같은 구간에 겹친 `:t` 래퍼를 하나로 접는다 — `:t[:t[…]{…}]{…}` 중첩을 만들지 않는다
 * (2026-08-14 툴바 병합 구현 계승 — 같은 키는 새 값으로 교체, 다른 키는 순서 보존).
 * 안쪽(텍스트에 더 가까운) 값이 렌더에서 이기므로 병합에서도 **안쪽 값이 우선**한다.
 * 자식이 정확히 style 노드 하나일 때만 접는다(구간이 다르면 병합 불가).
 */
function collapseStyleChain(node: InlineNode): { pairs: AttrPair[]; children: InlineNode[] } {
  const pairs: AttrPair[] = []
  const put = (key: string, value: string) => {
    const idx = pairs.findIndex(([k]) => k === key)
    if (idx === -1) pairs.push([key, value])
    else pairs[idx] = [key, value]
  }
  let current: InlineNode = node
  while (current.kind === 'style') {
    // 바깥부터 훑되 안쪽 값이 덮어쓴다(순서는 처음 등장한 자리 유지).
    for (const [key, value] of current.attrPairs) put(key, value)
    const kids: InlineNode[] = current.children
    if (kids.length === 1 && kids[0].kind === 'style') {
      current = kids[0]
      continue
    }
    return { pairs, children: kids }
  }
  return { pairs, children: [current] }
}

// ---- 링크 URL ----

function serializeUrl(url: string): string {
  // 공백·괄호가 있으면 `<…>` 형태로(CommonMark). 그 외는 그대로 둔다(원본 보존 성향).
  if (url === '') return ''
  if (/[\s()<>]/.test(url)) return `<${url.replace(/([<>\\])/g, '\\$1')}>`
  return url
}

function serializeTitle(title: string | null | undefined): string {
  if (!title) return ''
  return ` "${title.replace(/(["\\])/g, '\\$1')}"`
}

// ---- 직렬화 ----

interface SerializeCtx {
  source: string
}

function serializeChildren(
  children: InlineNode[],
  range: { start: number; end: number } | null,
  ctx: SerializeCtx,
): string {
  let out = ''
  let cursor = range?.start ?? null
  for (const child of children) {
    if (child.range && cursor !== null && child.range.start > cursor) {
      // 노드 사이에 남은 원본 문자(인용 접두·경성 줄바꿈 잔여 등)는 그대로 흘려 보낸다.
      out += ctx.source.slice(cursor, child.range.start)
    }
    out += serializeNode(child, ctx)
    // 위치 없는 노드(편집으로 새로 생긴 노드 등)를 지나면 커서를 무효화한다 — 그렇지 않으면
    // 그 노드가 덮은 원본 구간을 아래 "빈 구간 메우기"가 **한 번 더** 출력한다(중복 방어).
    cursor = child.range ? child.range.end : null
  }
  if (range && cursor !== null && cursor < range.end) out += ctx.source.slice(cursor, range.end)
  return out
}

function serializeParent(node: InlineParentNode, ctx: SerializeCtx): string {
  // 부모의 **내용 범위** = 첫 자식 시작 ~ 마지막 자식 끝(래퍼 기호는 여기서 다시 붙인다).
  const kids = node.children
  const first = kids.find((k) => k.range)?.range ?? null
  const lastWithRange = [...kids].reverse().find((k) => k.range)?.range ?? null
  const innerRange = first && lastWithRange ? { start: first.start, end: lastWithRange.end } : null
  return serializeChildren(kids, innerRange, ctx)
}

export function serializeNode(node: InlineNode, ctx: SerializeCtx): string {
  // 2층 — 서브트리에 편집이 없으면 원본 슬라이스 그대로(정규 표기 표를 타지 않는다).
  if (!isDirty(node) && node.raw !== null) return node.raw

  switch (node.kind) {
    case 'text':
      return reapplyLinePrefixes(node.raw, escapeInlineText(node.text))
    case 'break':
      // 경성 줄바꿈은 원본 표기(공백 2칸 또는 `\`)를 살리고, 신규는 개행 1개.
      return node.raw ?? '\n'
    case 'atom':
      // 원자 노드는 내용 편집 대상이 아니다 — 언제나 원본 슬라이스.
      return node.raw ?? node.text
    case 'link': {
      const inner = serializeParent(node, ctx)
      return `[${inner}](${serializeUrl(node.url)}${serializeTitle(node.title)})`
    }
    case 'style': {
      const collapsed = collapseStyleChain(node)
      const innerNodes = collapsed.children
      const first = innerNodes.find((k) => k.range)?.range ?? null
      const last = [...innerNodes].reverse().find((k) => k.range)?.range ?? null
      const inner = serializeChildren(
        innerNodes,
        first && last ? { start: first.start, end: last.end } : null,
        ctx,
      )
      const attrs = attrString(collapsed.pairs)
      // 속성이 하나도 없으면 래퍼를 만들지 않는다(빈 `:t[…]{}` 방지 — 툴바 관례 계승).
      return attrs ? `:t[${inner}]{${attrs}}` : inner
    }
    case 'wrap': {
      const marker = WRAP_MARKER[node.mark]
      return `${marker}${serializeParent(node, ctx)}${marker}`
    }
    default:
      return ''
  }
}

/** 컨테이너 하나의 인라인 내용을 Markdown 문자열로. */
export function serializeContainer(container: InlineContainer, source: string): string {
  return serializeChildren(container.children, container.range, { source })
}

/**
 * A-3 — 모델 전체를 블록 Markdown 소스로 되돌린다.
 * 컨테이너 **내용 범위만** 치환하므로 편집이 없으면 결과는 원본과 1바이트도 다르지 않다.
 */
export function serializeBlock(model: BlockInlineModel): string {
  const edits = model.containers
    .map((container) => ({ range: container.range, text: serializeContainer(container, model.source) }))
    .filter((edit) => edit.text !== model.source.slice(edit.range.start, edit.range.end))
    .sort((a, b) => a.range.start - b.range.start)

  let out = ''
  let cursor = 0
  for (const edit of edits) {
    if (edit.range.start < cursor) continue // 겹치는 구간은 건너뛴다(방어 — 정상 모델에선 없음)
    out += model.source.slice(cursor, edit.range.start)
    out += edit.text
    cursor = edit.range.end
  }
  out += model.source.slice(cursor)
  return out
}

// ---- A-4. 재파싱 동형성 검사(3층 안전 밸브) ----

/** 인라인 트리의 비교용 지문 — 노드 종류·서식·순서·평문 텍스트만 담는다. */
function nodeSignature(node: InlineNode, out: string[]): void {
  switch (node.kind) {
    case 'text':
      out.push(`t:${node.text}`)
      return
    case 'break':
      out.push('br')
      return
    case 'atom':
      out.push(`a:${node.atom}:${node.text}`)
      return
    case 'wrap':
      out.push(`w(${node.mark}`)
      node.children.forEach((child) => nodeSignature(child, out))
      out.push(')')
      return
    case 'style': {
      const collapsed = collapseStyleChain(node)
      out.push(`s(${attrString(collapsed.pairs)}`)
      collapsed.children.forEach((child) => nodeSignature(child, out))
      out.push(')')
      return
    }
    case 'link':
      out.push(`l(${node.url}`)
      node.children.forEach((child) => nodeSignature(child, out))
      out.push(')')
      return
    default:
      return
  }
}

/**
 * 인접한 text 지문을 합치고 빈 text를 버린다 — 편집 과정에서 텍스트 노드가 쪼개졌다 합쳐지는 것은
 * 의미 차이가 아니므로 동형성 판정에서 제외한다.
 */
function normalizeSignature(parts: string[]): string[] {
  const out: string[] = []
  for (const part of parts) {
    if (part.startsWith('t:')) {
      const prev = out[out.length - 1]
      if (prev && prev.startsWith('t:')) {
        out[out.length - 1] = prev + part.slice(2)
        continue
      }
      if (part === 't:') continue
      out.push(part)
      continue
    }
    out.push(part)
  }
  return out.filter((part) => part !== 't:')
}

function modelSignature(model: BlockInlineModel): string {
  const parts: string[] = []
  for (const container of model.containers) {
    parts.push(`${container.type}${container.depth ?? ''}(`)
    container.children.forEach((child) => nodeSignature(child, parts))
    parts.push(')')
  }
  return normalizeSignature(parts).join('\u0001')
}

function nodesSignature(model: BlockInlineModel): string {
  return modelSignature(model)
}

/**
 * A-4 — 직렬화 결과를 다시 파싱해 인라인 트리가 모델과 동형인지 판정한다.
 * `true`면 안전하게 적용 가능, `false`면 호출부(표면)가 편집을 적용하지 않고 소스 편집으로
 * 폴백해야 한다. 비교 대상은 **모델(의도)** 이지 원본 소스가 아니다 — 편집 결과가 의도대로
 * 다시 읽히는지를 보는 검사다.
 */
export function isRoundTripSafe(
  model: BlockInlineModel,
  serialized: string,
  opts?: RichParseOptions,
): boolean {
  const reparsed = buildInlineModel(serialized, opts)
  if (reparsed.containers.length !== model.containers.length) return false
  if (reparsed.topTypes.join(',') !== model.topTypes.join(',')) return false
  return nodesSignature(reparsed) === nodesSignature(model)
}

/**
 * 표면이 확정 시 부르는 한 방 — 직렬화 + 3층 검사. 검사에 걸리면 `ok:false`를 돌려주고
 * 호출부는 그 편집을 적용하지 않는다(조용한 본문 변형 차단).
 */
export function commitInlineModel(
  model: BlockInlineModel,
  opts?: RichParseOptions,
): { ok: true; source: string } | { ok: false; source: string } {
  const serialized = serializeBlock(model)
  if (serialized === model.source) return { ok: true, source: serialized }
  return isRoundTripSafe(model, serialized, opts)
    ? { ok: true, source: serialized }
    : { ok: false, source: serialized }
}

/** 디버그·검증용 — 모델의 평문만 뽑는다(리프 순서대로). */
export function modelPlainText(model: BlockInlineModel): string {
  return model.containers
    .map((container) =>
      flattenInline(container.children)
        .map((flat) => (flat.node.kind === 'break' ? '\n' : flat.node.text))
        .join(''),
    )
    .join('\n')
}
