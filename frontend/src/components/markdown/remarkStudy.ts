// remark 플러그인 2종 (설계 §4.19 ①②) — MarkdownView 전용.
//
// 1) remarkStudyDirectives : remark-directive가 만든 컨테이너/리프/인라인 directive를
//    data-directive 속성을 가진 요소로 변환(`:::fold[제목]` · `:::hide[제목]`).
// 2) remarkStudyRefs       : 본문 텍스트의 `![[DOC-…]]` · `[[DOC-…]]` · `[[#제목]]`을
//    data-ref-* 속성을 가진 요소 노드로 치환하고, 임베드는 문단 밖 블록으로 끌어올린다.
//
// AST 기반이므로 코드 블록·인라인 코드 안의 참조는 자연히 렌더되지 않는다(§4.19 ①).
// unist-util-visit 등 추가 의존 없이 최소 워커를 직접 돌린다(승인 의존 = remark-directive·
// rehype-slug·github-slugger 3종뿐).
import { REF_SCAN_RE, parseRefMatch } from './refSyntax'

// mdast 노드 최소 형태 — 플러그인 내부 전용(외부 타입 의존을 만들지 않는다).
interface MdNode {
  type: string
  name?: string
  value?: string
  children?: MdNode[]
  data?: Record<string, unknown>
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

function nodeText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(nodeText).join('')
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

function applyDirectives(node: MdNode): void {
  for (const child of node.children ?? []) {
    if (DIRECTIVE_TYPES.has(child.type)) {
      const label = child.type === 'containerDirective' ? hoistDirectiveLabel(child) : ''
      child.data = {
        ...(child.data ?? {}),
        // textDirective는 문단 안(인라인)에 있으므로 span, 나머지는 블록(div).
        hName: child.type === 'textDirective' ? 'span' : 'div',
        hProperties: {
          'data-directive': child.name ?? '',
          'data-directive-label': label,
        },
      }
    }
    applyDirectives(child)
  }
}

export function remarkStudyDirectives() {
  return (tree: MdNode) => {
    applyDirectives(tree)
  }
}

// ---- 2) 참조(임베드·링크 칩·앵커) ----

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

function isEmbedNode(node: MdNode): boolean {
  const props = node.data?.hProperties as Record<string, string> | undefined
  return node.type === 'studyRef' && props?.['data-ref-kind'] === 'embed'
}

// 텍스트 노드 1개 → [텍스트, 참조, 텍스트…]. 참조가 없으면 null.
function splitTextNode(node: MdNode): MdNode[] | null {
  const value = node.value ?? ''
  if (!value) return null
  REF_SCAN_RE.lastIndex = 0
  const out: MdNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = REF_SCAN_RE.exec(value)) !== null) {
    const ref = parseRefMatch(m)
    if (!ref) continue
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    out.push(makeRefNode(ref.kind, ref.target, ref.alias))
    last = m.index + m[0].length
  }
  if (out.length === 0) return null
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function replaceRefs(node: MdNode): void {
  if (!node.children || SKIP_TYPES.has(node.type)) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text') {
      const split = splitTextNode(child)
      if (split) {
        next.push(...split)
        continue
      }
      next.push(child)
      continue
    }
    replaceRefs(child)
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

export function remarkStudyRefs() {
  return (tree: MdNode) => {
    replaceRefs(tree)
    unwrapEmbeds(tree)
  }
}
