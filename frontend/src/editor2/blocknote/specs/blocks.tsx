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
import { unwrapColumns } from '../refPicker/insert'
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

// ---------------------------------------------------------------- 다단(columns · stage-41 규약 A)
//
// 흐름형 CSS 다단(Word 스타일 단 — Notion 고정 열이 아니다) — 컨테이너 블록(`content: 'none'`)이고
// **자식 블록이 내용**이다(콜아웃과 같은 구조 — 자식은 BlockNote 중첩 그룹(`.bn-block-group`)으로
// 렌더되고, `notes.css`가 그 그룹에 `column-count`를 준다). 여기 render는 머리의 **얇은 컨트롤
// 띠**(2단/3단 토글 + [단 해제])만 그린다 — 자식 내용은 엔진이 그대로 그린다.
//
// **`count` 클램프(착수 전 결정 ②)**: 유입 데이터의 범위 밖 값(4 이상·2 미만)은 prop 값 자체는
// **보존**하고 표시만 3단 상한/1단으로 강등한다. 엔진은 prop 값이 기본과 다르면 그 값 그대로
// `data-count`로 싣는데(`BlockContentWrapper` 실측 — 값 화이트리스트 없음), CSS 속성 선택자로는
// 임의 정수를 다 열거할 수 없다. 그래서 클램프된 값을 render가 **자기 렌더 루트에 선언적 속성**
// (`data-columns-view`)으로 낸다 — `notes.css`가 `:has(> [data-columns-view=…])`로 형제인
// `.bn-block-group`을 잡는다.
//
// **브라우저 실측 결함(치명, 수정 완료)**: 처음에는 `useEffect`로 `closest('.bn-block')`(PM이
// 관리하는 blockContainer DOM)에 `style.setProperty('--columns-count', …)`를 직접 얹었는데,
// PM DOMObserver가 그 변이를 외부 DOM 변경으로 읽어 `markDirty → updateState`(재그리기) → 노드뷰
// 재마운트 → 이펙트 재실행 → 재변이 … 로 마이크로태스크 무한 루프에 빠져 탭이 완전히 멎었다(콜아웃
// `+ .bn-block-group` 형제 선택자 전례를 CSS 커스텀 프로퍼티로 확장하려던 시도였으나, **PM 관리
// DOM을 명령형으로 건드리는 것 자체가 원인**이었다 — R33 "엔진 내부 패치 금지"의 실전 사례). 지금은
// PM DOM에 손대지 않는다 — 값은 React 렌더 트리 안의 속성 하나뿐이라 tiptap ReactNodeView의
// `ignoreMutation`이 그 서브트리 변화를 무시한다.
const clampColumnsCount = (raw: unknown): 1 | 2 | 3 => {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 2
  if (n < 2) return 1
  if (n > 3) return 3
  return n === 3 ? 3 : 2
}

/**
 * 빈 컨테이너 정리(규약 B 계약 — "빈 columns가 저장되는 경로 0").
 *
 * 렌더 기반 감지만으로는 불충분하다: 자식 그룹(`.bn-block-group`)은 columns 블록 자신과 **형제**인
 * PM 노드라, 마지막 자식이 지워져도 이 블록의 리액트 노드뷰는 갱신 신호를 받지 않는다
 * (`@blocknote/react`의 `useNodeViewBlock`이 `getPos()` 기준으로 자기 노드만 다시 읽는다 — 형제
 * 서브트리가 사라진 것은 이 노드 자체의 변경이 아니므로 tiptap이 update()를 호출하지 않는다. 실측).
 * 그래서 **편집기 전체의 변경 이벤트**(`editor.onChange`)를 한 번만 구독해 두고(에디터 인스턴스당
 * 1개 — 안 그러면 columns 블록이 여러 개일 때 각자 지우려다 두 번째부터 "이미 없는 블록" 에러가
 * 난다), 매 변경 후 문서를 훑어 자식 0인 columns를 찾아 통째로 지운다(재진입 dispatch를 피하려고
 * 한 틱 미룬 뒤 `getBlock`으로 재확인 — 아래 구현 참고). 최초 로드 시점에 이미 빈 채로 들어온
 * 경우(예: 유입 데이터)는 **자기 마운트 시점에 스스로 지우지 않는다**(브라우저 실측 결함 —
 * `view.updateState`가 노드뷰를 만드는 도중 같은 이펙트에서 `removeBlocks`를 부르면 중첩 dispatch가
 * 될 수 있었다) — 대신 **첫 편집**에서 이 onChange 정리가 걷어낸다.
 */
const columnsCleanupRegistered = new WeakSet<object>()
function ensureColumnsEmptyCleanup(editor: any): void {
  if (columnsCleanupRegistered.has(editor)) return
  columnsCleanupRegistered.add(editor)
  editor.onChange((ed: any) => {
    const empties: string[] = []
    const walk = (blocks: any[]) => {
      for (const b of blocks) {
        if (b.type === 'columns' && (!b.children || b.children.length === 0)) {
          empties.push(b.id)
        } else if (b.children?.length) {
          walk(b.children)
        }
      }
    }
    walk(ed.document)
    if (empties.length === 0) return
    // 재진입 dispatch 방지(브라우저 실측 결함과 같은 계열 — 이 콜백은 `onChange`라 트랜잭션이 이미
    // 끝난 뒤 실행되지만, 그래도 `view.updateState`의 같은 흐름 안일 여지를 없애려고 다음 태스크로
    // 한 틱 미룬다. 실행 시점에 그 사이 다른 편집으로 이미 사라졌거나 더 이상 비어 있지 않은 id는
    // `getBlock`으로 재확인해 건너뛴다 — 없는 id로 `removeBlocks`를 부르면 던진다).
    setTimeout(() => {
      const stillEmpty = empties.filter((id) => {
        const b = ed.getBlock(id)
        return b && b.type === 'columns' && (!b.children || b.children.length === 0)
      })
      if (stillEmpty.length > 0) ed.removeBlocks(stillEmpty)
    }, 0)
  })
}

/**
 * 단 수 토글 시 `meta` 주머니의 `attrs`에서 `n` 쌍을 떼어 낸다(검토 경-1 · 2026-08-30). 유입 원문이
 * 정수가 아닌 `n`(`n=abc`·`n=2.5`)이면 파서가 그 쌍을 `attrs`에 통짜 보존하고, 직렬화는 "attrs에 `n`이
 * 있으면 count 파생 `n`을 붙이지 않는다"(`blocksToMarkdown` — 원문 왕복 우선). 그대로 두면 사용자가
 * 2↔3을 바꿔도 저장 결과가 원문 `n=abc`로 돌아가 **조용히 무효화**된다. 사용자가 단 수를 명시적으로
 * 골랐으니 이제 count가 정본 — 원문 `n`은 여기서만 버린다(다른 미지 쌍·provenance는 그대로).
 * 깨진 JSON은 손대지 않고 되돌려 준다(어댑터의 관대한 복원 관례).
 */
function columnsMetaWithoutN(meta: string | undefined): string {
  if (!meta) return ''
  let bag: unknown
  try {
    bag = JSON.parse(meta)
  } catch {
    return meta
  }
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return meta
  const rec = bag as { attrs?: unknown }
  if (!Array.isArray(rec.attrs)) return meta
  const attrs = rec.attrs.filter((pair) => !(Array.isArray(pair) && pair[0] === 'n'))
  const out: Record<string, unknown> = { ...rec }
  if (attrs.length > 0) out.attrs = attrs
  else delete out.attrs
  return Object.keys(out).length === 0 ? '' : JSON.stringify(out)
}

export const createColumnsBlockSpec = createReactBlockSpec(
  {
    type: 'columns',
    propSchema: {
      count: { default: 2 },
      // 콜아웃 `attrs`와 같은 역할(위 참조) — `{key=value}` 속성 쌍 통짜 보존. 어댑터가 채우고
      // 스펙은 보존만 한다(규약 E — 자유 편집 UI 없음).
      meta: { default: '' as string },
    },
    content: 'none',
  },
  {
    render: function ColumnsRender({ block, editor }) {
      const raw = block.props.count as number
      const clamped = clampColumnsCount(raw)

      // 편집기당 1회 — "자식이 0이 됨" 변화를 잡는다(브라우저 실측 결함 수정 후속 — 마운트 시
      // 자기 초기 상태를 직접 지우던 이펙트는 **제거했다**: `view.updateState`가 노드뷰를 만드는
      // 도중 같은 이펙트에서 `editor.removeBlocks`를 부르면 중첩 dispatch가 될 수 있었다. 유입
      // 데이터로 이미 비어 있는 columns는 이 onChange 정리가 **첫 편집 때** 걷어낸다).
      useEffect(() => {
        ensureColumnsEmptyCleanup(editor)
      }, [editor])

      return (
        <div
          // 클램프된 단 수는 **선언적 속성**으로만 낸다(브라우저 실측 결함 — 예전에는 `useEffect`가
          // `closest('.bn-block')`으로 PM이 관리하는 DOM(blockContainer)의 style을 직접 변이했고,
          // PM DOMObserver가 그 변이를 외부 변경으로 읽어 `markDirty → updateState` → 노드뷰 재마운트
          // → 이펙트 재실행 → 재변이 …로 무한 루프에 빠져 탭이 완전히 멎었다. 이 값은 React 렌더
          // 트리 **안**이라 tiptap ReactNodeView의 `ignoreMutation`이 무시하므로 안전하다. `notes.css`가
          // `:has(> [data-columns-view=…])`로 형제 자식 그룹을 잡는다 — PM DOM에는 손대지 않는다).
          data-columns-view={clamped}
          className="my-1 flex w-full items-center gap-1 rounded-t-lg border border-b-0 border-border bg-surface-raised px-2 py-1"
        >
          {([2, 3] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n}단으로 표시`}
              aria-pressed={raw === n}
              onClick={() =>
                editor.updateBlock(block, {
                  type: 'columns',
                  props: { count: n, meta: columnsMetaWithoutN(block.props.meta as string) },
                })
              }
              className={`min-h-9 rounded border px-2 text-xs font-medium ${
                raw === n
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-muted hover:bg-bg'
              }`}
            >
              {n}단
            </button>
          ))}
          <button
            type="button"
            aria-label="다단 해제 — 자식 블록을 그대로 꺼냅니다"
            // `editor`는 이 스펙의 render 시그니처상 "columns 하나만 아는" 좁은 제네릭 타입이라
            // (다른 스펙 파일들이 `NoteBlockNoteEditor`를 여기서 import하지 않는 것과 같은 이유),
            // 전체 스키마를 요구하는 `unwrapColumns`에 넘기려면 경계에서 한 번 캐스트한다
            // (`schema.ts`의 "어댑터 ↔ 편집기 경계 캐스트" 관례와 같은 지점 — 실제 런타임 형태는
            // 동일한 BlockNoteEditor 인스턴스라 안전하다).
            onClick={() => unwrapColumns(editor as any, block.id)}
            className="ml-auto min-h-9 rounded border border-border px-2 text-xs text-muted hover:bg-bg hover:text-primary"
          >
            단 해제
          </button>
        </div>
      )
    },
  },
)

/** 고정 목록 재수출 — 툴바·슬래시 메뉴(Phase 2·M35)가 같은 목록을 쓰게 한다. */
export { CALLOUT_VARIANTS }
