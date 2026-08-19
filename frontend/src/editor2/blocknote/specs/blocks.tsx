// 방언 **커스텀 블록 스펙 3종**(stage-34 G-3) — 콜아웃 · 문서 임베드 · 원문 보존.
//
// 색은 **기존 토큰만** 재사용한다(`--accent`·`--warning`·`--correct`·`--border` 계열 — F52 신규 토큰 0,
// 불변 규칙 5). 콜아웃 본문은 BlockNote **children**으로 담기므로(앱 `CalloutBlock.children`과 1:1)
// 여기 render는 머리(라벨)와 테두리만 그리고, 자식 블록은 편집기가 중첩 그룹으로 렌더한다
// (`notes.css`가 그 그룹에 콜아웃 여백을 준다).
import { createReactBlockSpec } from '@blocknote/react'
import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { CALLOUT_VARIANTS } from '../../adapter'
import { describeRef, useRefUi } from '../refPicker/RefTitleContext'
import DocEmbedReadCard from './DocEmbedReadCard'

/** 콜아웃 **고정 목록**(규약 E — 자유 입력 UI 금지). 목록 밖 값은 **보존만** 하고 기본 스타일로 표시한다. */
const CALLOUT_STYLE: Record<string, { border: string; text: string; icon: string; label: string }> = {
  note: { border: 'border-l-accent', text: 'text-accent', icon: 'ℹ', label: '참고' },
  warn: { border: 'border-l-warning', text: 'text-warning', icon: '⚠', label: '주의' },
  tip: { border: 'border-l-correct', text: 'text-correct', icon: '💡', label: '팁' },
  fold: { border: 'border-l-border', text: 'text-muted', icon: '▸', label: '더 보기' },
  hide: { border: 'border-l-border', text: 'text-muted', icon: '▪', label: '숨김' },
}

const CALLOUT_FALLBACK = { border: 'border-l-border', text: 'text-muted', icon: '▪', label: '' }

export const createCalloutBlockSpec = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: {
      // 값 화이트리스트를 **강제하지 않는다** — 목록 밖 variant를 가진 기존 데이터(`:::노트[…]`)를
      // 그대로 보존해야 하기 때문이다(값을 바꾸지 않는 것이 계약). 입력 UI만 고정 목록으로 좁힌다.
      variant: { default: 'note' as string },
      title: { default: '' as string },
      // `{key=value}` 속성 쌍 통짜 보존 = JSON.stringify(AttrPair[]) — `:t`와 같은 이유(미지 키·중복
      // 키·순서까지 보존). 자유 편집 UI는 만들지 않는다(규약 E).
      attrs: { default: '' as string },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const variant = block.props.variant
      const style = CALLOUT_STYLE[variant] ?? CALLOUT_FALLBACK
      return (
        <div
          className={`my-1 w-full rounded-lg border border-border border-l-4 ${style.border} bg-surface-raised px-3 py-2`}
        >
          <p className={`flex items-center gap-1.5 text-sm font-medium ${style.text}`}>
            <span aria-hidden>{style.icon}</span>
            <span>{block.props.title || style.label || variant}</span>
          </p>
        </div>
      )
    },
  },
)

// ---------------------------------------------------------------- 문서 임베드(`![[DOC-0007]]`)
//
// 머리글은 원자·제목 추종 칩(기존 그대로) — 클릭하면 참조 칩과 **같은 규칙**의 팝오버가 열린다
// (`describeRef`·`RefUiContext` 공유). **펼치기(stage-36 규약 D)**를 누르면 그 아래에 대상 문서
// 본문을 읽기 전용 카드로 편다(`DocEmbedReadCard` — resolve-embeds 재사용·MarkdownView 재사용).
// 기본은 **접힘**(편집 중 여러 임베드가 쌓여도 본문 조회가 한꺼번에 나가지 않도록).
export const createDocEmbedBlockSpec = createReactBlockSpec(
  {
    type: 'docEmbed',
    propSchema: {
      target: { default: '' as string },
      label: { default: '' as string },
    },
    content: 'none',
  },
  {
    render: function DocEmbedRender({ block, editor }) {
      const { target, label } = block.props
      const refUi = useRefUi()
      const [expanded, setExpanded] = useState(false)

      useEffect(() => {
        if (!label) refUi.requestTitle(target)
      }, [label, refUi, target])

      const display = describeRef('embed', target, label, refUi.getTitle(target))

      const openMenu = (event: MouseEvent<HTMLElement>) => {
        if (!refUi.enabled) return
        event.preventDefault()
        event.stopPropagation()
        refUi.openChipMenu({
          rect: event.currentTarget.getBoundingClientRect(),
          refType: 'embed',
          target,
          label,
          update: (next) =>
            editor.updateBlock(block, {
              type: 'docEmbed',
              props: { target: next.target ?? target, label: next.label ?? label },
            }),
          remove: () => editor.removeBlocks([block]),
        })
      }

      const toggle = (event: MouseEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
        setExpanded((v) => !v)
      }

      return (
        <div className="my-1 w-full rounded-lg border border-dashed border-border bg-surface-raised text-sm">
          <div
            onClick={openMenu}
            className="flex cursor-pointer items-center gap-2 px-3 py-2"
            title={display.title}
          >
            <span aria-hidden className="text-muted">
              ⧉
            </span>
            <span className="shrink-0 font-medium text-accent">{target}</span>
            <span className={`truncate ${display.placeholder ? 'text-muted' : 'text-primary'}`}>
              {display.text === target ? '' : display.text}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted">문서 임베드</span>
            {target && (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={expanded}
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-primary hover:bg-bg"
              >
                {expanded ? '접기' : '펼치기'}
              </button>
            )}
          </div>
          {expanded && target && (
            <div className="border-t border-border px-2 pb-2 pt-1">
              <DocEmbedReadCard target={target} alias={label} />
            </div>
          )}
        </div>
      )
    },
  },
)

// ---------------------------------------------------------------- 원문 보존 블록(규약 D)
//
// 팔레트 밖 mdast 노드(원시 html·각주 정의·leaf directive 등)의 **원문 Markdown을 그대로** 들고 있다.
// **편집 불가·삭제만 가능** — 투영이 원문 그대로라 왕복이 자명하게 성립하고, M34 지연 마이그레이션의
// 안전망이 된다. 편집 가능하게 만들면 그 계약이 깨지므로 content는 `'none'`이다.
export const createSourceFallbackBlockSpec = createReactBlockSpec(
  {
    type: 'sourceFallback',
    propSchema: {
      markdown: { default: '' as string },
      nodeType: { default: '' as string },
    },
    content: 'none',
  },
  {
    render: ({ block }) => (
      <div className="my-1 w-full rounded-lg border border-dashed border-border bg-bg px-3 py-2">
        <p className="text-xs text-muted">
          원문 보존{block.props.nodeType ? ` — ${block.props.nodeType}` : ''} (편집할 수 없습니다)
        </p>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[0.85em] text-primary">
          {block.props.markdown}
        </pre>
      </div>
    ),
  },
)

/** 고정 목록 재수출 — 툴바·슬래시 메뉴(Phase 2·M35)가 같은 목록을 쓰게 한다. */
export { CALLOUT_VARIANTS }
