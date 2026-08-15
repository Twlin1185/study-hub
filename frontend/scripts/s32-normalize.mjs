// S32 검증 공용 — **정규화 함수 N**(규약 A-1)과 비교 유틸.
//
// 변환기(`editor2/transform`)와 **독립**으로 mdast 위에 구현한다 — 변환기가 정보를 흘리면 양쪽이
// 똑같이 흘려 통과하는 공허한 검사가 되기 때문이다. N의 정의(stage-32 규약 A-1):
//   ⓐ position 제거 ⓑ 인라인 트리를 **(텍스트, 마크 집합) run 배열로 평탄화**하고 인접 동일-마크
//   run 병합(강조 중첩 순서의 파싱 모호성 흡수) ⓒ 블록 구조·순서·속성은 그대로 비교.
// 여기에 모델이 강제하는 두 정규화가 더해진다(둘 다 Markdown이 표현할 수 없는 표기 잔여다):
//   · 블록 **가장자리 공백** 제거(파서가 항상 버리는 자리 — 변환기와 같은 규칙)
//   · **list 컨테이너 해체**(규약 B가 목록을 listItem 단위로 못박았다 — 인접 동종 목록은 한 목록)

/** 키 순서에 영향받지 않는 정규 직렬화(deep-equal 비교용). */
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

/** 블록 트리에서 id를 걷어낸다(동형성 비교 대상 제외 — 규약 B). */
export function stripIds(node) {
  if (Array.isArray(node)) return node.map(stripIds)
  if (node && typeof node === 'object') {
    const out = {}
    for (const key of Object.keys(node)) {
      if (key === 'id') continue
      out[key] = stripIds(node[key])
    }
    return out
  }
  return node
}

/** sourceFallback·inlineFallback 발생 집계(규약 D). */
export function countFallbacks(blocks, acc = { block: 0, inline: 0, types: new Map() }) {
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)
  const walkInline = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.type === 'inlineFallback') {
        acc.inline += 1
        bump(acc.types, node.nodeType)
      }
      if (node.type === 'link') walkInline(node.children)
    }
  }
  for (const block of blocks ?? []) {
    if (block.type === 'sourceFallback') {
      acc.block += 1
      bump(acc.types, block.nodeType)
    }
    walkInline(block.content)
    if (block.type === 'table') for (const row of block.rows) for (const cell of row) walkInline(cell)
    countFallbacks(block.children ?? [], acc)
  }
  return acc
}

const N_MARKS = ['bold', 'italic', 'strike', 'underline', 'highlight', 'spoiler']

function markKey(marks) {
  const flags = N_MARKS.filter((mark) => marks[mark]).join(',')
  const t = marks.t
    ? Object.keys(marks.t)
        .sort()
        .map((key) => `${key}=${marks.t[key]}`)
        .join(' ')
    : ''
  return `${flags}|${t}`
}

function microOf(node) {
  const hName = node.data?.hName
  if (hName === 'u') return 'underline'
  if (hName === 'mark') return 'highlight'
  return 'spoiler'
}

function attrsOf(node) {
  const attrs = node.attributes ?? {}
  const out = {}
  for (const key of Object.keys(attrs)) out[key] = attrs[key] ?? ''
  return out
}

function refPropsOf(node) {
  const props = node.data?.hProperties ?? {}
  return {
    kind: props['data-ref-kind'] ?? '',
    target: props['data-ref-target'] ?? '',
    alias: props['data-ref-alias'] ?? '',
  }
}

function flattenInline(nodes, marks, out) {
  for (const node of nodes ?? []) {
    const m = markKey(marks)
    switch (node.type) {
      case 'text':
        out.push({ k: 't', m, s: node.value ?? '' })
        break
      case 'strong':
        flattenInline(node.children, { ...marks, bold: true }, out)
        break
      case 'emphasis':
        flattenInline(node.children, { ...marks, italic: true }, out)
        break
      case 'delete':
        flattenInline(node.children, { ...marks, strike: true }, out)
        break
      case 'studyInline':
        flattenInline(node.children, { ...marks, [microOf(node)]: true }, out)
        break
      case 'textDirective':
        if (node.name === 't') {
          // 중첩 `:t`는 **안쪽 값이 이긴다**(기존 collapseStyleChain 규칙).
          flattenInline(node.children, { ...marks, t: { ...(marks.t ?? {}), ...attrsOf(node) } }, out)
        } else {
          out.push({ k: 'dir', m, name: node.name ?? '', attrs: attrsOf(node) })
        }
        break
      case 'inlineCode':
        out.push({ k: 'code', m, v: node.value ?? '' })
        break
      case 'inlineMath':
        out.push({ k: 'math', m, v: node.value ?? '' })
        break
      case 'link':
        out.push({
          k: 'link',
          m,
          url: node.url ?? '',
          title: node.title ?? null,
          c: normInlineList(node.children, marks),
        })
        break
      case 'image':
        out.push({ k: 'img', m, url: node.url ?? '', alt: node.alt ?? '', title: node.title ?? null })
        break
      case 'studyRef':
        out.push({ k: 'ref', m, ...refPropsOf(node) })
        break
      case 'break':
        out.push({ k: 'br', m })
        break
      default:
        out.push({
          k: node.type,
          m,
          v: node.value ?? null,
          c: node.children ? normInlineList(node.children, marks) : null,
        })
        break
    }
  }
  return out
}

/** 인접 동일-마크 텍스트 run 병합 + 빈 run 제거. */
function mergeRuns(runs) {
  const out = []
  for (const run of runs) {
    const prev = out[out.length - 1]
    if (run.k === 't' && prev && prev.k === 't' && prev.m === run.m) {
      prev.s += run.s
      continue
    }
    out.push(run.k === 't' ? { ...run } : run)
  }
  return out.filter((run) => run.k !== 't' || run.s !== '')
}

/** 블록 가장자리 공백 제거 — 변환기 `mdastToBlocks.trimEdges`와 같은 규칙. */
function trimEdgeRuns(runs) {
  const out = runs.slice()
  if (out[0]?.k === 't') {
    const s = out[0].s.replace(/^[ \t]+/, '')
    if (s === '') out.shift()
    else out[0] = { ...out[0], s }
  }
  const last = out.length - 1
  if (out[last]?.k === 't') {
    const s = out[last].s.replace(/[ \t]+$/, '')
    if (s === '') out.pop()
    else out[last] = { ...out[last], s }
  }
  return out
}

function normInlineList(nodes, marks) {
  return mergeRuns(flattenInline(nodes, marks ?? {}, []))
}

function normContent(nodes) {
  return trimEdgeRuns(normInlineList(nodes, {}))
}

/**
 * 블록 배열 정규화. **list 컨테이너는 걷어내고 항목 시퀀스로 편다** — 규약 B가 목록을
 * "listItem 블록 + children 중첩"으로 못박았기 때문이다(BlockNote와 동형).
 *
 * 단, 컨테이너를 걷어내되 **목록 경계는 `groupBreak`로 보존**한다. CommonMark에서 마커·구분자
 * 변경(`- …` 다음의 `* …`, `1. …` 다음의 `1) …`)은 목록 분리 표기이고 remark도 두 list로 읽으므로,
 * 이를 뭉개면 실재하는 손실을 정규형이 은폐하게 된다(stage-32 검토 A3). 같은 마커로 이어진 목록만
 * 하나로 합쳐지는 것이 정상이며 그 경우는 groupBreak가 서지 않는다.
 */
function normBlocks(nodes) {
  const out = []
  for (const node of nodes ?? []) {
    if (node.type !== 'list') {
      out.push(normBlock(node))
      continue
    }
    const ordered = node.ordered === true
    const prev = out[out.length - 1]
    const continuing = Boolean(prev && prev.t === 'li' && prev.ordered === ordered)
    ;(node.children ?? []).forEach((item, idx) => {
      out.push({
        t: 'li',
        ordered,
        // 앞 형제도 같은 종류의 목록이었다면 여기가 **분리 경계**다.
        groupBreak: idx === 0 && continuing,
        // 시작 번호는 **그룹의 첫 항목**에만 의미가 있다(뒤 항목 번호는 파서가 무시한다).
        start: ordered && idx === 0 ? (node.start ?? 1) : null,
        checked: typeof item.checked === 'boolean' ? item.checked : null,
        c: normBlocks(item.children),
      })
    })
  }
  return out
}

function normBlock(node) {
  switch (node.type) {
    case 'paragraph':
      return { t: 'p', c: normContent(node.children) }
    case 'heading':
      return { t: 'h', d: node.depth ?? 1, c: normContent(node.children) }
    case 'blockquote':
      return { t: 'quote', c: normBlocks(node.children) }
    case 'code':
      return { t: 'code', lang: node.lang ?? null, meta: node.meta ?? null, v: node.value ?? '' }
    case 'math':
      return { t: 'math', v: node.value ?? '' }
    case 'thematicBreak':
      return { t: 'hr' }
    case 'table':
      return {
        t: 'table',
        align: (node.align ?? []).map((a) => a ?? null),
        rows: (node.children ?? []).map((row) =>
          (row.children ?? []).map((cell) => normContent(cell.children)),
        ),
      }
    case 'containerDirective':
      return {
        t: 'dir',
        name: node.name ?? '',
        label: node.data?.hProperties?.['data-directive-label'] ?? '',
        attrs: attrsOf(node),
        c: normBlocks(node.children),
      }
    case 'studyRef':
      return { t: 'refblock', ...refPropsOf(node) }
    default:
      return {
        t: node.type,
        v: node.value ?? null,
        c: node.children ? normBlocks(node.children) : null,
      }
  }
}

/** `parseToMdast`(변환기가 쓰는 것과 **같은 파이프라인**)를 주입해 N을 만든다. */
export function makeNormalize(parseToMdast) {
  return (md) => {
    const root = parseToMdast(md)
    if (!root) return { t: 'PARSE_ERROR', v: md }
    return normBlocks(root.children)
  }
}
