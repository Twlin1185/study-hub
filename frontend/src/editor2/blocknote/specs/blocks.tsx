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
import { planColumnsNormalization, type ColumnsJsonBlock } from '../columnsNormalize'
import { setColumnsCount, unwrapColumns } from '../refPicker/insert'
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

// ------------------------------------------------- 다단(columns > column · stage-41 규약 A **2차**)
//
// **고정 열**(Notion 컬럼) — 컨테이너 `columns`(`content: 'none'`) 안에 **단 컨테이너 `column` n개**가
// 있고, 각 단의 자식 블록이 그 단의 내용이다(엔진 중첩 그룹 `.bn-block-group` 2겹 — `notes.css`가
// 바깥 그룹을 **grid**로 만들고 각 `.bn-block-outer`를 셀로 그린다). 1차 흐름형(`column-count`)은
// 폐기됐다 — 텍스트가 단을 넘어 흐르고 브라우저가 균등 배분해서 "3단에 쓴 글이 1단으로 이동"하는
// 실사용 결함이 났기 때문이다(2차 개정 근거, 착수 전 결정 ①).
//
// 여기 render 2개가 그리는 것:
//   · `columns` = 머리의 얇은 **컨트롤 띠**(2/3 토글 + [단 해제]) + `data-columns-view={n}` 선언 속성
//   · `column`  = **빈 div**(`data-column-cell`) — 셀의 시각(구분선·여백)은 전부 CSS가 그린다.
//
// **`count` 표시(착수 전 결정 ② 2차)**: 1차의 "3단 상한 강등"은 폐기했다. 고정 열은 열 수가 곧
// `column` 자식 수라 4열도 폭만 좁아질 뿐 표시에 무리가 없다(`notes.css`의 `grid-auto-flow: column`
// 기본 규칙이 자식 수만큼 열을 만든다). 그래서 이 속성은 **정수면 그 값 그대로** 싣고, 2·3(과 1)에만
// 명시 트랙 규칙이 걸린다.
//
// **브라우저 실측 결함(1차, 치명 — 수정 완료·유지)**: 처음에는 `useEffect`로 `closest('.bn-block')`
// (PM이 관리하는 blockContainer DOM)의 `style`을 직접 변이했는데, PM DOMObserver가 그 변이를 외부
// 변경으로 읽어 `markDirty → updateState`(재그리기) → 노드뷰 재마운트 → 이펙트 재실행 → 재변이 …로
// 무한 루프에 빠져 탭이 완전히 멎었다. **PM 관리 DOM을 명령형으로 건드리지 않는다**(R33). 지금 값은
// React 렌더 트리 안의 속성 하나뿐이라 tiptap ReactNodeView의 `ignoreMutation`이 무시한다.
const columnsViewValue = (raw: unknown): string => {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 2
  return String(Math.max(1, n))
}

/**
 * **정규화 훅**(규약 A 불변식 ①~④ · 1차 `ensureColumnsEmptyCleanup` 대체).
 *
 * 왜 편집기 전역 구독인가: 자식 그룹(`.bn-block-group`)은 컨테이너 블록 자신과 **형제**인 PM 노드라
 * 자식이 바뀌어도 이 블록의 리액트 노드뷰는 갱신 신호를 받지 않는다(`useNodeViewBlock`이 자기 노드만
 * 다시 읽는다 — 1차 실측). 그래서 **편집기당 1회**(WeakSet) `editor.onChange`를 구독해 문서를 훑는다.
 *
 * 재진입·무한 루프 방지 3중:
 *   ① `planColumnsNormalization`이 **바꿀 게 없으면 빈 배열** → 아무 dispatch도 하지 않는다.
 *      우리 자신의 dispatch가 부른 onChange는 이미 정규 상태라 두 번째 계획이 비어 루프가 끊긴다.
 *   ② 계획이 있으면 `setTimeout 0`으로 한 틱 미룬다(트랜잭션·`view.updateState` 흐름 밖에서 실행).
 *   ③ `scheduled` 깃발로 대기 중 중복 예약을 막고, 실행 시점에 **문서를 다시 읽어** 계획을 새로 세운다
 *      (그 사이 다른 편집으로 사라진 id에 손대지 않는다 — 1차 `getBlock` 재확인 관례의 확장).
 *
 * 한 컨테이너 = `replaceBlocks` 1콜(+ count가 달라졌을 때만 `updateBlock` 1콜)이고, 전체를
 * `editor.transact`로 묶어 **undo 1단위**로 만든다. 그래도 "사용자 조작 + 정규화"는 undo 2단계다
 * (규약 B 알려진 한계 — 실측 기록 대상).
 */
const columnsNormalizeRegistered = new WeakSet<object>()
/**
 * `onChange` 구독 해제 함수 — **보관만** 한다(검토 경-6). 편집기 인스턴스는 화면 수명과 같고
 * (`useCreateBlockNote` deps=[]), 해제 시점이 곧 편집기 파괴 시점이라 지금 부를 자리가 없다.
 * 나중에 표면이 편집기를 갈아 끼우게 되면 여기서 꺼내 부르면 된다(WeakMap이라 누수 없음).
 */
const columnsNormalizeUnsubscribe = new WeakMap<object, () => void>()

/** 편집기가 이미 파괴됐는가 — 지연 실행(`setTimeout`) 시점에 확인한다(검토 경-6). */
function editorIsDestroyed(ed: any): boolean {
  return ed?._tiptapEditor?.isDestroyed === true
}

function ensureColumnsNormalized(editor: any): void {
  if (columnsNormalizeRegistered.has(editor)) return
  columnsNormalizeRegistered.add(editor)
  let scheduled = false
  const unsubscribe = editor.onChange((ed: any) => {
    if (scheduled) return
    if (planColumnsNormalization(ed.document as ColumnsJsonBlock[]).length === 0) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      // 한 틱 사이에 화면이 언마운트됐을 수 있다 — 파괴된 편집기에 dispatch하면 던진다.
      if (editorIsDestroyed(ed)) return
      try {
        applyColumnsNormalization(ed)
      } catch {
        // 정규화는 **편집을 막지 않는다** — 실패하면 다음 변경에서 다시 시도한다.
      }
    }, 0)
  })
  if (typeof unsubscribe === 'function') columnsNormalizeUnsubscribe.set(editor, unsubscribe)
}

/**
 * 계획을 실행한다(실행 시점 문서 기준으로 다시 세운다 — 위 ③).
 * `export`인 이유는 브라우저 없이 **헤드리스로 검증**하기 위해서다(`@blocknote/server-util`의
 * 편집기 인스턴스에 그대로 먹인다 — 훅 등록 경로를 타지 않고 같은 코드를 돌린다).
 */
export function applyColumnsNormalization(ed: any): void {
  const ops = planColumnsNormalization(ed.document as ColumnsJsonBlock[])
  if (ops.length === 0) return

  // 커서가 **다시 만들어지는 범위 안**에 있을 때만 복원한다(밖이면 손대지 않는다 — 남의 커서를
  // 문단 처음으로 끌어오는 것은 타이핑 중 최악의 부작용이다).
  let cursorId: string | null = null
  try {
    if (ed.isFocused()) {
      const at = ed.getTextCursorPosition().block.id as string
      if (ops.some((op) => op.scope.has(at))) cursorId = at
    }
  } catch {
    cursorId = null
  }

  ed.transact(() => {
    for (const op of ops) {
      const current = ed.getBlock(op.id)
      if (!current) continue
      if (op.kind === 'lift') {
        if (current.type !== 'column') continue
        // 빈 stray 단은 **통째로 삭제**한다(빈 문단을 남기지 않는다 — A 동치, 검토 경-2).
        if (op.children.length === 0) ed.removeBlocks([op.id])
        else ed.replaceBlocks([op.id], op.children)
        continue
      }
      if (current.type !== 'columns') continue
      const childIds = (current.children ?? []).map((child: { id: string }) => child.id)
      if (childIds.length > 0) {
        ed.replaceBlocks(childIds, op.children)
        if (Number(current.props?.count) !== op.count) {
          ed.updateBlock(op.id, { type: 'columns', props: { count: op.count } })
        }
      } else {
        // 자식이 0이면 교체할 id가 없다 — 컨테이너 자신을 같은 id로 다시 놓는다(props 보존).
        ed.replaceBlocks(
          [op.id],
          [
            {
              id: op.id,
              type: 'columns',
              props: { ...(current.props ?? {}), count: op.count },
              children: op.children,
            },
          ],
        )
      }
    }
    if (cursorId) {
      try {
        const landed = ed.getBlock(cursorId)
        if (landed && Array.isArray(landed.content)) ed.setTextCursorPosition(cursorId, 'start')
      } catch {
        // 커서 복원 실패는 편집을 막지 않는다.
      }
    }
  })
}

/**
 * **단 컨테이너**(`column`) — prop 없음 · `content: 'none'` · 자식 블록이 그 단의 내용.
 * 렌더는 **높이 0의 빈 div**다: 셀의 구분선·여백·grid 배치는 전부 `notes.css`가 `.bn-block-outer`
 * 단위로 그린다(스펙이 자기 상자를 그리면 엔진의 자식 그룹과 이중 상자가 된다).
 * 슬래시 메뉴에는 넣지 않는다 — 사용자는 `columns` 단위로만 만든다(규약 A).
 */
export const createColumnBlockSpec = createReactBlockSpec(
  {
    type: 'column',
    propSchema: {},
    content: 'none',
  },
  {
    render: function ColumnRender({ editor }) {
      // `columns` 없이 단독 `column`만 들어온 문서에서도 불변식 ④가 걷어내도록 여기서도 건다
      // (편집기당 1회 — WeakSet).
      useEffect(() => {
        ensureColumnsNormalized(editor)
      }, [editor])
      return <div data-column-cell />
    },
  },
)

export const createColumnsBlockSpec = createReactBlockSpec(
  {
    type: 'columns',
    propSchema: {
      count: { default: 2 },
      // 콜아웃 `attrs`와 같은 역할 — `{key=value}` 속성 쌍 통짜 보존. 어댑터가 채우고 스펙은
      // 보존만 한다(규약 E — 자유 편집 UI 없음).
      meta: { default: '' as string },
    },
    content: 'none',
  },
  {
    render: function ColumnsRender({ block, editor }) {
      const raw = block.props.count as number

      useEffect(() => {
        ensureColumnsNormalized(editor)
      }, [editor])

      return (
        <div
          // 표시 열 수는 **선언적 속성**으로만 낸다(위 실측 결함 주석 참고 — PM DOM 무접촉).
          // `notes.css`가 `:has(> :not(.bn-block-group) [data-columns-view])`로 형제인 자식 그룹을
          // 잡아 grid를 준다.
          data-columns-view={columnsViewValue(raw)}
          className="mt-1 flex w-full items-center gap-1 rounded-t-lg border border-b-0 border-border bg-surface-raised px-2 py-1"
        >
          {([2, 3] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n}단으로 바꾸기`}
              aria-pressed={raw === n}
              // 2→3 = 빈 단 추가 · 3→2 = 마지막 단 내용을 앞 단 끝에 병합(손실 0 · 한 트랜잭션).
              // `editor`는 이 스펙 render 시그니처상 "columns 하나만 아는" 좁은 제네릭이라
              // (`unwrapColumns`와 같은 지점) 경계에서 한 번 캐스트한다.
              onClick={() => setColumnsCount(editor as any, block.id, n)}
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
            aria-label="다단 해제 — 각 단의 블록을 순서대로 꺼냅니다"
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
