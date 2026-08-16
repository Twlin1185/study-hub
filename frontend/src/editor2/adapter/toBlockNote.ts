// 앱 중립 블록 → BlockNote 블록 JSON (M33 F-3 / M34 stage-34 G-8 · 규약 B)
//
// **순수 JSON 변환**이다 — 에디터 인스턴스도, `@blocknote/*` import도 없다.
//
// 범위(stage-34 이후 = **전 팔레트**):
//   코어  : paragraph · heading(1~6) · listItem 3종(중첩) · quote · codeBlock · table · image ·
//           divider + 인라인(bold·italic·strike·underline·inlineCode·link·줄바꿈)
//   방언  : `==형광==` · `||스포일러||` · `:t{…}` · 참조 칩 3종 · 문단 안 이미지 · 수식(블록·인라인) ·
//           콜아웃 · 문서 임베드 · 원문 보존(블록·인라인) · 경성 줄바꿈
// 방언에는 **더 이상 미지원이 없다** — stage-33이 두었던 "방언 = 읽기 전용 폴백" 경로는 사라졌다.
//
// **손실 0 계약**은 그대로다: 옮길 수 없는 것을 만나면 조용히 버리지 않고 `unsupported`에 보고한다.
// 남아 있는 보고는 규약 I의 **코어 범위 제약**과 구조적 사유뿐이다:
//
//   ┌ 흡수 4종(보고가 사라졌다 — 아래 방식으로 왕복 보존한다)
//   │  · `inline:hardBreak` → 원자 인라인 `lineBreak`(BlockNote 코어 `hardBreak` 노드와 이름 충돌
//   │     회피 — 코어는 그 이름을 만나면 `\n`으로 접어 버린다)
//   │  · `link:title`       → **사이드카**(블록 id → href → title). 링크 노드에 자리가 없다.
//   │  · `image:title`/`image:height` → 내장 image 스펙 **prop 확장**(codeBlock `info` 전례)
//   │  · `block:meta`       → **사이드카**(provenance 예약 필드 — 편집 표면에 올릴 자리가 없다)
//   └
//   ┌ 판정 대기 3종(R34 — **임의 흡수 금지**. 보고를 유지한다)
//   │  · `listItem:spread` · `listItem:groupBreak` — 평평한 목록 모델에 자리가 없다(prop 추가 금지)
//   │  · `table:align`      — 사이드카로 **왕복 보존은 하되** 보고는 유지한다. 정렬 **편집 UI**는
//   │     M35 범위라, 편집 표면에 올리지 않은 값이 따라다닌다는 사실을 사용자가 알아야 한다.
//   └
//   구조적 사유: `link:nested` · `listItem:orderedChecked` · `heading:level` ·
//   `inline:mathStyles`(채택한 math 스펙의 propSchema가 비어 서식을 실을 자리가 없다) ·
//   `inline:unknown` · `block:unknown`
import type { AttrPair, Block, BlockDocument, InlineNode, InlineStyles } from '../schema/blocks'
import type {
  AdapterIssue,
  AdapterSidecar,
  AdapterSidecarEntry,
  BnBlock,
  BnInline,
  BnStyledText,
  BnStyles,
  ToBlockNoteResult,
} from './types'

interface Ctx {
  issues: AdapterIssue[]
  sidecar: AdapterSidecar
  /** 지금 변환 중인 블록의 사이드카 키(= 역변환이 되살릴 블록 id). */
  key: string
}

function report(ctx: Ctx, path: string, kind: string, detail?: string) {
  ctx.issues.push(detail === undefined ? { path, kind } : { path, kind, detail })
}

function sidecarEntry(ctx: Ctx): AdapterSidecarEntry {
  let entry = ctx.sidecar[ctx.key]
  if (!entry) {
    entry = {}
    ctx.sidecar[ctx.key] = entry
  }
  return entry
}

// ---------------------------------------------------------------- 인라인

/** `:t` 속성 쌍 → 스타일 prop 문자열(원본 순서·중복 키·미지 키까지 그대로). */
function encodeAttrPairs(pairs: AttrPair[] | undefined): string {
  return pairs && pairs.length > 0 ? JSON.stringify(pairs) : ''
}

function mapStyles(styles: InlineStyles | undefined, extra?: BnStyles): BnStyles {
  const out: BnStyles = { ...extra }
  if (!styles) return out
  if (styles.bold) out.bold = true
  if (styles.italic) out.italic = true
  if (styles.strike) out.strike = true
  if (styles.underline) out.underline = true
  if (styles.highlight) out.highlight = true
  if (styles.spoiler) out.spoiler = true
  if (styles.t && styles.t.length > 0) out.t = encodeAttrPairs(styles.t)
  return out
}

/**
 * 원자 인라인(참조 칩·문단 안 이미지·원문 보존·경성 줄바꿈)이 들고 다니는 서식 prop.
 * BlockNote는 커스텀 인라인 노드의 mark를 되읽을 때 버리므로 prop으로 싣는다(types.ts 주석 참조).
 */
function encodeInlineStyles(styles: InlineStyles | undefined): string {
  if (!styles) return ''
  const bn = mapStyles(styles)
  return Object.keys(bn).length > 0 ? JSON.stringify(bn) : ''
}

/** 인라인 배열 → BlockNote 인라인. 부드러운 줄바꿈은 텍스트 안 `\n`으로 접힌다. */
function inlineToBn(ctx: Ctx, path: string, nodes: InlineNode[] | undefined): BnInline[] {
  const out: BnInline[] = []
  const pushText = (text: string, styles: BnStyles) => {
    if (text === '') return
    const last = out[out.length - 1]
    if (last && last.type === 'text' && sameStyles(last.styles, styles)) {
      last.text += text
      return
    }
    out.push({ type: 'text', text, styles })
  }

  ;(nodes ?? []).forEach((node, i) => {
    const at = `${path}[${i}]`
    switch (node.type) {
      case 'text':
        pushText(node.text, mapStyles(node.styles))
        break
      case 'inlineCode':
        pushText(node.value, mapStyles(node.styles, { code: true }))
        break
      case 'softBreak':
        pushText('\n', mapStyles(node.styles))
        break
      case 'hardBreak':
        // 규약 I 흡수 ① — 원자 인라인으로 보존한다(코어 `hardBreak` 노드와 이름이 겹치지 않게 `lineBreak`).
        out.push({ type: 'lineBreak', props: { styles: encodeInlineStyles(node.styles) } })
        break
      case 'link': {
        if (node.title !== undefined) {
          // 규약 I 흡수 ② — 링크 노드에 자리가 없으므로 **사이드카**(블록 id → href → title)에 둔다.
          const entry = sidecarEntry(ctx)
          entry.linkTitles = { ...entry.linkTitles, [node.url]: node.title }
        }
        const inner = inlineToBn(ctx, `${at}.children`, node.children)
        const content: BnStyledText[] = []
        for (const child of inner) {
          if (child.type === 'text') content.push(child)
          else report(ctx, at, 'link:nested', '링크 안에는 텍스트만 올 수 있습니다')
        }
        out.push({ type: 'link', href: node.url, content })
        break
      }
      case 'inlineMath':
        // 채택 스펙(`@blocknote/math-block`의 `math`)은 propSchema가 비어 서식을 실을 자리가 없다.
        if (node.styles && Object.keys(mapStyles(node.styles)).length > 0) {
          report(ctx, at, 'inline:mathStyles', '인라인 수식에 걸린 서식은 편집 표면이 담지 못합니다')
        }
        out.push({ type: 'math', props: {}, content: node.value })
        break
      case 'refChip':
        out.push({
          type: 'refChip',
          props: {
            refType: node.ref,
            target: node.target,
            // 규약 C: `label:''` ⇔ 라벨 추종형(앱 `label === undefined`).
            label: node.label ?? '',
            styles: encodeInlineStyles(node.styles),
          },
        })
        break
      case 'inlineImage':
        out.push({
          type: 'inlineImage',
          props: {
            url: node.url,
            alt: node.alt,
            title: node.title ?? '',
            width: node.width ?? 0,
            height: node.height ?? 0,
            styles: encodeInlineStyles(node.styles),
          },
        })
        break
      case 'inlineFallback':
        out.push({
          type: 'inlineFallback',
          props: {
            markdown: node.markdown,
            nodeType: node.nodeType,
            styles: encodeInlineStyles(node.styles),
          },
        })
        break
      default:
        report(ctx, at, 'inline:unknown')
        break
    }
  })
  return out
}

function sameStyles(a: BnStyles, b: BnStyles): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strike === !!b.strike &&
    !!a.underline === !!b.underline &&
    !!a.code === !!b.code &&
    !!a.highlight === !!b.highlight &&
    !!a.spoiler === !!b.spoiler &&
    (a.t ?? '') === (b.t ?? '')
  )
}

// ---------------------------------------------------------------- 블록

function blocksToBn(ctx: Ctx, path: string, blocks: Block[] | undefined): BnBlock[] {
  const out: BnBlock[] = []
  ;(blocks ?? []).forEach((block, i) => {
    const converted = blockToBn(ctx, `${path}[${i}]`, block)
    if (converted) out.push(converted)
  })
  return out
}

/** 사이드카 키를 이 블록으로 바꾸고 변환한다(중첩 블록이 서로의 항목을 덮어쓰지 않게 한다). */
function withKey<T>(ctx: Ctx, key: string, run: () => T): T {
  const prev = ctx.key
  ctx.key = key
  try {
    return run()
  } finally {
    ctx.key = prev
  }
}

function blockToBn(ctx: Ctx, at: string, block: Block): BnBlock | null {
  return withKey(ctx, block.id, () => blockToBnInner(ctx, at, block))
}

function blockToBnInner(ctx: Ctx, at: string, block: Block): BnBlock | null {
  // 규약 I 흡수 ④ — 블록 메타(provenance)는 편집 표면에 자리가 없으므로 사이드카로 왕복한다.
  if (block.meta) sidecarEntry(ctx).meta = block.meta
  const id = block.id

  switch (block.type) {
    case 'paragraph':
      return { id, type: 'paragraph', content: inlineToBn(ctx, `${at}.content`, block.content) }

    case 'heading': {
      const level = block.level
      if (!(level >= 1 && level <= 6)) report(ctx, at, 'heading:level', `지원하지 않는 헤딩 단계 ${level}`)
      return {
        id,
        type: 'heading',
        props: { level: Math.min(6, Math.max(1, level)) },
        content: inlineToBn(ctx, `${at}.content`, block.content),
      }
    }

    case 'listItem': {
      // R34 판정 대기 — **흡수하지 않는다**(prop 추가 금지). 보고만 유지한다.
      if (block.spread !== undefined) {
        report(ctx, at, 'listItem:spread', '느슨한 목록(항목 사이 빈 줄)은 BlockNote가 구분하지 않습니다')
      }
      if (block.groupBreak) {
        report(ctx, at, 'listItem:groupBreak', '인접한 두 목록의 경계는 BlockNote가 구분하지 않습니다')
      }
      const content = inlineToBn(ctx, `${at}.content`, block.content)
      const children = blocksToBn(ctx, `${at}.children`, block.children)
      if (block.checked !== undefined) {
        if (block.ordered) {
          report(ctx, at, 'listItem:orderedChecked', '번호 목록의 체크박스는 BlockNote에 없습니다')
        }
        return { id, type: 'checkListItem', props: { checked: block.checked }, content, children }
      }
      if (block.ordered) {
        return {
          id,
          type: 'numberedListItem',
          props: block.start === undefined ? {} : { start: block.start },
          content,
          children,
        }
      }
      return { id, type: 'bulletListItem', content, children }
    }

    case 'quote': {
      // BlockNote quote는 **인라인 1줄 + 자식 블록** 구조다(앱 모델은 자식 블록만).
      // 첫 자식이 "내용 있는 문단"일 때만 그것을 quote의 인라인으로 끌어올린다 — 빈 문단·
      // 비문단 첫 자식은 그대로 자식으로 두어야 역변환이 원본을 복원한다(fromBlockNote 참조).
      const kids = block.children ?? []
      const first = kids[0]
      const hoist = first && first.type === 'paragraph' && first.content.length > 0
      // 끌어올려진 문단은 역변환에서 id `${quoteId}-p`로 되살아난다 — 사이드카도 그 키로 적어야
      // 복원된다(link:title·block:meta가 조용히 사라지는 자리).
      const content = hoist
        ? withKey(ctx, `${id}-p`, () => {
            if (first.meta) sidecarEntry(ctx).meta = first.meta
            return inlineToBn(ctx, `${at}.children[0].content`, first.content)
          })
        : []
      return {
        id,
        type: 'quote',
        content,
        children: blocksToBn(ctx, `${at}.children`, hoist ? kids.slice(1) : kids),
      }
    }

    case 'codeBlock':
      return {
        id,
        type: 'codeBlock',
        // 규약 E: 언어는 드롭다운 선택만 · 펜스 정보 문자열(info)은 **보존만** 하고 UI에 노출하지 않는다.
        props: { language: block.language ?? 'text', info: block.info ?? '' },
        content: block.code === '' ? [] : [{ type: 'text', text: block.code, styles: {} }],
      }

    case 'table': {
      const cols = block.rows.reduce((max, row) => Math.max(max, row.length), 0)
      const align = block.align ?? []
      if (align.some((value) => value !== null && value !== undefined)) {
        // R34 판정 대기 — 사이드카로 **왕복 보존은 하되** 보고는 유지한다(정렬 편집 UI는 M35).
        sidecarEntry(ctx).tableAlign = align.map((value) => value ?? null)
        report(ctx, at, 'table:align', '표 열 정렬은 편집 표면에 없습니다(값은 보존됩니다)')
      }
      return {
        id,
        type: 'table',
        content: {
          type: 'tableContent',
          columnWidths: new Array(cols).fill(undefined),
          // 앱 모델의 rows[0]은 언제나 헤더 행(GFM)이다.
          headerRows: 1,
          rows: block.rows.map((row, r) => ({
            cells: row.map((cell, c) => inlineToBn(ctx, `${at}.rows[${r}][${c}]`, cell)),
          })),
        },
      }
    }

    case 'image':
      // 규약 I 흡수 ③ — title·height는 내장 image 스펙에 **확장 prop**으로 실린다(편집 UI 없음).
      return {
        id,
        type: 'image',
        props: {
          url: block.url,
          caption: block.alt,
          ...(block.width === undefined ? {} : { previewWidth: block.width }),
          title: block.title ?? '',
          height: block.height ?? 0,
        },
      }

    case 'divider':
      return { id, type: 'divider' }

    case 'mathBlock':
      return {
        id,
        type: 'mathBlock',
        content: block.value === '' ? [] : [{ type: 'text', text: block.value, styles: {} }],
      }

    case 'callout':
      // variant는 **고정 목록 밖 값도 그대로 보존**한다(기존 데이터를 바꾸지 않는다 — 규약 E).
      // 자유 입력 UI가 없을 뿐이고, 어댑터가 값을 정규화하지는 않는다.
      return {
        id,
        type: 'callout',
        props: {
          variant: block.variant,
          title: block.title ?? '',
          attrs: encodeAttrPairs(block.attrs),
        },
        children: blocksToBn(ctx, `${at}.children`, block.children),
      }

    case 'docEmbed':
      return {
        id,
        type: 'docEmbed',
        props: { target: block.target, label: block.label ?? '' },
      }

    case 'sourceFallback':
      return {
        id,
        type: 'sourceFallback',
        props: { markdown: block.markdown, nodeType: block.nodeType },
      }

    default:
      report(ctx, at, 'block:unknown')
      return null
  }
}

/**
 * 앱 블록 문서 → BlockNote 블록 JSON.
 *
 * 반환값의 `blocks`는 **`unsupported`가 빈 배열일 때만** 편집 표면에 올려도 된다.
 * `sidecar`는 편집 세션 동안 화면이 들고 있다가 저장할 때 `fromBlockNoteBlocks(blocks, sidecar)`로
 * 되돌려 주어야 흡수분(링크 제목·블록 메타·표 정렬)이 복원된다.
 */
export function toBlockNoteBlocks(doc: BlockDocument | null | undefined): ToBlockNoteResult {
  const ctx: Ctx = { issues: [], sidecar: {}, key: '' }
  const blocks = blocksToBn(ctx, 'blocks', doc?.blocks)
  return { blocks, unsupported: ctx.issues, sidecar: ctx.sidecar }
}

/** 미지원 사유를 사람이 읽는 한 줄로 — 화면 안내 문구용(중복 제거·최대 3종). */
export function describeUnsupported(issues: AdapterIssue[]): string {
  const seen: string[] = []
  for (const issue of issues) {
    const text = issue.detail ?? issue.kind
    if (!seen.includes(text)) seen.push(text)
  }
  const head = seen.slice(0, 3).join(' · ')
  return seen.length > 3 ? `${head} 외 ${seen.length - 3}종` : head
}
