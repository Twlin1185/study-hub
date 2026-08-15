// 앱 중립 블록 → BlockNote 블록 JSON (M33 / stage-33 F-3 · 규약 B)
//
// **순수 JSON 변환**이다 — 에디터 인스턴스도, `@blocknote/*` import도 없다.
// 코어 범위(stage-33): paragraph · heading(1~6) · listItem 3종(중첩) · quote · codeBlock ·
// table · image · divider + 인라인(bold·italic·strike·underline·inlineCode·link·줄바꿈).
//
// **손실 0 계약**: 옮길 수 없는 것을 만나면 **조용히 버리지 않고** `unsupported`에 보고한다.
// 방언(형광펜·스포일러·:t·콜아웃·수식·참조 칩·임베드·sourceFallback)은 stage-34에서 커스텀
// 스펙으로 이식되며, 그 전까지 그런 노트는 편집 표면에 올리지 않는다(읽기 전용 폴백 — F-8).
//
// 코어 문법인데도 BlockNote 코어가 담을 곳이 없어 미지원으로 보고하는 항목(실측):
//   · link의 `title`     — BlockNote Link는 `href`/`content`뿐이다
//   · image의 `title`/`height`
//   · listItem의 `spread`(느슨한 목록) / `groupBreak`(인접 목록 경계) — 평평한 목록 모델에 없다
//   · table의 열 정렬(`align`) — 셀 정렬 prop은 우리가 스키마에서 제거했다(불변 규칙 5: BlockNote
//     기본 색·정렬 UI는 하드코딩 색 팔레트를 끌고 들어온다)
//   · hardBreak — BlockNote의 줄바꿈은 1종(`\n`)뿐이라 soft/hard 구분을 담지 못한다.
//     BlockNote가 만든 줄바꿈은 **softBreak로 읽는다**(`fromBlockNote`) — 왕복 대칭을 위해
//     한쪽만 택한 결과이며, 노트는 BlockNote가 만드는 문서라 실사용에서 hardBreak는 생기지 않는다.
//   · 블록 `meta`(provenance 예약 필드)
import type { Block, BlockDocument, InlineNode, InlineStyles } from '../schema/blocks'
import type {
  AdapterIssue,
  BnBlock,
  BnInline,
  BnStyledText,
  BnStyles,
  ToBlockNoteResult,
} from './types'

interface Ctx {
  issues: AdapterIssue[]
}

function report(ctx: Ctx, path: string, kind: string, detail?: string) {
  ctx.issues.push(detail === undefined ? { path, kind } : { path, kind, detail })
}

// ---------------------------------------------------------------- 인라인

function mapStyles(ctx: Ctx, path: string, styles: InlineStyles | undefined, extra?: BnStyles): BnStyles {
  const out: BnStyles = { ...extra }
  if (!styles) return out
  if (styles.bold) out.bold = true
  if (styles.italic) out.italic = true
  if (styles.strike) out.strike = true
  if (styles.underline) out.underline = true
  if (styles.highlight) report(ctx, path, 'style:highlight', '형광펜(==)은 stage-34 범위입니다')
  if (styles.spoiler) report(ctx, path, 'style:spoiler', '스포일러(||)는 stage-34 범위입니다')
  if (styles.t) report(ctx, path, 'style:t', '글자색/바탕색/크기(:t)는 stage-34 범위입니다')
  return out
}

/** 인라인 배열 → BlockNote 인라인. 줄바꿈은 텍스트 안 `\n`으로 접힌다. */
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
        pushText(node.text, mapStyles(ctx, at, node.styles))
        break
      case 'inlineCode':
        pushText(node.value, mapStyles(ctx, at, node.styles, { code: true }))
        break
      case 'softBreak':
        pushText('\n', mapStyles(ctx, at, node.styles))
        break
      case 'hardBreak':
        report(ctx, at, 'inline:hardBreak', '경성 줄바꿈은 BlockNote 줄바꿈 1종으로 구분되지 않습니다')
        break
      case 'link': {
        if (node.title !== undefined) {
          report(ctx, at, 'link:title', '링크 제목(title)은 BlockNote 링크가 담지 못합니다')
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
        report(ctx, at, 'inline:inlineMath', '인라인 수식은 stage-34 범위입니다')
        break
      case 'refChip':
        report(ctx, at, 'inline:refChip', '참조 칩은 stage-34 범위입니다')
        break
      case 'inlineImage':
        report(ctx, at, 'inline:inlineImage', '문단 안 이미지는 stage-34 범위입니다')
        break
      case 'inlineFallback':
        report(ctx, at, 'inline:inlineFallback', '원문 보존 인라인은 stage-34 범위입니다')
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
    !!a.code === !!b.code
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

function blockToBn(ctx: Ctx, at: string, block: Block): BnBlock | null {
  if (block.meta) report(ctx, at, 'block:meta', '블록 메타(provenance)는 아직 편집 표면에 없습니다')
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
      return {
        id,
        type: 'quote',
        content: hoist ? inlineToBn(ctx, `${at}.children[0].content`, first.content) : [],
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
      for (const align of block.align ?? []) {
        if (align !== null && align !== undefined) {
          report(ctx, at, 'table:align', '표 열 정렬은 stage-33 편집 표면에 없습니다')
          break
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

    case 'image': {
      if (block.title !== undefined) report(ctx, at, 'image:title', '이미지 제목(title)은 BlockNote가 담지 못합니다')
      if (block.height !== undefined) report(ctx, at, 'image:height', '이미지 높이 지정은 지원하지 않습니다')
      return {
        id,
        type: 'image',
        props:
          block.width === undefined
            ? { url: block.url, caption: block.alt }
            : { url: block.url, caption: block.alt, previewWidth: block.width },
      }
    }

    case 'divider':
      return { id, type: 'divider' }

    case 'mathBlock':
      report(ctx, at, 'block:mathBlock', '수식 블록은 stage-34 범위입니다')
      return null

    case 'callout':
      report(ctx, at, 'block:callout', '콜아웃은 stage-34 범위입니다')
      return null

    case 'docEmbed':
      report(ctx, at, 'block:docEmbed', '문서 임베드는 stage-34 범위입니다')
      return null

    case 'sourceFallback':
      report(ctx, at, 'block:sourceFallback', '원문 보존 블록은 stage-34 범위입니다')
      return null

    default:
      report(ctx, at, 'block:unknown')
      return null
  }
}

/**
 * 앱 블록 문서 → BlockNote 블록 JSON.
 *
 * 반환값의 `blocks`는 **`unsupported`가 빈 배열일 때만** 편집 표면에 올려도 된다.
 * 비어 있지 않으면 그 노트에는 아직 이식하지 않은 서식이 있다는 뜻이며, 화면은 읽기 전용
 * 미리보기로 폴백해야 한다(덮어쓰기 사고 0 — stage-33 F-8).
 */
export function toBlockNoteBlocks(doc: BlockDocument | null | undefined): ToBlockNoteResult {
  const ctx: Ctx = { issues: [] }
  const blocks = blocksToBn(ctx, 'blocks', doc?.blocks)
  return { blocks, unsupported: ctx.issues }
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
