// remark 플러그인 2종 (설계 §4.19 ①② + §5.3 S26/F52) — MarkdownView 전용.
//
// 1) remarkStudyDirectives : remark-directive가 만든 컨테이너/리프/인라인 directive를
//    data-directive 속성을 가진 요소로 변환(`:::fold[제목]` · `:::hide[제목]` · `:::note/warn/tip[제목]`
//    · `:t[텍스트]{c= bg= s=}`).
// 2) remarkStudyRefs       : 본문 텍스트의 `![[DOC-…]]` · `[[DOC-…]]` · `[[#제목]]`과
//    마이크로 인라인 문법 3종(`++밑줄++`·`==형광펜==`·`||스포일러||`, F52)을
//    data-ref-*/hName 속성을 가진 요소 노드로 치환하고, 임베드는 문단 밖 블록으로 끌어올린다.
//
// AST 기반이므로 코드 블록·인라인 코드 안의 참조/마이크로 문법은 자연히 렌더되지 않는다(§4.19 ①).
// unist-util-visit 등 추가 의존 없이 최소 워커를 직접 돌린다(승인 의존 = remark-directive·
// rehype-slug·github-slugger 3종뿐 — F52 마이크로 3종도 신규 의존 0으로 이 파일 안에서 충족).
import { REF_SCAN_RE, parseRefMatch } from './refSyntax'
import { isPaletteColor, isTextSize } from './palette'

// mdast 노드 최소 형태 — 플러그인 내부 전용(외부 타입 의존을 만들지 않는다).
interface MdNode {
  type: string
  name?: string
  value?: string
  children?: MdNode[]
  data?: Record<string, unknown>
  attributes?: Record<string, string>
  position?: { start?: { offset?: number }; end?: { offset?: number } }
}

// 플러그인 옵션 — inlineFormat=false면 F52 신규 문법(마이크로 3종·:t·note/warn/tip)을 전부
// 원문 그대로 노출한다(퇴로 계약 — F51 breaks? 전례). 기존 참조·fold·hide는 영향 없음.
interface StudyPluginOptions {
  inlineFormat?: boolean
}

// 텍스트 치환을 하지 않는 노드 — 코드/원시 HTML/링크 라벨 내부.
const SKIP_TYPES = new Set([
  'code',
  'inlineCode',
  'html',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'definition',
  'yaml',
])

const DIRECTIVE_TYPES = new Set(['containerDirective', 'leafDirective', 'textDirective'])
// F52에서 새로 화이트리스트에 추가하는 directive 이름 — 끄면(inlineFormat=false) 원문 그대로 노출한다.
const F52_DIRECTIVE_NAMES = new Set(['t', 'note', 'warn', 'tip'])

function nodeText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(nodeText).join('')
}

// 노드의 position 오프셋으로 원본 소스 문자열 슬라이스를 복원한다. position이 없거나 source가
// 비어 있으면 null(호출부가 안전하게 폴백).
function sliceSource(source: string, node: MdNode): string | null {
  const pos = node.position
  const start = pos?.start?.offset
  const end = pos?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number' || !source) return null
  return source.slice(start, end)
}

// ---- 1) directive ----

function hoistDirectiveLabel(node: MdNode): string {
  // remark-directive는 `:::name[라벨]`의 라벨을 첫 자식 문단(data.directiveLabel=true)으로 넣는다.
  const first = node.children?.[0]
  const flagged = first?.data as { directiveLabel?: boolean } | undefined
  if (first && first.type === 'paragraph' && flagged?.directiveLabel) {
    node.children = (node.children ?? []).slice(1)
    return nodeText(first).trim()
  }
  return ''
}

function applyDirectives(node: MdNode, opts: { inlineFormat: boolean; source: string }): void {
  for (const child of node.children ?? []) {
    if (DIRECTIVE_TYPES.has(child.type)) {
      const name = child.name ?? ''
      const isF52 = F52_DIRECTIVE_NAMES.has(name)

      if (isF52 && !opts.inlineFormat) {
        // 퇴로: F52 신규 directive만 원문 그대로 노출(fold/hide 등 기존 directive는 무영향).
        const raw = sliceSource(opts.source, child)
        if (raw !== null) {
          if (child.type === 'containerDirective') {
            child.type = 'paragraph'
            child.children = [{ type: 'text', value: raw }]
          } else {
            child.type = 'text'
            child.value = raw
            child.children = undefined
          }
          child.data = undefined
          child.name = undefined
          child.attributes = undefined
          // raw 텍스트로 치환했으니 이 노드 내부는 더 순회하지 않는다(내용이 이미 평문이다).
          continue
        }
        // position 정보가 없어 원문 복원이 불가하면 안전하게 아래 일반 처리로 진행(폴백).
      }

      const label = child.type === 'containerDirective' ? hoistDirectiveLabel(child) : ''
      const hProperties: Record<string, string> = {
        'data-directive': name,
        'data-directive-label': label,
      }
      if (opts.inlineFormat && name === 't') {
        // 통합 인라인 directive 속성 화이트리스트 — 밖의 값·미지 속성은 조용히 무시(오류 아님).
        const attrs = child.attributes ?? {}
        if (attrs.c && isPaletteColor(attrs.c)) hProperties['data-ink'] = attrs.c
        if (attrs.bg && isPaletteColor(attrs.bg)) hProperties['data-mark'] = attrs.bg
        if (attrs.s && isTextSize(attrs.s)) hProperties['data-size'] = attrs.s
      }
      child.data = {
        ...(child.data ?? {}),
        // textDirective는 문단 안(인라인)에 있으므로 span, 나머지는 블록(div).
        hName: child.type === 'textDirective' ? 'span' : 'div',
        hProperties,
      }
    }
    applyDirectives(child, opts)
  }
}

export function remarkStudyDirectives(options?: StudyPluginOptions) {
  const inlineFormat = options?.inlineFormat ?? true
  return (tree: MdNode, file?: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : ''
    applyDirectives(tree, { inlineFormat, source })
  }
}

// ---- 2) 참조(임베드·링크 칩·앵커) + 마이크로 인라인 문법 3종(F52) ----

function makeRefNode(kind: string, target: string, alias: string): MdNode {
  return {
    type: 'studyRef',
    children: [],
    data: {
      // 임베드 카드는 블록(div), 칩은 인라인(span).
      hName: kind === 'embed' ? 'div' : 'span',
      hProperties: {
        'data-ref-kind': kind,
        'data-ref-target': target,
        'data-ref-alias': alias,
      },
    },
  }
}

type MicroKind = 'u' | 'mark' | 'spoiler'

function makeMicroNode(kind: MicroKind, content: string): MdNode {
  const hName = kind === 'u' ? 'u' : kind === 'mark' ? 'mark' : 'span'
  const hProperties: Record<string, string> = {}
  if (kind === 'spoiler') hProperties['data-inline-spoiler'] = 'true'
  return {
    type: 'studyInline',
    children: [{ type: 'text', value: content }],
    data: { hName, hProperties },
  }
}

function isEmbedNode(node: MdNode): boolean {
  const props = node.data?.hProperties as Record<string, string> | undefined
  return node.type === 'studyRef' && props?.['data-ref-kind'] === 'embed'
}

// 마이크로 문법 3종 — 엄격 플랭킹(여는 기호 바로 뒤·닫는 기호 바로 앞 공백 금지) + 빈 내용 불가
// (remark-math `$` 관례와 동일).
//
// 9-6ⓒ(stage-26 후속): 원래는 정규식 lookbehind `(?<!\s)`로 "닫는 기호 바로 앞 비공백"을
// 검사했으나, lookbehind는 Safari 16.4 미만(구형 iOS 포함)에서 **모듈 파싱 자체가 실패**한다
// (엔진이 정규식 리터럴을 컴파일하는 시점에 터진다 — try/catch로 못 피한다). 그래서 lookbehind를
// 전혀 쓰지 않고 문자 인덱스를 직접 훑어 같은 규칙을 재현한다: 여는 표식 다음 글자가 공백이 아니고,
// 그 뒤로 나오는 닫는 표식 후보 중 "바로 앞 글자가 공백이 아닌" **첫 번째**(= lazy 정규식과 동일한
// 최단 매치 선택) 후보를 고른다. **알려진 동작 차이(의도된 개선, 정본 확정)**: 백슬래시로
// 이스케이프된 후보를 거부한 뒤 재개하는 위치가 구버전(정규식 lastIndex = 매치 끝)과 달리 여는
// 표식 바로 다음 글자(+1 전진)다 — 그래서 `\+\+a++b++` 같은 입력에서 거부된 구간 *안에 있는*
// 정상 쌍(`++b++`)까지 살려서 매칭한다(구버전은 거부된 매치의 끝에서 재개해 이 쌍을 놓쳤다).
// 기존 저장 문서 우연 매칭 0건(0절 실측)이라 회귀 실질 0 — 이스케이프 뒤에 남은 정상 쌍을
// 살리는 쪽이 사용자 의도에 더 가깝다는 판단으로 신동작을 정본으로 채택했다.
const WHITESPACE_RE = /\s/

interface MicroMatch {
  start: number
  end: number
  kind: MicroKind
  content: string
}

const MICRO_MARKERS: { marker: string; kind: MicroKind }[] = [
  { marker: '++', kind: 'u' },
  { marker: '==', kind: 'mark' },
  { marker: '||', kind: 'spoiler' },
]

// 주어진 두 글자 표식(marker) 하나에 대해 fromIndex 이후 첫 유효 매치를 찾는다.
function findMicroMatch(value: string, marker: string, kind: MicroKind, fromIndex: number): MicroMatch | null {
  let openIdx = value.indexOf(marker, fromIndex)
  while (openIdx !== -1) {
    const contentStart = openIdx + marker.length
    const afterOpen = value[contentStart]
    if (afterOpen !== undefined && !WHITESPACE_RE.test(afterOpen)) {
      // 여는 표식 조건 통과 — 닫는 표식 후보를 앞에서부터 찾는다(빈 내용 제외 + 바로 앞 비공백).
      let searchFrom = contentStart
      while (true) {
        const closeIdx = value.indexOf(marker, searchFrom)
        if (closeIdx === -1) break
        if (closeIdx <= contentStart) {
          // 내용이 비어 있음(표식이 곧바로 겹침) — 다음 후보로.
          searchFrom = closeIdx + 1
          continue
        }
        const beforeClose = value[closeIdx - 1]
        if (beforeClose !== undefined && !WHITESPACE_RE.test(beforeClose)) {
          return { start: openIdx, end: closeIdx + marker.length, kind, content: value.slice(contentStart, closeIdx) }
        }
        searchFrom = closeIdx + 1
      }
    }
    openIdx = value.indexOf(marker, openIdx + 1)
  }
  return null
}

// 세 표식 중 fromIndex 이후 가장 이른 매치를 고른다(서로 다른 문자라 시작 위치가 겹칠 수 없다).
function nextMicroMatch(value: string, fromIndex: number): MicroMatch | null {
  let best: MicroMatch | null = null
  for (const { marker, kind } of MICRO_MARKERS) {
    const m = findMicroMatch(value, marker, kind, fromIndex)
    if (m && (!best || m.start < best.start)) best = m
  }
  return best
}

interface RefMatch {
  start: number
  end: number
  kind: string
  target: string
  alias: string
}

// REF_SCAN_RE는 lookbehind를 쓰지 않으므로(참조 문법 자체가 그 규칙과 무관) 그대로 재사용한다 —
// fromIndex 이후 다음 매치를 sticky처럼 exec+lastIndex로 찾는다.
function nextRefMatch(value: string, fromIndex: number): RefMatch | null {
  REF_SCAN_RE.lastIndex = fromIndex
  const m = REF_SCAN_RE.exec(value)
  if (!m) return null
  const ref = parseRefMatch(m)
  if (!ref) return null
  return { start: m.index, end: m.index + m[0].length, kind: ref.kind, target: ref.target, alias: ref.alias }
}

// CommonMark 백슬래시 이스케이프 대상 구두점 전체(스펙 고정 목록). +, =, | 외의 이스케이프도
// 함께 인식해야 재구성값이 실제 node.value와 어긋나지 않는다(엔티티·경성 줄바꿈 등은 다루지 않고
// 안전 폴백으로 넘긴다).
const COMMONMARK_ESCAPABLE = new Set(
  '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split(''),
)

// mdast-util-from-markdown은 백슬래시 이스케이프를 소비한 뒤 텍스트 노드 값에 흔적을 남기지
// 않는다(리터럴 입력과 값이 동일 — 실측 확인됨). 이 함수는 노드의 원본 소스 슬라이스를 다시 훑어
// "어느 출력 문자가 백슬래시 이스케이프에서 왔는지" 마스크로 복원한다. 재구성값이 실제
// node.value와 어긋나면(HTML 엔티티 등 우리가 다루지 않는 디코딩 차이) null을 돌려줘 호출부가
// 이스케이프 인식 없이 안전하게 진행하게 한다(크래시 대신 이스케이프 미인식 정도로 저하).
function computeEscapeMask(node: MdNode, source: string): boolean[] | null {
  const raw = sliceSource(source, node)
  if (raw === null) return null
  let value = ''
  const mask: boolean[] = []
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '\\' && i + 1 < raw.length && COMMONMARK_ESCAPABLE.has(raw[i + 1])) {
      value += raw[i + 1]
      mask.push(true)
      i += 2
    } else {
      value += ch
      mask.push(false)
      i += 1
    }
  }
  if (value !== node.value) return null
  return mask
}

// 텍스트 노드 1개 → [텍스트, 참조/마이크로 노드, 텍스트…]. 매치가 없으면 null.
// 참조(정규식)와 마이크로 문법(수동 스캔) 두 후보 계열 중 매 단계에서 더 이른 것을 채택해
// 한 번에 훑는다 — 두 계열이 뒤섞인 본문에서도 순서대로 올바르게 갈린다.
function splitTextNode(node: MdNode, opts: { inlineFormat: boolean; source: string }): MdNode[] | null {
  const value = node.value ?? ''
  if (!value) return null
  // 이스케이프 마스크는 마이크로 문법 후보를 실제로 만났을 때만(지연) 1회 계산한다.
  let mask: boolean[] | null | undefined
  const out: MdNode[] = []
  let emitFrom = 0
  let scanFrom = 0
  const n = value.length

  while (scanFrom <= n) {
    const ref = nextRefMatch(value, scanFrom)
    const micro = opts.inlineFormat ? nextMicroMatch(value, scanFrom) : null

    let useRef = false
    if (ref && micro) useRef = ref.start <= micro.start
    else if (ref) useRef = true
    else if (!micro) break

    if (useRef && ref) {
      if (ref.start > emitFrom) out.push({ type: 'text', value: value.slice(emitFrom, ref.start) })
      out.push(makeRefNode(ref.kind, ref.target, ref.alias))
      emitFrom = ref.end
      scanFrom = ref.end
      continue
    }

    // micro가 확실히 존재하는 분기(useRef=false는 micro가 있을 때만 여기로 온다).
    const chosen = micro as MicroMatch
    if (mask === undefined) mask = computeEscapeMask(node, opts.source)
    const openEscaped = mask ? mask[chosen.start] || mask[chosen.start + 1] : false
    const closeEscaped = mask ? mask[chosen.end - 1] || mask[chosen.end - 2] : false
    if (openEscaped || closeEscaped) {
      // 백슬래시로 이스케이프됨 — 리터럴로 남기고 여는 표식 다음 글자(+1)부터 다시 찾는다
      // (무한루프 방지 + 거부 구간 안의 정상 쌍을 살리는 의도된 동작 — 위 파일 상단 주석 참조.
      // 이 구간은 이후 emitFrom~다음 매치 사이 평문으로 출력된다).
      scanFrom = chosen.start + 1
      continue
    }
    if (chosen.start > emitFrom) out.push({ type: 'text', value: value.slice(emitFrom, chosen.start) })
    out.push(makeMicroNode(chosen.kind, chosen.content))
    emitFrom = chosen.end
    scanFrom = chosen.end
  }

  if (out.length === 0) return null
  if (emitFrom < n) out.push({ type: 'text', value: value.slice(emitFrom) })
  return out
}

function replaceRefs(node: MdNode, opts: { inlineFormat: boolean; source: string }): void {
  if (!node.children || SKIP_TYPES.has(node.type)) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text') {
      const split = splitTextNode(child, opts)
      if (split) {
        next.push(...split)
        continue
      }
      next.push(child)
      continue
    }
    replaceRefs(child, opts)
    next.push(child)
  }
  node.children = next
}

function hasVisibleContent(nodes: MdNode[]): boolean {
  return nodes.some((n) => {
    if (n.type === 'text') return (n.value ?? '').trim() !== ''
    return n.type !== 'break'
  })
}

// 문단 안의 임베드를 블록으로 끌어올린다 — `<div>`가 `<p>` 안에 들어가는 잘못된 중첩 방지.
function splitParagraph(paragraph: MdNode): MdNode[] {
  const out: MdNode[] = []
  let buffer: MdNode[] = []
  const flush = () => {
    if (hasVisibleContent(buffer)) out.push({ type: 'paragraph', children: buffer })
    buffer = []
  }
  for (const child of paragraph.children ?? []) {
    if (isEmbedNode(child)) {
      flush()
      out.push(child)
    } else {
      buffer.push(child)
    }
  }
  flush()
  return out
}

function unwrapEmbeds(node: MdNode): void {
  if (!node.children) return
  for (const child of node.children) unwrapEmbeds(child)
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'paragraph' && (child.children ?? []).some(isEmbedNode)) {
      next.push(...splitParagraph(child))
    } else {
      next.push(child)
    }
  }
  node.children = next
}

export function remarkStudyRefs(options?: StudyPluginOptions) {
  const inlineFormat = options?.inlineFormat ?? true
  return (tree: MdNode, file?: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : ''
    replaceRefs(tree, { inlineFormat, source })
    unwrapEmbeds(tree)
  }
}
