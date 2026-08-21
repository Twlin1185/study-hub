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
//   ┌ 흡수 7종(보고가 사라졌다 — 아래 방식으로 왕복 보존한다)
//   │  · `inline:hardBreak` → 원자 인라인 `lineBreak`(BlockNote 코어 `hardBreak` 노드와 이름 충돌
//   │     회피 — 코어는 그 이름을 만나면 `\n`으로 접어 버린다)
//   │  · `link:title`       → **사이드카**(블록 id → href → title). 링크 노드에 자리가 없다.
//   │  · `image:title`/`image:height` → 내장 image 스펙 **prop 확장**(codeBlock `info` 전례)
//   │  · `block:meta`       → **사이드카**(provenance 예약 필드 — 편집 표면에 올릴 자리가 없다)
//   │  ┈ 아래 3종은 **R34 판정 완료**(2026-08-17 — 사용자 위임 → "손실 수용하지 않는다.
//   │    사이드카로 흡수한다"로 확정). 실측 근거: 실문서 224건 중 3건(1.3%)이 `listItem:spread`
//   │    **단독** 사유로 읽기 전용 폴백에 떨어지고 있었고, 전부 기출 풀이의 물음 목록처럼
//   │    사용자가 자연스럽게 쓰는 서식이었다(계속 재발한다). 흡수 기반은 이미 있었다.
//   │  · `listItem:spread`     → **사이드카**(항목별로 적되 **런 단위로 복원** — 느슨함은
//   │     CommonMark에서 항목이 아니라 목록의 성질이다. `fromBlockNote.restoreListGroups` 참조)
//   │  · `listItem:groupBreak` → **사이드카**(그 항목이 새 목록의 시작임을 표시. 앞 형제가 같은
//   │     종류의 목록 항목일 때만 복원한다 — 조건이 깨지면 경계 자체가 사라진 것이다)
//   │  · `table:align`         → **사이드카**. 값이 왕복하므로 보고하지 않는다. 정렬 **편집 UI**는
//   │     여전히 M35 범위지만, UI가 없다고 문서를 통째로 읽기 전용에 떨어뜨리지는 않는다.
//   │     보고는 **복원 조건이 깨진 경우**(align 길이 ≠ 열 수)에만 남는다.
//   └
//   구조적 사유: `link:nested` · `listItem:orderedChecked` · `heading:level` ·
//   `inline:mathStyles`(채택한 math 스펙의 propSchema가 비어 서식을 실을 자리가 없다) ·
//   `inline:unknown` · `block:unknown`
import type {
  AttrPair,
  Block,
  BlockDocument,
  InlineNode,
  InlineStyles,
  WebEmbedBlock,
} from '../schema/blocks'
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

/**
 * 웹 임베드 메타(§4.30 캐시 + 공통 provenance) → prop 문자열. `''` ⇔ `undefined`.
 * 빈 객체(`{}`)는 `'{}'`로 남겨 **"메타 없음"과 구분**한다(왕복에서 키 유무가 그대로 살아난다).
 */
function encodeWebEmbedMeta(meta: WebEmbedBlock['meta']): string {
  return meta === undefined ? '' : JSON.stringify(meta)
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
  // **예외 = webEmbed**(stage-37 F-2): 이 블록의 meta는 §4.30 캐시까지 담는 **자기 prop**이라
  // 사이드카를 거치지 않는다(사이드카 불요 — 편집 세션이 사이드카를 흘려도 캐시가 살아남는다).
  if (block.meta && block.type !== 'webEmbed') sidecarEntry(ctx).meta = block.meta
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
      // 규약 I 흡수 ⑤·⑥(R34 판정 완료 2026-08-17) — 평평한 목록 모델에는 자리가 없고 prop 추가도
      // 금지이므로 **사이드카**로 왕복 보존한다. 값은 항목별로 적지만 `spread`의 **복원은 런 단위**다
      // (fromBlockNote.restoreListGroups). 보고는 사라진다 — 손실이 없기 때문이다.
      if (block.spread !== undefined) sidecarEntry(ctx).listSpread = block.spread
      if (block.groupBreak) sidecarEntry(ctx).listGroupBreak = true
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
        // 규약 I 흡수 ⑦(R34 판정 완료 2026-08-17) — 사이드카로 왕복 보존한다.
        sidecarEntry(ctx).tableAlign = align.map((value) => value ?? null)
        // 보고는 **역변환의 복원 조건과 같은 판정**으로만 남긴다: fromBlockNote는 `saved.length === cols`
        // 일 때만 정렬을 되살리므로, 여기서 이미 길이가 어긋나 있으면 왕복이 성립하지 않는다.
        // (편집 중 열이 증감하는 경우는 역변환 쪽에서 같은 조건으로 버린다 — 그때는 사용자가 스스로
        //  구조를 바꾼 것이라 원본 정렬을 되살릴 근거가 없다.)
        if (align.length !== cols) {
          report(ctx, at, 'table:align', '표의 열 수와 정렬 정보가 어긋나 정렬을 되살릴 수 없습니다')
        }
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

    case 'toc':
      // 원자 + prop 0 — 옮길 값이 없다(목차는 렌더 시점 파생이다).
      return { id, type: 'toc' }

    case 'webEmbed':
      return {
        id,
        type: 'webEmbed',
        props: {
          url: block.url,
          // `''` ⇔ undefined(규약 C 전례). 메타는 통짜 JSON — prop 하나로 완전 왕복한다.
          title: block.title ?? '',
          meta: encodeWebEmbedMeta(block.meta),
        },
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
 * 되돌려 주어야 흡수분(링크 제목·블록 메타·표 정렬·느슨한 목록·목록 그룹 경계)이 복원된다.
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
