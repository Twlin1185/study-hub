// remark 플러그인 3종 (설계 §4.19 ①② + §5.3 S26/F52 + S35) — 1·2는 `editor2/transform/index.ts`
// 변환 파이프라인도 그대로 가져다 쓰고(D9 코드 격리 — import만, 무수정), 3은 **리더 렌더 전용**
// (`MarkdownView.tsx`에서만 사용 — 변환 계층에 얹으면 `{w=}`가 mdast 단계에서 사라져 `mdastToBlocks`
// 가 읽을 것이 없어진다. stage-35 F-6에서 분리 확정).
//
// 1) remarkStudyDirectives  : remark-directive가 만든 컨테이너/리프/인라인 directive를
//    data-directive 속성을 가진 요소로 변환(`:::fold[제목]` · `:::hide[제목]` · `:::note/warn/tip[제목]`
//    · `:t[텍스트]{c= bg= s=}`).
// 2) remarkStudyRefs        : 본문 텍스트의 `![[DOC-…]]` · `[[DOC-…]]` · `[[#제목]]`과
//    마이크로 인라인 문법 3종(`++밑줄++`·`==형광펜==`·`||스포일러||`, F52)을
//    data-ref-*/hName 속성을 가진 요소 노드로 치환하고, 임베드는 문단 밖 블록으로 끌어올린다.
// 3) remarkStudyImageSizes  : 이미지 직후 크기 부속 표기 `{w=<px>}`(M32 규약 E)를 img의
//    width/height로 병합한다(stage-35 F-6 — **리더 전용**, inlineFormat 토글과 무관하게 항상 동작).
//
// AST 기반이므로 코드 블록·인라인 코드 안의 참조/마이크로 문법은 자연히 렌더되지 않는다(§4.19 ①).
// unist-util-visit 등 추가 의존 없이 최소 워커를 직접 돌린다(승인 의존 = remark-directive·
// rehype-slug·github-slugger 3종뿐 — F52 마이크로 3종도 신규 의존 0으로 이 파일 안에서 충족).
import { REF_SCAN_RE, parseRefMatch } from './refSyntax'
import { HEX_INK_VAR, HEX_MARK_VAR, isHexColor, isPaletteColor, isTextSize } from './palette'

// mdast 노드 최소 형태 — 플러그인 내부 전용(외부 타입 의존을 만들지 않는다).
interface MdPoint {
  line?: number
  column?: number
  offset?: number
}

interface MdNode {
  type: string
  name?: string
  value?: string
  children?: MdNode[]
  data?: Record<string, unknown>
  attributes?: Record<string, string>
  position?: { start?: MdPoint; end?: MdPoint }
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

// 플러그인 1회 실행분의 문맥 — 옵션 + 원본 소스 + (지연 계산되는) 줄 시작 오프셋 표.
interface StudyCtx {
  inlineFormat: boolean
  source: string
  lineStarts?: number[]
}

// ---- A-0(S30): 합성 노드 position 전파 유틸 ----
// 마이크로 3종·참조는 text 노드를 문자열 인덱스로 쪼개 만들기 때문에 파서가 준 position이 없다.
// 인라인 편집 모델(S30 ⓑ 2층 계약)은 "편집하지 않은 노드는 원본 슬라이스를 그대로 재출력"해야
// 하므로 모든 합성 노드에 소스 오프셋이 필요하다. **위치 정보만 덧붙이며 문법·렌더는 무변경**이다
// (hast 변환은 position을 그대로 복사할 뿐이고 react-markdown은 렌더에 쓰지 않는다 — 렌더 diff 0).

function lineStartsOf(ctx: StudyCtx): number[] {
  if (!ctx.lineStarts) {
    const starts = [0]
    for (let i = 0; i < ctx.source.length; i += 1) {
      if (ctx.source[i] === '\n') starts.push(i + 1)
    }
    ctx.lineStarts = starts
  }
  return ctx.lineStarts
}

// 소스 오프셋 → unist Point(1-based line/column + offset). 줄 시작 표를 이진 탐색한다.
function pointAt(ctx: StudyCtx, offset: number): MdPoint {
  const starts = lineStartsOf(ctx)
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: offset - starts[lo] + 1, offset }
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

function applyDirectives(node: MdNode, opts: StudyCtx): void {
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
      const hProperties: Record<string, string | string[]> = {
        'data-directive': name,
        'data-directive-label': label,
      }
      if (opts.inlineFormat && name === 't') {
        // 통합 인라인 directive 속성 화이트리스트 — 밖의 값·미지 속성은 조용히 무시(오류 아님).
        // S30 ⓓ(C-3ⓐ)에서 색 값 화이트리스트가 **팔레트 7색 이름 ∪ `#rrggbb`**로 넓어졌다.
        // 팔레트 이름은 종전대로 data-ink/data-mark(토큰 클래스 매핑)로, 자유 hex는 커스텀
        // 프로퍼티 1개(`--u-ink`/`--u-bg`)와 클래스 u-ink/u-mark로만 방출한다 — 실제 color·
        // background-color 계산은 tokens.css가 하고(다크 모드 자동 보정), 임의 CSS 문자열이
        // 속성값으로 사는 경로는 없다(3자리 축약·rgb()·색 이름은 여전히 불허 = 스타일만 무시).
        const attrs = child.attributes ?? {}
        const styleDecls: string[] = []
        const classNames: string[] = []
        if (attrs.c) {
          if (isPaletteColor(attrs.c)) hProperties['data-ink'] = attrs.c
          else if (isHexColor(attrs.c)) {
            styleDecls.push(`${HEX_INK_VAR}:${attrs.c}`)
            classNames.push('u-ink')
          }
        }
        if (attrs.bg) {
          if (isPaletteColor(attrs.bg)) hProperties['data-mark'] = attrs.bg
          else if (isHexColor(attrs.bg)) {
            styleDecls.push(`${HEX_MARK_VAR}:${attrs.bg}`)
            classNames.push('u-mark')
          }
        }
        if (attrs.s && isTextSize(attrs.s)) hProperties['data-size'] = attrs.s
        // 기존(팔레트 전용) 본문은 이 두 속성이 붙지 않으므로 렌더 diff 0이다.
        if (styleDecls.length) hProperties.style = styleDecls.join(';')
        if (classNames.length) hProperties.className = classNames
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

// 값 인덱스 → 소스 오프셋 변환기. 백슬래시 이스케이프(`\*` = 소스 2자 → 값 1자)를 보정한다.
// 보정이 불확실하면 null을 돌려주고, 호출부는 position을 붙이지 않는다(종전 동작으로 안전 저하).
function makeOffsetMapper(node: MdNode, source: string, mask: boolean[] | null): ((i: number) => number) | null {
  const base = node.position?.start?.offset
  if (typeof base !== 'number') return null
  const value = node.value ?? ''
  if (!mask) {
    // 이스케이프 마스크 복원 실패(엔티티 등 우리가 다루지 않는 디코딩) — 길이가 같을 때만
    // 값 인덱스와 소스 오프셋이 1:1임을 확신할 수 있다.
    const raw = sliceSource(source, node)
    if (raw === null || raw.length !== value.length) return null
    return (i) => base + i
  }
  const extra: number[] = new Array(value.length + 1)
  let acc = 0
  extra[0] = 0
  for (let i = 0; i < value.length; i += 1) {
    if (mask[i]) acc += 1
    extra[i + 1] = acc
  }
  return (i) => {
    const clamped = i < 0 ? 0 : i > value.length ? value.length : i
    return base + clamped + extra[clamped]
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
function splitTextNode(node: MdNode, opts: StudyCtx): MdNode[] | null {
  const value = node.value ?? ''
  if (!value) return null
  const out: MdNode[] = []
  // 이스케이프 마스크는 마이크로 문법 후보를 실제로 만났을 때만(지연) 1회 계산한다.
  let mask: boolean[] | null | undefined
  const ensureMask = (): boolean[] | null => {
    if (mask === undefined) mask = computeEscapeMask(node, opts.source)
    return mask
  }
  // A-0: 분할 결과 노드에 부모 text 노드 오프셋 + 값 인덱스로 계산한 position을 부여한다.
  let mapper: ((i: number) => number) | null | undefined
  const setPos = (target: MdNode, from: number, to: number): void => {
    if (mapper === undefined) mapper = makeOffsetMapper(node, opts.source, ensureMask())
    if (!mapper) return
    target.position = { start: pointAt(opts, mapper(from)), end: pointAt(opts, mapper(to)) }
  }
  const pushText = (from: number, to: number): void => {
    const textNode: MdNode = { type: 'text', value: value.slice(from, to) }
    setPos(textNode, from, to)
    out.push(textNode)
  }
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
      if (ref.start > emitFrom) pushText(emitFrom, ref.start)
      const refNode = makeRefNode(ref.kind, ref.target, ref.alias)
      setPos(refNode, ref.start, ref.end)
      out.push(refNode)
      emitFrom = ref.end
      scanFrom = ref.end
      continue
    }

    // micro가 확실히 존재하는 분기(useRef=false는 micro가 있을 때만 여기로 온다).
    const chosen = micro as MicroMatch
    ensureMask()
    const openEscaped = mask ? mask[chosen.start] || mask[chosen.start + 1] : false
    const closeEscaped = mask ? mask[chosen.end - 1] || mask[chosen.end - 2] : false
    if (openEscaped || closeEscaped) {
      // 백슬래시로 이스케이프됨 — 리터럴로 남기고 여는 표식 다음 글자(+1)부터 다시 찾는다
      // (무한루프 방지 + 거부 구간 안의 정상 쌍을 살리는 의도된 동작 — 위 파일 상단 주석 참조.
      // 이 구간은 이후 emitFrom~다음 매치 사이 평문으로 출력된다).
      scanFrom = chosen.start + 1
      continue
    }
    if (chosen.start > emitFrom) pushText(emitFrom, chosen.start)
    const microNode = makeMicroNode(chosen.kind, chosen.content)
    setPos(microNode, chosen.start, chosen.end)
    // 내용 text 자식은 표식 2자 안쪽 구간(`++`·`==`·`||` 전부 길이 2).
    const inner = microNode.children?.[0]
    if (inner) setPos(inner, chosen.start + 2, chosen.end - 2)
    out.push(microNode)
    emitFrom = chosen.end
    scanFrom = chosen.end
  }

  if (out.length === 0) return null
  if (emitFrom < n) pushText(emitFrom, n)
  return out
}

function replaceRefs(node: MdNode, opts: StudyCtx): void {
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

// ---- 3) 이미지 크기 표기 `{w=<px>}`(선택 `h=`) 반영 (M32 규약 E, stage-35 F-6 리더 반영) ----
//
// editor2/transform/mdastToBlocks.ts의 SIZE_SUFFIX_RE와 동일 문법을 공용 리더에서도 인식한다
// (파서·표기는 M32에서 확정, 여기서는 remark 플러그인 추가 없이 기존 mdast 트리를 후처리).
// 이미지 노드 바로 다음 형제가 `{w=400}`으로 시작하는 text 노드일 때만 인정하고, **원문 슬라이스가
// 실제로 `{`로 시작할 때만** 소비한다 — `\{w=400}`으로 이스케이프해 평문을 적은 경우까지 삼키지
// 않기 위해서다(transform 계층과 동일 방어). 매치가 없는 이미지·문서는 이 함수가 트리를 전혀 바꾸지
// 않으므로 렌더 diff 0이 성립한다.
//
// **별도 플러그인으로 분리한다**(`remarkStudyRefs` 안에 넣지 않는다) — `remarkStudyRefs`는
// `editor2/transform/index.ts`가 변환 파이프라인에도 그대로 가져다 쓰므로, 거기 섞으면 `{w=}`
// 텍스트가 mdast 단계에서 사라져 `mdastToBlocks.ts`의 `SIZE_SUFFIX_RE`가 볼 것이 없어진다
// (stage-35 F-6 1차 구현 결함 — A/B 실측으로 확정, 이 분리로 해소). 이 플러그인은 **리더 렌더
// 파이프라인에만**(`MarkdownView.tsx`) `remarkStudyRefs` 뒤에 얹는다 — 변환 계층은 무접촉.
const IMAGE_SIZE_RE = /^\{w=(\d+)(?:[ \t]+h=(\d+))?\}/

function applyImageSizes(node: MdNode, source: string): void {
  const children = node.children
  if (!children) return
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    if (child.type === 'image') {
      const next = children[i + 1]
      if (next && next.type === 'text') {
        const value = next.value ?? ''
        const m = IMAGE_SIZE_RE.exec(value)
        if (m) {
          const raw = sliceSource(source, next)
          if (raw !== null && raw.startsWith(m[0])) {
            const width = Number(m[1])
            const height = m[2] === undefined ? undefined : Number(m[2])
            const hProperties: Record<string, number> = { width }
            if (height !== undefined) hProperties.height = height
            // mdast-util-to-hast의 image 핸들러가 기본 생성한 img 요소 속성(src/alt/title)에
            // hProperties가 그대로 병합된다(hName 미지정 — 태그 교체 없음).
            child.data = { ...(child.data ?? {}), hProperties }
            const consumed = m[0].length
            const remaining = value.slice(consumed)
            if (remaining === '') {
              children.splice(i + 1, 1)
            } else {
              next.value = remaining
              // 소비한 만큼 남은 텍스트의 시작 오프셋을 민다 — 이스케이프 없는 접두 구간이라
              // 원문 문자 수 = value 문자 수(위 raw.startsWith 확인으로 보장)이므로 1:1 이동이다.
              const start = next.position?.start
              if (start && typeof start.offset === 'number') {
                next.position = {
                  ...next.position,
                  start: {
                    ...start,
                    offset: start.offset + consumed,
                    column: typeof start.column === 'number' ? start.column + consumed : start.column,
                  },
                }
              }
            }
          }
        }
      }
    }
    applyImageSizes(child, source)
  }
}

/** 리더 렌더 파이프라인 전용 plugin — `MarkdownView.tsx`에서만 `remarkStudyRefs` 뒤에 붙인다. */
export function remarkStudyImageSizes() {
  return (tree: MdNode, file?: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : ''
    applyImageSizes(tree, source)
  }
}
