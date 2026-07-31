// 문서 상호참조 문법(설계 §4.19 ①·②) — 정규식 명세는 설계가 단일 출처, 여기는 그 정규식과
// remark 커스텀 플러그인 구현이다. react-markdown v10(unified) 파이프라인에 꽂는다.
//
// 문법 3종(①):
//   임베드   ![[DOC-0012]]              — 대상 문서 본문을 그 자리에 카드로 펼침
//   문서 링크 [[DOC-0012]] / [[DOC-0012|표시명]] — 문서 상세로 이동하는 칩
//   헤딩 앵커 [[#절 제목]]               — 같은 렌더 문서 내 헤딩으로 스크롤
//
// 코드 펜스·인라인 코드 내부는 참조로 취급하지 않는다 — remark AST 단계에서 자연 배제(코드
// 노드는 mdast에서 'text' 타입이 아니라 'code'/'inlineCode' 타입이고 별도 children이 없어
// 아래 walkAndSplit()의 재귀가 안으로 들어가지 않는다).
// rehype-slug의 의존 패키지를 그대로 재사용(설계 §4.19 ⑥ — "같은 github-slugger로
// 슬러그화"). package.json에는 직접 등재하지 않는다(신규 의존성은 remark-directive·
// rehype-slug 2개만 — 이 임포트는 rehype-slug가 실제로 설치를 강제하는 전이 의존이다).
import { slug as githubSlug } from 'github-slugger'

// 임베드 별칭부(`|...`)는 파싱만 하고 버린다(설계 §4.19 ① — "임베드에서는 별칭이 표시될
// 자리가 없어 무시한다. 단 파서는 오류로 취급하지 않는다").
export const DOC_REF_RE =
  /!\[\[(DOC-\d{4,})(?:\|[^\]\n]*)?\]\]|\[\[(DOC-\d{4,})(?:\|([^\]\n]+))?\]\]|\[\[#([^\]\n]+)\]\]/g

export interface DocRefMatch {
  kind: 'embed' | 'link' | 'anchor'
  docNo?: string
  alias?: string
  anchorText?: string
  raw: string
}

export function parseDocRefMatch(m: RegExpMatchArray): DocRefMatch {
  const [raw, embedDoc, linkDoc, linkAlias, anchorText] = m
  if (embedDoc) return { kind: 'embed', docNo: embedDoc, raw }
  if (linkDoc) return { kind: 'link', docNo: linkDoc, alias: linkAlias?.trim() || undefined, raw }
  return { kind: 'anchor', anchorText: (anchorText ?? '').trim(), raw }
}

// ---- 배치 해석 호출 전 사전 스캔 (react-query 배치용 doc_no 수집) ----
// 서버 인덱스 파서와 동일 원칙(설계 §4.19 ①): 펜스·인라인 코드 구간을 제거한 뒤 정규식 스캔.
function stripCodeSpans(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/~~~[\s\S]*?~~~/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

export interface ExtractedDocRefs {
  embeds: string[]
  links: string[]
}

export function extractDocRefs(content: string | null | undefined): ExtractedDocRefs {
  if (!content) return { embeds: [], links: [] }
  const stripped = stripCodeSpans(content)
  const embeds = new Set<string>()
  const links = new Set<string>()
  for (const m of stripped.matchAll(DOC_REF_RE)) {
    const ref = parseDocRefMatch(m)
    if (ref.kind === 'embed' && ref.docNo) embeds.add(ref.docNo)
    else if (ref.kind === 'link' && ref.docNo) links.add(ref.docNo)
  }
  return { embeds: [...embeds], links: [...links] }
}

// ---- remark 플러그인: 참조 문법(①) — 텍스트 노드를 커스텀 mdast 노드로 치환 ----
// hName/hProperties를 지정해 mdast-util-to-hast가 그대로 hast 엘리먼트로 만들게 하고,
// react-markdown의 `components` 매핑(모듈 레벨 고정 컴포넌트)이 실제 렌더를 담당한다.
interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  data?: { hName?: string; hProperties?: Record<string, unknown>; directiveLabel?: boolean }
  name?: string
  [key: string]: unknown
}

function splitTextNode(value: string): MdastNode[] {
  const matches = [...value.matchAll(DOC_REF_RE)]
  if (matches.length === 0) return [{ type: 'text', value }]

  const nodes: MdastNode[] = []
  let cursor = 0
  for (const m of matches) {
    const start = m.index ?? 0
    if (start > cursor) nodes.push({ type: 'text', value: value.slice(cursor, start) })
    const ref = parseDocRefMatch(m)
    if (ref.kind === 'embed') {
      nodes.push({ type: 'docEmbed', data: { hName: 'docembed', hProperties: { docNo: ref.docNo } } })
    } else if (ref.kind === 'link') {
      nodes.push({
        type: 'docLink',
        data: { hName: 'doclink', hProperties: { docNo: ref.docNo, alias: ref.alias } },
      })
    } else {
      nodes.push({ type: 'docAnchor', data: { hName: 'docanchor', hProperties: { text: ref.anchorText } } })
    }
    cursor = start + m[0].length
  }
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return nodes
}

function walkAndSplitRefs(node: MdastNode): void {
  if (!Array.isArray(node.children)) return
  const next: MdastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...splitTextNode(child.value))
    } else {
      walkAndSplitRefs(child)
      next.push(child)
    }
  }
  node.children = next
}

export function remarkDocRefs() {
  return (tree: MdastNode) => {
    walkAndSplitRefs(tree)
  }
}

// ---- remark 플러그인: remark-directive 컨테이너 → hName 매핑(②, D2 확정) ----
// :::fold[라벨] / :::hide[라벨] 만 스타일 컴포넌트로 매핑, 그 외 지시자는 "스타일 없이
// 내용만 렌더"(무해 통과 — hName을 div로 지정해 children만 통과시킨다).
function directiveLabelText(node: MdastNode): string {
  if (node.type === 'text') return node.value ?? ''
  if (Array.isArray(node.children)) return node.children.map(directiveLabelText).join('')
  return ''
}

function walkDirectives(node: MdastNode): void {
  if (node.type === 'containerDirective') {
    let children = node.children ?? []
    let label: string | undefined
    if (children[0]?.data?.directiveLabel) {
      label = directiveLabelText(children[0]).trim() || undefined
      children = children.slice(1)
    }
    node.children = children

    if (node.name === 'fold') {
      node.data = { hName: 'fold-block', hProperties: { label } }
    } else if (node.name === 'hide') {
      node.data = { hName: 'hide-block', hProperties: { label } }
    } else {
      // 미등록 지시자 이름 — 오류 아님, 내용만 통과시킨다(실제 HTML div 태그와 충돌하지
      // 않도록 커스텀 태그명을 쓴다).
      node.data = { hName: 'directive-generic', hProperties: {} }
    }
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(walkDirectives)
  }
}

export function remarkDocDirectives() {
  return (tree: MdastNode) => {
    walkDirectives(tree)
  }
}

// ---- 헤딩 앵커 슬러그 (D3-③ 확정 — rehype-slug와 동일 github-slugger 규칙) ----
// 상태 없는(dedup 카운터 없는) slug() 함수를 그대로 쓴다 — 문서 내 첫 번째 동일 제목 헤딩에
// rehype-slug가 부여하는 id와 정확히 같은 값이 나온다(중복 시 처리는 설계 §4.19 ⑥이 수용한
// "문서 순서상 첫 요소로 스크롤"과 일치).
export function slugifyHeading(text: string): string {
  return githubSlug(text)
}
