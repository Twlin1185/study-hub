// 에디터 v2 변환 계층 ② — **앱 블록 → 방언 Markdown 프로젝션** (M32 / stage-32 묶음 3)
//
// 계약(stage-32 §확정 규약):
//  · A-1 정규형 동등 — 마커 표기·이스케이프 형태·강조 중첩 순서는 정규형으로 수렴해도 되지만
//    텍스트·마크 집합·속성·블록 구조는 **1비트도 변하면 안 된다**.
//  · A-2 고정점     — 1차 투영본을 재왕복하면 **바이트 동일**(결정적 출력. 저장 반복으로 본문이
//    흔들리지 않는다는 계약)이라 마커·속성 순서·번호 매김이 전부 결정적이어야 한다.
//  · A-3 이스케이프 — 문맥 감응 규칙은 s30 `inlineSerialize.escapeInlineText`의 계약을 **계승**한다
//    (단어 내부 `_` 비이스케이프 · URL 백슬래시 0). 다만 구현은 **독립**이다 — 구 인라인 모델
//    (range/raw/dirty)에 의존하지 않고 블록 스키마만 보고 쓴다.
import { MARK_ORDER } from '../schema/blocks'
import type {
  AttrPair,
  Block,
  BlockDocument,
  InlineNode,
  InlineStyles,
  ListItemBlock,
  MarkName,
} from '../schema/blocks'
import { MARK_MARKER } from '../schema/blocks'

// ---------------------------------------------------------------- 이스케이프 (A-3)

/** 어디에 있든 인라인 구문을 열 수 있는 문자. `_`는 문맥 감응이라 여기 없다. */
const ALWAYS_ESCAPE = new Set(['\\', '*', '`', '[', ']', '~', '$'])

/** 단어 문자 = 유니코드 글자·숫자·언더스코어(한글 포함). */
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u

/**
 * 양옆이 모두 단어 문자인 `_`인가. 참이면 CommonMark에서 강조가 될 수 없으므로 이스케이프하지
 * 않는다 — 무조건 막으면 `http://a.com/b_c` 같은 URL·식별자가 `b\_c`로 더럽혀진다(s30 ②-4 계약).
 */
function isIntrawordUnderscore(text: string, i: number): boolean {
  const prev = text[i - 1]
  const next = text[i + 1]
  if (prev === undefined || next === undefined) return false
  return WORD_CHAR_RE.test(prev) && WORD_CHAR_RE.test(next)
}

export interface EscapeContext {
  /** 이 텍스트가 줄 맨 앞에서 시작하는가(블록 구문 오인 방지) */
  atLineStart: boolean
  /** 표 셀 안인가(`|`를 항상 막는다) */
  inTable: boolean
  /** 직전 출력이 이미지인가(규약 E `{w=…}` 부속 표기 오인 방지) */
  afterImage: boolean
}

/** 줄머리에서만 블록 구문이 되는 문자들. */
function needsLineStartEscape(rest: string): boolean {
  if (/^#{1,6}(\s|$)/.test(rest)) return true
  if (rest[0] === '>') return true
  if (/^[-+](\s|$)/.test(rest)) return true
  if (/^-{3,}[ \t]*$/.test(rest)) return true
  // setext 밑줄(`===`)로 오인되는 줄
  if (/^=+[ \t]*$/.test(rest)) return true
  return false
}

/**
 * 평문 → Markdown 소스 이스케이프. 목표는 "우연히 문법이 되어 본문이 조용히 변형되는 것"의 차단이며,
 * 과잉 이스케이프로 소스가 지저분해지지 않게 **문맥상 실제로 위험한 자리만** 막는다.
 */
export function escapeText(text: string, ctx: EscapeContext): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1] ?? ''
    // 줄머리 판정은 **텍스트 안의 개행 뒤도 포함**한다 — 블록에서 출발한 텍스트 run은 값 안에
    // 개행을 품을 수 있고(`'a\n# b'`), ATX 헤딩·목록은 문단을 중간에서 끊어 버린다.
    const lineStart = (ctx.atLineStart && i === 0) || text[i - 1] === '\n'
    if (i === 0 && ctx.afterImage && ch === '{' && /^\{w=\d/.test(text)) {
      // 이미지 직후의 `{w=…}`는 규약 E 부속 표기다 — 평문으로 적은 것이면 반드시 막는다.
      out += '\\{'
      continue
    }
    if (ALWAYS_ESCAPE.has(ch)) {
      out += `\\${ch}`
      continue
    }
    if (ch === '_') {
      out += isIntrawordUnderscore(text, i) ? '_' : '\\_'
      continue
    }
    // 마이크로 3종(`++`·`==`·`||`)은 두 글자 표식일 때만 문법이다 — 앞 글자만 막으면 충분하다.
    if ((ch === '=' || ch === '+' || ch === '|') && next === ch) {
      out += `\\${ch}`
      continue
    }
    if (ch === '|' && (ctx.inTable || lineStart)) {
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
    // 줄머리 `::name` = **leaf directive**(stage-37 `::toc`·`::web`가 여기 산다). 막지 않으면
    // 평문으로 적은 `::toc` 한 줄이 다음 파싱에서 목차 블록으로 바뀐다(조용한 본문 변형).
    // **콜론 두 개를 모두 막는다** — 앞 하나만 막으면 남은 `:name`이 이번엔 **인라인 directive**로
    // 잡힌다(실측). 실문서 코퍼스에 줄머리 `::name` 표기는 0표면이라(s37 계열 ⑤) 기존 문서 diff 0.
    if (lineStart && ch === ':' && /^::[A-Za-z]/.test(text.slice(i))) {
      out += '\\:\\:'
      i += 1
      continue
    }
    // directive(`:t[…]{…}` · `:::name`) — 실제 directive 모양일 때만 막는다.
    if (ch === ':' && (/^:{3,}/.test(text.slice(i)) || /^:[A-Za-z][A-Za-z0-9-]*[[{]/.test(text.slice(i)))) {
      out += '\\:'
      continue
    }
    if (lineStart && needsLineStartEscape(text.slice(i))) {
      out += `\\${ch}`
      continue
    }
    if (lineStart && /^\d{1,9}[.)](\s|$)/.test(text.slice(i))) {
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

/** 링크·이미지 라벨(`[…]`) 안 텍스트 — 대괄호·백슬래시만 막는다. */
function escapeLabel(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1')
}

function serializeUrl(url: string): string {
  if (url === '') return ''
  if (/[\s()<>]/.test(url)) return `<${url.replace(/([<>\\])/g, '\\$1')}>`
  return url
}

function serializeTitle(title: string | undefined): string {
  if (!title) return ''
  return ` "${title.replace(/(["\\])/g, '\\$1')}"`
}

// ---- directive 메타데이터 도메인 (C2 → D1 정정 · 전부 remark-directive 실측 근거) ----
//
// 원칙: **파서가 받아들이는 것은 그대로 보존**하고, 직렬화를 깨는 문자만 막는다(화이트리스트 ✗,
// 블랙리스트 ○). 좁은 화이트리스트는 `키=값` 같은 **정상 속성을 지워** A-1을 어긴다(D1).
//
// 실측(속성 **키**): 글자·숫자·비ASCII(한글·라틴 확장·이모지 포함)·`-` `_` `.` `:` **통과** /
//   공백·`!"#$%&'()*+,/;<=>?@[\]^`{|}~` 는 **속성 블록 전체를 무효화**해 그 directive의 다른 속성까지
//   함께 사라진다 → 그 키 하나만 버리는 쪽이 손실이 작다.
const ATTR_KEY_UNSAFE_RE = /[ \r\n!"#$%&'()*+,/;<=>?@[\\\]^`{|}~]/

// 실측(속성 **값**): 따옴표로 감싸면 `"` 하나만 빼고 전부 통과(백슬래시는 **이스케이프가 없고 리터럴로
//   보존**된다 — `\`를 덧붙이면 값이 바뀐다). 감싸지 않으면 공백류·`=`·`` ` ``·`'`·`}`·`<`·`>`에서 깨진다.
const ATTR_VALUE_NEEDS_QUOTE_RE = /[\s"'}=`<>]/

// 실측(컨테이너 **이름**): 글자·숫자·비ASCII·`-`·`_` 통과 / `.`·`:`은 directive 자체가 성립하지 않는다
//   (`:::note.x` → 문단). 이름이 깨지면 **블록이 통째로 문단으로 붕괴**하므로 여기만 보수적으로 간다.
const VARIANT_UNSAFE_RE = /[^\p{L}\p{N}\-_]/gu

/**
 * directive 속성 목록 정규화 — 표현 불가능한 키만 버리고, 값은 담을 수 있는 형태로 수렴시킨다.
 * 중복 키는 파서와 같은 규칙(**첫 등장 자리 · 마지막 값**)으로 접는다.
 */
function safeAttrs(pairs: AttrPair[]): AttrPair[] {
  const out: AttrPair[] = []
  for (const [key, value] of pairs) {
    if (key === '' || ATTR_KEY_UNSAFE_RE.test(key)) continue
    // 값은 가장자리를 다듬지 않는다(따옴표로 감싸면 공백도 보존된다). 줄바꿈만 접고 `"`를 걷어낸다 —
    // `"`는 인용 값 안에서도 이스케이프 수단이 없어 directive 자체를 깨뜨린다(실측).
    const safeValue = value.replace(/[\r\n]+/g, ' ').replace(/"/g, '')
    const idx = out.findIndex(([k]) => k === key)
    if (idx === -1) out.push([key, safeValue])
    else out[idx] = [key, safeValue]
  }
  return out
}

/**
 * 인용 속성 값(`key="…"`)에 실을 수 있는 형태로 수렴 — `safeAttrs`의 값 규칙과 **같은 도메인**이다.
 * 인용 값 안에는 이스케이프 수단이 없어 `"`가 directive 자체를 깨뜨리고(실측), 줄바꿈은 줄을
 * 끊어 블록을 붕괴시킨다. 백슬래시는 리터럴로 보존되므로 손대지 않는다.
 */
function quotedAttrValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/"/g, '')
}

function attrString(pairs: AttrPair[]): string {
  return safeAttrs(pairs)
    .map(([key, value]) => {
      if (value === '') return key
      // 인용 값 안에는 이스케이프가 없다 — 그대로 싣는다(`"`는 위에서 이미 제거됐다).
      return ATTR_VALUE_NEEDS_QUOTE_RE.test(value) ? `${key}="${value}"` : `${key}=${value}`
    })
    .join(' ')
}

/** `{…}` 부속 — 실을 속성이 하나도 없으면 **빈 `{}`를 만들지 않는다**(2차 왕복 손실 증폭기 — D1). */
function attrSuffix(pairs: AttrPair[] | undefined): string {
  const text = attrString(pairs ?? [])
  return text === '' ? '' : `{${text}}`
}

/** directive 이름 도메인 — 비거나 밖의 문자만 남으면 F52 기본 콜아웃(`note`)으로 수렴시킨다. */
function safeVariant(variant: string): string {
  const cleaned = variant.replace(VARIANT_UNSAFE_RE, '')
  return cleaned === '' ? 'note' : cleaned
}

// ---------------------------------------------------------------- 인라인 직렬화 (3-1·3-2)

interface Emitter {
  parts: string[]
  atLineStart: boolean
  inTable: boolean
  afterImage: boolean
}

function push(em: Emitter, text: string): void {
  if (text === '') return
  em.parts.push(text)
  em.atLineStart = text.endsWith('\n')
  em.afterImage = false
}

/** 하위 출력만 따로 모은다(마커 감싸기·공백 밀어내기용). */
function capture(em: Emitter, fn: () => void): string {
  const saved = em.parts
  em.parts = []
  fn()
  const text = em.parts.join('')
  em.parts = saved
  return text
}

function marksOf(styles: InlineStyles | undefined): MarkName[] {
  if (!styles) return []
  return MARK_ORDER.filter((mark) => styles[mark] === true)
}

function attrKey(pairs: AttrPair[] | undefined): string {
  return pairs && pairs.length ? JSON.stringify(pairs) : ''
}

/** GFM 자동 링크로 그대로 다시 읽히는 형태인가(`[url](url)`로 부풀리지 않기 위한 판정). */
function isBareAutolink(node: Extract<InlineNode, { type: 'link' }>): boolean {
  if (node.title) return false
  if (node.children.length !== 1) return false
  const only = node.children[0]
  if (only.type !== 'text' || only.text !== node.url) return false
  if (!/^(https?:\/\/|www\.)[^\s<>[\]()\\`*~]+$/.test(node.url)) return false
  return /[A-Za-z0-9/]$/.test(node.url)
}

function fenceForCode(value: string): string {
  let longest = 0
  for (const run of value.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(longest + 1)
}

function emitNode(node: InlineNode, em: Emitter): void {
  const afterImage = em.afterImage
  switch (node.type) {
    case 'text':
      push(em, escapeText(node.text, { atLineStart: em.atLineStart, inTable: em.inTable, afterImage }))
      return
    case 'softBreak':
      push(em, '\n')
      return
    case 'hardBreak':
      // 정규 표기는 백슬래시 — 보이지 않는 공백 2칸보다 결정적이다(A-2 고정점).
      push(em, '\\\n')
      return
    case 'inlineCode': {
      const fence = fenceForCode(node.value)
      const pad = node.value.startsWith('`') || node.value.endsWith('`') ? ' ' : ''
      push(em, `${fence}${pad}${node.value}${pad}${fence}`)
      return
    }
    case 'inlineMath':
      push(em, `$${node.value}$`)
      return
    case 'link': {
      if (isBareAutolink(node)) {
        push(em, node.url)
        return
      }
      const inner = capture(em, () => emitSequence(node.children, node.styles ?? {}, em))
      push(em, `[${inner}](${serializeUrl(node.url)}${serializeTitle(node.title)})`)
      return
    }
    case 'refChip': {
      const label = node.label === undefined ? '' : `|${node.label}`
      if (node.ref === 'embed') push(em, `![[${node.target}${label}]]`)
      else if (node.ref === 'anchor') push(em, `[[#${node.target}${label}]]`)
      else push(em, `[[${node.target}${label}]]`)
      return
    }
    case 'inlineImage': {
      push(
        em,
        `![${escapeLabel(node.alt)}](${serializeUrl(node.url)}${serializeTitle(node.title)})${sizeSuffix(node.width, node.height)}`,
      )
      em.afterImage = true
      return
    }
    case 'inlineFallback':
      // 원문 슬라이스 그대로(규약 D) — 이스케이프하지 않는다.
      push(em, node.markdown)
      return
    default:
      return
  }
}

/** 규약 E — `{w=<px>}`(선택 `h=`). */
function sizeSuffix(width: number | undefined, height: number | undefined): string {
  if (width === undefined) return ''
  return height === undefined ? `{w=${width}}` : `{w=${width} h=${height}}`
}

/** 공백 가장자리를 마커 밖으로 밀어낸다 — `** a**`는 강조가 되지 않기 때문(방어적 정규화). */
function shiftEdgeSpace(inner: string): { lead: string; core: string; trail: string } {
  if (inner.trim() === '') return { lead: inner, core: '', trail: '' }
  const lead = /^\s+/.exec(inner)?.[0] ?? ''
  const rest = inner.slice(lead.length)
  const trail = /\s+$/.exec(rest)?.[0] ?? ''
  return { lead, core: rest.slice(0, rest.length - trail.length), trail }
}

/**
 * run 배열 → 강조 중첩 재구성(3-2). 인접 노드가 공유하는 마크를 **가장 긴 구간부터** 그리디로
 * 묶는다(같은 길이면 `MARK_ORDER` 우선). `:t`는 항상 가장 바깥에서 묶는다.
 */
function emitSequence(nodes: InlineNode[], base: InlineStyles, em: Emitter): void {
  const baseT = attrKey(base.t)
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    const styles = node.styles ?? {}

    // ① `:t` — 같은 속성 목록을 가진 인접 구간을 하나로 묶는다(중첩 `:t`를 만들지 않는다).
    const nodeT = attrKey(styles.t)
    if (nodeT !== '' && nodeT !== baseT) {
      let j = i
      while (j + 1 < nodes.length && attrKey(nodes[j + 1].styles?.t) === nodeT) j += 1
      const group = nodes.slice(i, j + 1)
      em.atLineStart = false
      const inner = capture(em, () => emitSequence(group, { ...base, t: styles.t }, em))
      const suffix = attrSuffix(styles.t)
      // 실을 속성이 하나도 없으면 **래퍼 자체를 만들지 않는다** — `:t[x]{}`·`:t[x]`는 재파싱하면
      // 속성 없는 directive가 되고, 그 2차 왕복에서 `:t`가 통째로 사라져 고정점이 깨진다(D1).
      push(em, suffix === '' ? inner : `:t[${inner}]${suffix}`)
      i = j + 1
      continue
    }

    // ② 불리언 마크 — `MARK_ORDER`가 **바깥→안쪽 순서를 강제**한다(마이크로 3종은 안쪽 내용이
    //    다시 파싱되지 않으므로 반드시 가장 안쪽이어야 한다 — schema/blocks.ts MARK_ORDER 주석).
    //    고른 마크는 인접한 같은 마크 구간까지 **최대로 확장**해 마커 반복을 줄인다.
    const extra = marksOf(styles).filter((mark) => base[mark] !== true)
    if (extra.length === 0) {
      emitNode(node, em)
      i += 1
      continue
    }
    const best: MarkName = extra[0]
    let bestEnd = i
    while (bestEnd + 1 < nodes.length && nodes[bestEnd + 1].styles?.[best] === true) bestEnd += 1
    const group = nodes.slice(i, bestEnd + 1)
    const marker = MARK_MARKER[best]
    em.atLineStart = false
    const inner = capture(em, () => emitSequence(group, { ...base, [best]: true }, em))
    const { lead, core, trail } = shiftEdgeSpace(inner)
    if (core === '') push(em, lead)
    else {
      push(em, lead)
      push(em, `${marker}${core}${marker}`)
      push(em, trail)
    }
    i = bestEnd + 1
  }
}

/** 인라인 배열 → Markdown 조각. */
export function serializeInline(
  nodes: InlineNode[],
  opts?: { atLineStart?: boolean; inTable?: boolean },
): string {
  const em: Emitter = {
    parts: [],
    atLineStart: opts?.atLineStart ?? true,
    inTable: opts?.inTable ?? false,
    afterImage: false,
  }
  emitSequence(nodes, {}, em)
  return em.parts.join('')
}

// ---------------------------------------------------------------- 블록 인라인 정규화 (A1·A5 방어)

/**
 * 블록 인라인 내용의 **직렬화 전 정규화** — `mdastToBlocks.trimEdges`가 세우는 불변식을
 * **반대 방향(블록 → Markdown)에서도 강제**한다. 파싱에서 출발하면 애초에 생길 수 없는 형태지만
 * 블록에서 출발하면(M33 에디터가 블록의 출발점이 된다) 그대로 뱉는 순간 **구조가 깨진 소스**가 된다:
 *  · 문단 첫 줄의 선행 4칸·탭 → 재파싱하면 **코드 블록**(문단이 타입째 바뀐다)
 *  · 가장자리 줄바꿈 노드 → 문단 끝 hardBreak가 `끝\` 로 유출
 *  · 표 셀·헤딩 안 줄바꿈 → 행이 쪼개지거나 헤딩이 문단으로 분열
 * 표현할 수 없는 가장자리 공백을 **버리는** 것이 아니라, 표현 가능한 정규형으로 수렴시킨다
 * (버려지는 것은 Markdown이 어차피 담지 못하는 가장자리 공백뿐 — 본문 텍스트는 손대지 않는다).
 *
 * `fold=true`(표 셀·헤딩)는 한 줄이어야 하는 문맥이라 **개행을 공백으로 접는다**.
 */
/**
 * 가장자리에서 떨어내는 문자 = **ASCII 공백·탭 + 줄바꿈**뿐이다(C1).
 * `\s`를 쓰면 U+00A0(nbsp)·U+3000(전각 공백)까지 지워지는데 이 둘은 파서가 버리는 자리가 아니라
 * **Markdown이 정상적으로 보존하는 일반 본문 문자**다 — 지우면 규약 A-1(텍스트 1문자도 불허) 위반이다.
 * 공백·탭은 파싱측(`mdastToBlocks.trimEdges`)·정규형 N과 **같은 `[ \t]` 도메인**이고, 줄바꿈은
 * 가장자리 break 노드와 같은 구조 잔여라(문단은 줄바꿈으로 시작·끝날 수 없다) 함께 떨어낸다.
 */
const EDGE_START_RE = /^[ \t\r\n]+/
const EDGE_END_RE = /[ \t\r\n]+$/

function blockInline(nodes: InlineNode[], opts?: { fold?: boolean }): InlineNode[] {
  let out: InlineNode[] = nodes
  if (opts?.fold) {
    out = out.map((node) => {
      if (node.type === 'softBreak' || node.type === 'hardBreak') {
        const text: InlineNode = { type: 'text', text: ' ' }
        if (node.styles) text.styles = node.styles
        return text
      }
      if (node.type === 'text' && /[\r\n]/.test(node.text)) {
        return { ...node, text: node.text.replace(/[\r\n]+/g, ' ') }
      }
      return node
    })
  }
  out = out.slice()
  // 앞 가장자리
  while (out.length) {
    const first = out[0]
    if (first.type === 'softBreak' || first.type === 'hardBreak') {
      out.shift()
      continue
    }
    if (first.type === 'text') {
      const text = first.text.replace(EDGE_START_RE, '')
      if (text === '') {
        out.shift()
        continue
      }
      if (text !== first.text) out[0] = { ...first, text }
    }
    break
  }
  // 뒤 가장자리
  while (out.length) {
    const idx = out.length - 1
    const last = out[idx]
    if (last.type === 'softBreak' || last.type === 'hardBreak') {
      out.pop()
      continue
    }
    if (last.type === 'text') {
      const text = last.text.replace(EDGE_END_RE, '')
      if (text === '') {
        out.pop()
        continue
      }
      if (text !== last.text) out[idx] = { ...last, text }
    }
    break
  }
  return out
}

/**
 * 한 줄에 실리는 문자열(directive 라벨 `:::note[제목]` · 코드 펜스 정보 문자열).
 *
 * **접는 것은 개행뿐이다(D2)** — 파서는 라벨·meta의 **내부** 공백·탭을 그대로 보존하므로
 * (`:::note[제목  두칸]` → 라벨 `"제목  두칸"`, ```` ```js  a  b ```` → meta `"a  b"` 실측)
 * 내부까지 접으면 직렬화에서만 문자가 사라진다. 개행은 줄을 끊어 블록을 붕괴시키므로 접는다.
 *
 * 가장자리는 `\s` 기준 `trim()`을 유지한다 — 라벨은 `remarkStudy.hoistDirectiveLabel`이
 * `nodeText(...).trim()`으로, meta도 파서가 같은 규칙으로 **먼저** 버리기 때문이다(대칭).
 */
function foldLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

// ---------------------------------------------------------------- 블록 직렬화 (3-3)

function indentContinuation(text: string, width: number): string {
  const pad = ' '.repeat(width)
  return text
    .split('\n')
    .map((line, idx) => (idx === 0 || line === '' ? line : `${pad}${line}`))
    .join('\n')
}

function prefixQuote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

/**
 * 인접한 두 목록 그룹을 **다른 마커로** 방출해 분리를 복원한다(A3 — `ListItemBlock.groupBreak`).
 * CommonMark에서 마커(`-`/`*`)·구분자(`.`/`)`) 변경은 곧 "여기서 목록이 갈린다"는 표기다.
 * 변형(variant)은 인접 그룹끼리만 달라지면 되므로 0/1 교대로 충분하다.
 */
function serializeListGroup(items: ListItemBlock[], variant: number): string {
  const ordered = items[0].ordered
  const start = items[0].start ?? 1
  const spread = items.some((item) => item.spread === true)
  const bullet = variant % 2 === 1 ? '*' : '-'
  const delim = variant % 2 === 1 ? ')' : '.'
  const lines = items.map((item, idx) => {
    const marker = ordered ? `${start + idx}${delim} ` : `${bullet} `
    const check = item.checked === undefined ? '' : item.checked ? '[x] ' : '[ ] '
    const content = serializeInline(blockInline(item.content))
    const children = item.children ?? []
    const childText = serializeBlockSeq(children)
    // 중첩 목록은 빈 줄 없이 바로 잇는다(느슨한 목록이면 빈 줄).
    const sep = children[0]?.type === 'listItem' && !spread ? '\n' : '\n\n'
    const body = content === '' ? childText : childText === '' ? content : `${content}${sep}${childText}`
    return `${marker}${check}${indentContinuation(body, marker.length)}`
  })
  return lines.join(spread ? '\n\n' : '\n')
}

function serializeTableRow(cells: InlineNode[][], width: number): string {
  const out: string[] = []
  for (let i = 0; i < width; i += 1) {
    // 표 셀은 한 줄이어야 한다 — 개행을 접지 않으면 행이 쪼개져 표 구조가 깨진다(A5).
    out.push(serializeInline(blockInline(cells[i] ?? [], { fold: true }), { atLineStart: false, inTable: true }))
  }
  return `| ${out.join(' | ')} |`
}

function delimiterCell(align: 'left' | 'right' | 'center' | null): string {
  if (align === 'left') return ':---'
  if (align === 'right') return '---:'
  if (align === 'center') return ':---:'
  return '---'
}

function calloutFence(inner: string): string {
  let longest = 2
  for (const line of inner.split('\n')) {
    const m = /^(:{3,})/.exec(line)
    if (m) longest = Math.max(longest, m[1].length)
  }
  return ':'.repeat(longest + 1)
}

function serializeBlock(block: Block): string {
  switch (block.type) {
    case 'paragraph':
      return serializeInline(blockInline(block.content))
    case 'heading': {
      // 헤딩은 한 줄이어야 한다 — 개행이 남으면 헤딩 + 문단으로 분열된다(A5).
      const content = serializeInline(blockInline(block.content, { fold: true }), { atLineStart: false })
      const hashes = '#'.repeat(block.level)
      return content === '' ? hashes : `${hashes} ${content}`
    }
    case 'quote':
      return prefixQuote(serializeBlockSeq(block.children))
    case 'codeBlock': {
      let fence = '```'
      for (const run of block.code.match(/`{3,}/g) ?? []) {
        if (run.length >= fence.length) fence = '`'.repeat(run.length + 1)
      }
      // 정보 문자열은 **펜스와 같은 줄**에 실린다 — 백틱은 펜스를 무너뜨리고, 공백·개행은
      // lang을 자르거나 코드 본문에 섞인다(C2). 표현 가능한 형태로 수렴시킨다.
      const language = (block.language ?? '').replace(/[`\s]/g, '')
      const extra = block.info ? foldLine(block.info).replace(/`/g, '') : ''
      const info = `${language}${extra ? ` ${extra}` : ''}`
      return block.code === ''
        ? `${fence}${info}\n${fence}`
        : `${fence}${info}\n${block.code}\n${fence}`
    }
    case 'table': {
      const width = Math.max(block.align.length, ...block.rows.map((row) => row.length), 1)
      const head = block.rows[0] ?? []
      const body = block.rows.slice(1)
      const delim = `| ${Array.from({ length: width }, (_, i) => delimiterCell(block.align[i] ?? null)).join(' | ')} |`
      return [serializeTableRow(head, width), delim, ...body.map((row) => serializeTableRow(row, width))].join('\n')
    }
    case 'mathBlock':
      return `$$\n${block.value}\n$$`
    case 'image':
      return `![${escapeLabel(block.alt)}](${serializeUrl(block.url)}${serializeTitle(block.title)})${sizeSuffix(block.width, block.height)}`
    case 'divider':
      return '---'
    case 'callout': {
      const inner = serializeBlockSeq(block.children)
      const fence = calloutFence(inner)
      const title = block.title ? `[${escapeLabel(foldLine(block.title))}]` : ''
      const head = `${fence}${safeVariant(block.variant)}${title}${attrSuffix(block.attrs)}`
      return inner === '' ? `${head}\n${fence}` : `${head}\n${inner}\n${fence}`
    }
    case 'docEmbed':
      return `![[${block.target}${block.label === undefined ? '' : `|${block.label}`}]]`
    case 'toc':
      // 규약 A — 정규형은 **속성 없는 leaf directive** 한 줄이다(저장 데이터 0 · 옵션 없음).
      return '::toc'
    case 'webEmbed': {
      // 규약 B — 실리는 속성은 **url·title 둘뿐**이고 값은 항상 큰따옴표로 감싼다(결정적 출력).
      // 메타 캐시(§4.30)는 **프로젝션 비대상**이다(명문화된 강등 손실 — 블록 JSON이 소스).
      // url이 빈 블록(편집 표면이 만들 수 없는 퇴화 상태)도 같은 형태로 낸다 — 재파싱하면
      // 원문 보존(sourceFallback)으로 떨어지므로 **Markdown 고정점은 그대로 성립**한다.
      // 빈 제목은 속성 자체를 만들지 않는다(`''` ⇔ 부재 — 파싱측과 같은 관례).
      const title = block.title ? ` title="${quotedAttrValue(block.title)}"` : ''
      return `::web{url="${quotedAttrValue(block.url)}"${title}}`
    }
    case 'sourceFallback':
      return block.markdown
    case 'listItem':
      // 단독 호출은 없다(그룹 처리) — 방어적으로 1항목 목록으로 낸다.
      return serializeListGroup([block], 0)
    default:
      return ''
  }
}

/**
 * 블록 배열 → Markdown. 연속한 listItem은 하나의 목록으로 묶되, `groupBreak`가 선 항목에서
 * **그룹을 끊고 마커를 바꿔** 원본의 목록 분리를 복원한다(A3).
 */
function serializeBlockSeq(blocks: Block[]): string {
  const chunks: string[] = []
  let i = 0
  // 직전 청크가 같은 종류의 목록이면 마커 변형을 뒤집어 두 목록이 붙지 않게 한다.
  let prevListOrdered: boolean | null = null
  let variant = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (block.type === 'listItem') {
      let j = i
      while (j + 1 < blocks.length) {
        const next = blocks[j + 1]
        if (next.type !== 'listItem' || next.ordered !== block.ordered || next.groupBreak === true) break
        j += 1
      }
      variant = prevListOrdered === block.ordered ? variant + 1 : 0
      chunks.push(serializeListGroup(blocks.slice(i, j + 1) as ListItemBlock[], variant))
      prevListOrdered = block.ordered
      i = j + 1
      continue
    }
    const text = serializeBlock(block)
    // 빈 출력(표현할 내용이 없는 블록)은 청크가 되지 않으므로 인접성도 끊기지 않는다.
    if (text !== '') prevListOrdered = null
    chunks.push(text)
    i += 1
  }
  return chunks.filter((chunk) => chunk !== '').join('\n\n')
}

/** 블록 문서 → 방언 Markdown 프로젝션(결정적 · 고정점 계약 A-2). */
export function blocksToMarkdown(doc: BlockDocument): string {
  return serializeBlockSeq(doc.blocks)
}
