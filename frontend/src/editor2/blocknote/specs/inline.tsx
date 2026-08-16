// 방언 **인라인 콘텐츠 스펙**(stage-34 G-4 스펙 부분 · G-6 · 규약 I 흡수 ①) — 전부 원자
// (`content: 'none'`): 내부 편집 불가, 한 단위로 삭제·이동. PoC `refChipSpec` 패턴의 복제다.
//
// 이 Phase는 **렌더만** 만든다 — 참조 칩 피커·팝오버 UX, 이미지 삽입 진입점, 붙여넣기 파이프라인은
// 전부 Phase 2 담당이다(여기서 만들지 않는다).
//
// **`styles` prop**: BlockNote는 커스텀 인라인 노드에 걸린 mark를 되읽을 때 버린다(`nodeToInlineContent`
// 실측). 그래서 `**굵게 [[DOC-0012]] 안쪽**`·`:t[색 있는 [[DOC-0003]] 칩]{c=blue}` 같은 표본의 서식은
// 어댑터가 prop(JSON)으로 실어 보내고, 여기서 그 값을 읽어 칠한다(어댑터 `types.ts` 주석 참조).
import { createReactInlineContentSpec } from '@blocknote/react'
import { useEffect } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { describeRef, useRefUi } from '../refPicker/RefTitleContext'
import type { RefKind } from '../refPicker/RefTitleContext'
import { decodeTextStylePairs, textStyleClasses } from './styles'
import { interpretTextStyle } from '../../schema/blocks'
import {
  HEX_INK_VAR,
  HEX_MARK_VAR,
  PRINT_COLOR_EXACT_CLASS,
  isHexColor,
} from '../../../components/markdown/palette'

/** 어댑터가 실어 보내는 원자 서식 prop의 형태(= BlockNote 스타일 집합의 JSON). */
interface AtomStyles {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
  highlight?: true
  spoiler?: true
  t?: string
}

function decodeAtomStyles(value: string | undefined): AtomStyles {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as AtomStyles) : {}
  } catch {
    return {}
  }
}

/** 원자에 걸린 서식을 클래스·커스텀 프로퍼티로 옮긴다(색은 전부 토큰 경유). */
function atomStyleAttrs(value: string | undefined): { className: string; style?: CSSProperties } {
  const styles = decodeAtomStyles(value)
  const classes: string[] = []
  if (styles.bold) classes.push('font-bold')
  if (styles.italic) classes.push('italic')
  if (styles.underline) classes.push('underline')
  if (styles.strike) classes.push('line-through')
  if (styles.highlight) classes.push('bg-mark-yellow', 'rounded', 'px-0.5', PRINT_COLOR_EXACT_CLASS)
  const pairs = decodeTextStylePairs(styles.t)
  classes.push(...textStyleClasses(pairs))
  const view = interpretTextStyle(pairs)
  const custom: Record<string, string> = {}
  if (view.ink && isHexColor(view.ink)) custom[HEX_INK_VAR] = view.ink
  if (view.bg && isHexColor(view.bg)) custom[HEX_MARK_VAR] = view.bg
  return {
    className: classes.join(' '),
    style: Object.keys(custom).length > 0 ? (custom as CSSProperties) : undefined,
  }
}

/** 원자 공통 껍데기 — 서식 prop을 반영하고 선택 하이라이트가 한 단위로 걸리게 한다. */
function Atom({
  styles,
  className,
  title,
  onClick,
  children,
}: {
  styles: string | undefined
  className: string
  title?: string
  onClick?: (event: MouseEvent<HTMLElement>) => void
  children: ReactNode
}) {
  const attrs = atomStyleAttrs(styles)
  return (
    <span
      className={`${className} ${attrs.className}`.trim()}
      style={attrs.style}
      title={title}
      onClick={onClick}
      data-editor2-atom
    >
      {children}
    </span>
  )
}

const CHIP_BASE =
  'mx-0.5 inline-flex max-w-full items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 align-baseline text-[0.85em] leading-tight'

const REF_MARK: Record<string, string> = {
  doc: '🔗',
  anchor: '#',
  embed: '⧉',
}

// ---------------------------------------------------------------- 참조 칩(F43 · 규약 A ③)
//
// `label: ''` ⇔ 앱 `label === undefined`(**추종형** — 대상 문서 제목을 따라간다). 제목은 칩이 직접
// 조회하지 않고 `RefUiContext`에 **등록만** 한다 — 공급자가 `resolve-embeds` 배치 1회로 해석한다
// (N+1 금지 · §4.19). 해석 전에는 대상 식별자를 그대로 보여 주고(깜빡임 방지), 미해결·삭제 문서는
// 자리표시자 문구로 바뀐다(문구의 단일 출처 = `describeRef`).
//
// 클릭은 **라우팅이 아니라 팝오버**다(규약 A ③) — 편집 중 클릭이 곧바로 문서로 튀면 편집 흐름이
// 끊긴다. 팝오버가 필요로 하는 "이 칩을 갱신·삭제하는 법"은 칩만 알기 때문에 여기서 콜백으로 싣는다.
export const refChipInlineSpec = createReactInlineContentSpec(
  {
    type: 'refChip',
    propSchema: {
      refType: { default: 'doc' as string, values: ['doc', 'anchor', 'embed'] as const },
      target: { default: '' as string },
      label: { default: '' as string },
      styles: { default: '' as string },
    },
    content: 'none',
  },
  {
    render: function RefChipRender({ inlineContent, updateInlineContent, editor, node, getPos }) {
      const { refType, target, label, styles } = inlineContent.props
      const kind: RefKind = refType === 'anchor' || refType === 'embed' ? refType : 'doc'
      const refUi = useRefUi()

      useEffect(() => {
        // 추종형(라벨 없음) 문서 참조만 제목이 필요하다 — 앵커는 대상이 곧 제목이다.
        if (!label && kind !== 'anchor') refUi.requestTitle(target)
      }, [kind, label, refUi, target])

      const display = describeRef(kind, target, label, refUi.getTitle(target))

      const openMenu = (event: MouseEvent<HTMLElement>) => {
        if (!refUi.enabled) return
        event.preventDefault()
        event.stopPropagation()
        refUi.openChipMenu({
          rect: event.currentTarget.getBoundingClientRect(),
          refType: kind,
          target,
          label,
          update: (next) =>
            updateInlineContent({
              type: 'refChip',
              props: {
                refType: kind,
                target: next.target ?? target,
                label: next.label ?? label,
                styles,
              },
            }),
          remove: () => {
            const pos = getPos()
            if (typeof pos === 'number') editor.transact((tr) => tr.delete(pos, pos + node.nodeSize))
          },
        })
      }

      return (
        <Atom
          styles={styles}
          className={`${CHIP_BASE} cursor-pointer ${display.placeholder ? 'border-dashed text-muted' : 'text-accent'}`}
          title={display.title}
          onClick={openMenu}
        >
          <span aria-hidden className="shrink-0 text-muted">
            {REF_MARK[kind] ?? REF_MARK.doc}
          </span>
          <span className="truncate">{display.text}</span>
        </Atom>
      )
    },
  },
)

// ---------------------------------------------------------------- 문단 안 이미지(규약 D)
//
// **보존·표시·삭제 전용**이다 — 새로 삽입하는 UI를 만들지 않는다. 문단이 쪼개지면 왕복이 깨지므로
// 블록으로 승격하지도 않는다(앱 스키마 `ImageInline` 주석 참조).
export const inlineImageSpec = createReactInlineContentSpec(
  {
    type: 'inlineImage',
    propSchema: {
      url: { default: '' as string },
      alt: { default: '' as string },
      // `''` ⇔ undefined · `0` ⇔ undefined (왕복 보존용 — 편집 UI 없음)
      title: { default: '' as string },
      width: { default: 0 },
      height: { default: 0 },
      styles: { default: '' as string },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => {
      const { url, alt, title, width, height, styles } = inlineContent.props
      return (
        <Atom styles={styles} className="mx-0.5 inline-block align-baseline" title={title || alt || url}>
          <img
            src={url}
            alt={alt}
            className="inline-block max-w-full rounded border border-border align-baseline"
            style={{
              width: width > 0 ? `${width}px` : undefined,
              height: height > 0 ? `${height}px` : undefined,
            }}
          />
        </Atom>
      )
    },
  },
)

// ---------------------------------------------------------------- 원문 보존 인라인(규약 D의 인라인 짝)
//
// 팔레트 밖 인라인 mdast 노드(원시 html·각주 참조·참조식 링크 등)의 원문 슬라이스를 **읽기 전용**
// 으로 보존·표시한다(코드 느낌의 중립 표기 — "여기 손대면 안 되는 원문"임을 눈으로 알린다).
export const inlineFallbackSpec = createReactInlineContentSpec(
  {
    type: 'inlineFallback',
    propSchema: {
      markdown: { default: '' as string },
      nodeType: { default: '' as string },
      styles: { default: '' as string },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => {
      const { markdown, nodeType, styles } = inlineContent.props
      return (
        <Atom
          styles={styles}
          className="mx-0.5 rounded border border-dashed border-border bg-bg px-1 align-baseline font-mono text-[0.85em] text-muted"
          title={`원문 보존(${nodeType || '알 수 없음'}) — 편집할 수 없습니다`}
        >
          {markdown}
        </Atom>
      )
    },
  },
)

// ---------------------------------------------------------------- 경성 줄바꿈(규약 I 흡수 ①)
//
// 타입 이름이 `hardBreak`가 **아닌** 이유: BlockNote 코어 PM 스키마에 이미 `hardBreak` 노드가 있고
// `nodeToInlineContent`가 그 이름을 만나면 무조건 `\n`(= 앱 모델의 softBreak)으로 접어 버린다.
// 이름이 겹치면 우리 원자가 되읽기에서 사라지므로 편집기 표현만 `lineBreak`로 둔다.
export const lineBreakSpec = createReactInlineContentSpec(
  {
    type: 'lineBreak',
    propSchema: { styles: { default: '' as string } },
    content: 'none',
  },
  {
    render: () => (
      <span data-editor2-atom title="줄바꿈">
        <br />
      </span>
    ),
  },
)
