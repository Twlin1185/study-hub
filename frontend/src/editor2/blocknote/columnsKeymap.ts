// stage-41 2차 — **단 경계 키 가드**(규약 E 강등 채택 · 브라우저 실측 2026-08-30).
//
// 실측으로 확인된 엔진 기본 동작 2가지가 결정 ④("단 사이로 내용이 이동하지 않는다")를 깬다:
//   ⓐ **단의 마지막 블록 끝에서 Delete** — 엔진이 **다음 단의 내용을 통째로** 현재 단으로 끌어와
//      뒤 단이 사라졌다(col1=[a,b]·col2=[c,d] → col1=[a,b,c,d]).
//   ⓑ **단의 첫 블록 맨 앞에서 Backspace** — 엔진 lift가 **뒤 형제까지 자식으로 달고** 단 밖으로
//      나가, 정규화가 되돌린 뒤 구조가 `col2=[c > d]`(중첩)로 변형됐다.
// 정규화만으로는 ⓑ의 변형을 원상 복구할 수 없고(되돌림 자체가 또 한 번의 조작이다) ⓐ는 아예
// 되돌릴 근거가 없다. 그래서 **그 두 키만** 단 경계에서 no-op으로 막는다 — 규약 E가 예고한
// 강등 경로이며, 엔진 내부 패치가 아니라 **공식 확장 API**(`createExtension({ keyboardShortcuts })`)
// 수준의 개입이다(R33 유지). **2차 후속(2026-08-30 사용자 피드백)**: ⓒ 단 안 **빈 문단 Enter** = 코어가 "빈 중첩 블록 → 부모 밖 승격"을 시도하고 정규화가 되돌려 결과 무동작이던 것을 **아래에 새 문단 삽입**으로 · ⓓ **블록 끝 →** = 다음 단 첫 블록 시작으로, **블록 시작 ←** = 이전 단 마지막 잎 끝으로(단 사이 커서 이동). 그 밖의 키(Tab·↑↓·문자)는 손대지 않는다.
//
// **우선순위**: BlockNote 확장의 `keyboardShortcuts`는 tiptap 확장으로 감싸질 때
// `util/topo-sort.ts`가 부여하는 우선순위 `91 + (idx + r) * 10`(**≥ 91** — dist 실측 · 검토 2026-08-30. 소스 주석의
// "101 — 1 point higher than any tiptap extension"은 근사치)를 받는다. 코어의 Backspace/Delete/Enter/Tab 키맵은 우선순위 **50**의 tiptap
// 확장이라(dist 실측), 우리 키맵의 keydown 처리가 **먼저** 돈다. `true`를 돌려주면 코어 기본
// 동작은 실행되지 않는다.
//
// 판정은 **순수 함수**로 분리했다(`readColumnEdgeFacts`가 PM 상태에서 사실만 뽑고,
// `shouldBlock*`이 그 사실로만 결정한다) — `scripts/s41-columns-editor.mjs` 계열 ④가 고정한다.
import { createExtension } from '@blocknote/core'
import type { EditorState } from 'prosemirror-state'

/** PM 노드 이름(구조 실측): `blockContainer > [<블록타입> 콘텐츠, blockGroup?]`. */
const BLOCK_CONTAINER = 'blockContainer'
const BLOCK_GROUP = 'blockGroup'
const COLUMN = 'column'
const TABLE = 'table'

/** 순수 판정의 입력 — PM 상태에서 뽑아낸 **사실**만 담는다(구조·커서 위치). */
export type ColumnEdgeFacts = {
  /** 커서가 접혀 있는가(선택 범위가 없다). */
  collapsed: boolean
  /** 커서가 블록의 맨 앞인가. */
  atBlockStart: boolean
  /** 커서가 블록의 맨 끝인가. */
  atBlockEnd: boolean
  /** 커서 블록의 콘텐츠가 **문단**인가(목록·헤딩·코드·인용이면 false). */
  isParagraph: boolean
  /** 커서가 `column` 안(깊이 무관)에 있는가 — 표 안이면 false(가드 전부 해제). */
  inColumn: boolean
  /** 커서 블록의 텍스트가 비었는가(빈 문단 Enter 판정). */
  isEmptyBlock: boolean
  /** 커서 블록의 **부모 블록**이 `column`인가(= 단의 최상위 자식). */
  parentIsColumn: boolean
  /** 커서 블록이 그 단의 **첫 최상위 자식**인가. */
  isFirstTopChildOfColumn: boolean
  /** 커서 블록이 그 단 서브트리의 **마지막 잎**인가(중첩 자식이 있으면 그 마지막 잎이 기준). */
  isLastLeafOfColumn: boolean
}

const NO_COLUMN: ColumnEdgeFacts = {
  collapsed: false,
  atBlockStart: false,
  atBlockEnd: false,
  isParagraph: false,
  inColumn: false,
  isEmptyBlock: false,
  parentIsColumn: false,
  isFirstTopChildOfColumn: false,
  isLastLeafOfColumn: false,
}

/**
 * 단의 첫 블록 맨 앞 Backspace = 엔진 승격(ⓑ)을 막는다 — **문단일 때만**. 목록·헤딩·코드·인용이
 * 첫 블록이면 코어 Backspace 체인의 3단계("블록 시작 + 비-paragraph → paragraph로 변환")가 먼저
 * 처리하고 lift(단 밖 승격)는 paragraph에서만 일어나므로, 막으면 유형 해제까지 못 하게 된다
 * (검토 신-1 · 2026-08-30 — `s41-columns-editor` ④-26~29가 고정).
 */
export function shouldBlockBackspace(facts: ColumnEdgeFacts): boolean {
  return facts.collapsed && facts.atBlockStart && facts.isFirstTopChildOfColumn && facts.isParagraph
  return facts.collapsed && facts.atBlockStart && facts.isFirstTopChildOfColumn
}

/** 단의 마지막 잎 끝 Delete = 다음 단 내용을 끌어오는 병합(ⓐ)을 막는다. */
export function shouldBlockDelete(facts: ColumnEdgeFacts): boolean {
  return facts.collapsed && facts.atBlockEnd && facts.isLastLeafOfColumn
}

/**
 * 단의 최상위 블록에서 Shift+Tab = 단 밖으로 승격. 실측에서는 정규화가 깔끔히 되돌렸지만
 * (승격 → 되돌림) 왕복 자체가 undo 2단계·깜빡임을 만들므로 **아예 일어나지 않게** 한다.
 * 단 안의 **중첩** 블록(목록 안 목록 등)에서는 막지 않는다 — 그 승격은 단 안에서 끝난다.
 */
export function shouldBlockShiftTab(facts: ColumnEdgeFacts): boolean {
  return facts.parentIsColumn
}

/** `blockContainer` 노드가 `column` 블록인가(첫 자식 = 블록 콘텐츠 노드의 타입 이름으로 판정). */
function isColumnContainer(node: { type: { name: string }; firstChild: { type: { name: string } } | null }): boolean {
  return node.type.name === BLOCK_CONTAINER && node.firstChild?.type.name === COLUMN
}

/**
 * PM 상태에서 판정 사실을 뽑는다(여기만 PM을 안다 — 위 순수 함수들은 이 결과만 본다).
 * 커서가 단 안이 아니면 전부 false라 어떤 키도 막지 않는다.
 */
export function readColumnEdgeFacts(state: EditorState): ColumnEdgeFacts {
  const { selection } = state
  const $from = selection.$from
  const collapsed = selection.empty

  // 커서 블록 = 가장 가까운 `blockContainer`.
  let blockDepth = $from.depth
  while (blockDepth > 0 && $from.node(blockDepth).type.name !== BLOCK_CONTAINER) blockDepth -= 1
  if (blockDepth <= 0) return NO_COLUMN

  const groupDepth = blockDepth - 1
  const parentBlockDepth = blockDepth - 2
  const parentIsColumn =
    parentBlockDepth >= 0 &&
    $from.node(groupDepth).type.name === BLOCK_GROUP &&
    isColumnContainer($from.node(parentBlockDepth) as any)

  // 단 조상 찾기 — `blockContainer`는 두 단계(그룹 + 컨테이너)마다 나온다.
  let columnDepth = -1
  for (let d = parentBlockDepth; d >= 0; d -= 2) {
    const node = $from.node(d)
    if (node.type.name !== BLOCK_CONTAINER) break
    if (isColumnContainer(node as any)) {
      columnDepth = d
      break
    }
  }
  if (columnDepth < 0) return { ...NO_COLUMN, collapsed }

  // **표 안에서는 아무 키도 막지 않는다** — 표 셀 안의 Tab/Shift+Tab은 셀 이동(prosemirror-tables),
  // Backspace/Delete는 셀 내부 편집이라 단 밖으로 나가는 경로가 아니다. 단 안에 표가 있을 때
  // 셀 이동이 막히는 회귀를 만들지 않으려고 여기서 먼저 빠져나간다(블록 콘텐츠 노드 이름으로 판정).
  if ($from.node(blockDepth).firstChild?.type.name === TABLE) return { ...NO_COLUMN, collapsed }

  const parent = $from.parent
  const isParagraph = $from.node(blockDepth).firstChild?.type.name === 'paragraph'
  const isEmptyBlock = parent.isTextblock ? parent.content.size === 0 : false
  const atBlockStart = parent.isTextblock ? $from.parentOffset === 0 : false
  const atBlockEnd = parent.isTextblock ? $from.parentOffset === parent.content.size : false

  const isFirstTopChildOfColumn = parentIsColumn && $from.index(groupDepth) === 0

  // 마지막 잎 = 단에서 커서 블록까지 내려오는 모든 그룹에서 **마지막 자식**이고, 커서 블록
  // 자신에게는 자식 그룹이 없다(자식이 있으면 마지막 잎은 더 아래에 있다).
  let isLastLeafOfColumn = $from.node(blockDepth).childCount === 1
  if (isLastLeafOfColumn) {
    for (let g = columnDepth + 1; g <= groupDepth; g += 2) {
      const group = $from.node(g)
      if (group.type.name !== BLOCK_GROUP || $from.index(g) !== group.childCount - 1) {
        isLastLeafOfColumn = false
        break
      }
    }
  }

  return {
    collapsed,
    atBlockStart,
    atBlockEnd,
    isParagraph,
    inColumn: true,
    isEmptyBlock,
    parentIsColumn,
    isFirstTopChildOfColumn,
    isLastLeafOfColumn,
  }
}

/** 단 안 빈 문단 Enter = 아래에 새 문단(코어의 "빈 중첩 블록 승격" 대신). 문단이고 단의 최상위 자식일 때만. */
export function shouldInsertParagraphOnEnter(facts: ColumnEdgeFacts): boolean {
  return facts.collapsed && facts.parentIsColumn && facts.isParagraph && facts.isEmptyBlock
}

/** 블록 끝 → = 다음 단으로 건너뛸 조건(다음 단 존재 여부는 호출자가 문서에서 확인). */
export function shouldJumpRight(facts: ColumnEdgeFacts): boolean {
  return facts.collapsed && facts.inColumn && facts.atBlockEnd
}

/** 블록 시작 ← = 이전 단으로 건너뛸 조건. */
export function shouldJumpLeft(facts: ColumnEdgeFacts): boolean {
  return facts.collapsed && facts.inColumn && facts.atBlockStart
}

type AnyBlock = { id: string; type: string; children?: AnyBlock[] }

/**
 * 커서 블록을 감싸는 가장 가까운 `column`과 그 `columns`를 문서에서 찾는다(편집기 API만 — PM 무접촉).
 * 중첩 columns라면 **가장 안쪽** 단이 기준이다.
 */
export function locateColumnOfBlock(doc: AnyBlock[], blockId: string): { columns: AnyBlock; columnIndex: number } | null {
  let found: { columns: AnyBlock; columnIndex: number } | null = null
  const walk = (blocks: AnyBlock[], stack: AnyBlock[]): boolean => {
    for (const b of blocks) {
      if (b.id === blockId) {
        for (let i = stack.length - 1; i >= 1; i -= 1) {
          if (stack[i].type === 'column' && stack[i - 1].type === 'columns') {
            found = { columns: stack[i - 1], columnIndex: (stack[i - 1].children ?? []).indexOf(stack[i]) }
            break
          }
        }
        return true
      }
      if (b.children?.length && walk(b.children, [...stack, b])) return true
    }
    return false
  }
  walk(doc, [])
  return found
}

/** 단의 마지막 잎(자식이 있으면 끝까지 내려간다). */
function lastLeaf(block: AnyBlock): AnyBlock {
  let cur = block
  while (cur.children?.length) cur = cur.children[cur.children.length - 1]
  return cur
}

type BnEditorLike = {
  prosemirrorState: EditorState
  document: AnyBlock[]
  getTextCursorPosition: () => { block: AnyBlock }
  setTextCursorPosition: (block: AnyBlock | string, placement?: 'start' | 'end') => void
  insertBlocks: (blocks: Array<{ type: string }>, ref: AnyBlock | string, placement?: 'before' | 'after') => AnyBlock[]
}

/** 빈 문단 Enter — 같은 단 안, 커서 블록 바로 아래에 새 문단을 만들고 커서를 옮긴다. */
export function handleEnterInColumn(editor: BnEditorLike): boolean {
  if (!shouldInsertParagraphOnEnter(readColumnEdgeFacts(editor.prosemirrorState))) return false
  const current = editor.getTextCursorPosition().block
  const inserted = editor.insertBlocks([{ type: 'paragraph' }], current, 'after')
  if (inserted[0]) editor.setTextCursorPosition(inserted[0], 'start')
  return true
}

/** 방향키 단 이동 — → 는 다음 단 첫 블록 시작, ← 는 이전 단 마지막 잎 끝. 이동할 단이 없으면 코어 기본(문서 순서). */
export function handleArrowAcrossColumns(editor: BnEditorLike, dir: 'left' | 'right'): boolean {
  const facts = readColumnEdgeFacts(editor.prosemirrorState)
  if (!(dir === 'right' ? shouldJumpRight(facts) : shouldJumpLeft(facts))) return false
  const current = editor.getTextCursorPosition().block
  const loc = locateColumnOfBlock(editor.document, current.id)
  if (!loc) return false
  const cells = loc.columns.children ?? []
  const target = cells[loc.columnIndex + (dir === 'right' ? 1 : -1)]
  if (!target || !target.children?.length) return false
  if (dir === 'right') editor.setTextCursorPosition(target.children[0], 'start')
  else editor.setTextCursorPosition(lastLeaf(target), 'end')
  return true
}

/** 확장에 그대로 꽂는 단축키 표(테스트에서도 이 객체를 직접 부른다). */
export const columnsEdgeShortcuts = {
  Backspace: ({ editor }: { editor: { prosemirrorState: EditorState } }) =>
    shouldBlockBackspace(readColumnEdgeFacts(editor.prosemirrorState)),
  Delete: ({ editor }: { editor: { prosemirrorState: EditorState } }) =>
    shouldBlockDelete(readColumnEdgeFacts(editor.prosemirrorState)),
  'Shift-Tab': ({ editor }: { editor: { prosemirrorState: EditorState } }) =>
    shouldBlockShiftTab(readColumnEdgeFacts(editor.prosemirrorState)),
  Enter: ({ editor }: { editor: BnEditorLike }) => handleEnterInColumn(editor),
  ArrowRight: ({ editor }: { editor: BnEditorLike }) => handleArrowAcrossColumns(editor, 'right'),
  ArrowLeft: ({ editor }: { editor: BnEditorLike }) => handleArrowAcrossColumns(editor, 'left'),
}

/** 두 편집 표면 공용 확장(`extensions.ts`가 묶어서 넘긴다). */
export function createColumnsEdgeKeymapExtension() {
  return createExtension({
    key: 'editor2ColumnsEdge',
    keyboardShortcuts: columnsEdgeShortcuts as never,
  })
}
