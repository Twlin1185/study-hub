// **마크 탈출 제스처**(stage-47 F-1 · FB-20 · 규약 A) — 서식 구간 끝에서 `→`·`Tab`·`Space×2`로
// 다음 입력에 붙을 **스타일 마크**(대기 마크)를 벗긴다. 노트·문서 양 편집 표면 공용(`extensions.ts`).
//
// **왜 필요한가(FB-20)**: 접힌 커서가 굵게 구간 끝에 있으면 ProseMirror는 다음 입력에도 굵게를
// 상속한다(마크 `inclusive` 기본값). 구간을 빠져나오려면 버튼을 다시 눌러 끄거나(FB-16 우회)
// 단축키를 다시 쳐야 하는데, 모바일에는 단축키가 없고 버튼 왕복은 손이 많이 간다. 그래서
// 워드프로세서 관례(→ / Tab / 스페이스 2회)로 "지금 걸린 서식을 여기서 끝낸다"를 만든다.
//
// **규약 A 요지**:
//   ① 대상 = `editor.schema.styleSchema`에 등재된 마크 전부(bold·italic·underline·strike·code·
//      spoiler·highlight·`t`) — `activeStyles.ts`와 같은 조회. **`link`는 제외**(스타일 마크가
//      아니고 코어가 이미 `exitable`). 제스처가 링크 위에서 쓰여도 링크 마크는 건드리지 않는다.
//   ② "구간 끝" = `collapsed && pending ≠ ∅ && !nextInherits`. `pending`은 `state.storedMarks ??
//      $cursor.marks()`를 스타일 마크로 거른 집합(버튼 클릭 직후 아직 글자를 안 친 상태도 포함).
//      `nextInherits`는 같은 텍스트 블록 안 다음 문자가 `pending` 전부를 갖고 있음(= 구간 **중간**).
//   ③ 발동하면 `true`(코어·브라우저 기본 동작 미실행), 그 밖에는 `false`(기본 동작 그대로).
//      - `ArrowRight`: 커서 이동 없이 대기 마크에서 스타일 마크만 제거. 두 번째 →는 정상 이동.
//      - `Tab`: 같은 처리(코어 `nestBlock` 미실행). **표 안에서는 비활성**(셀 이동 우선).
//      - `Space` 2회: 1회째는 코어가 상속 마크 붙은 공백을 넣는다. 2회째 = 직전 문자가 스타일
//        마크 붙은 공백이면 그 공백의 스타일 마크를 벗기고 대기 마크를 비우며 **두 번째 공백은
//        넣지 않는다** → 결과 = 마크 밖 공백 1개(사용자 확정 ⓐ). 세 번째 스페이스는 직전 공백에
//        마크가 없으니 정상 삽입(폭주 없음).
//   ④ PM은 한글 조합 중 keydown을 키맵에 넘기지 않으므로 조합 중에는 발동하지 않는다(대응 코드 0).
//
// **형태**: 사실 추출(`readMarkEscapeFacts` — 여기만 PM 상태를 안다) → 순수 판정(`shouldEscapeOn*`)
// → 커맨드(`escapeMarks`·`escapeMarksReplacingSpace`) → 단축키 표(`markEscapeShortcuts`) →
// 확장(`createMarkEscapeKeymapExtension`). `columnsKeymap.ts`와 같은 결이며, 대안(예: 탈출 시
// 공백 삽입)으로 바꿀 일이 생기면 이 파일 1곳만 손댄다. `scripts/s47-mark-escape.mjs`가 고정한다.
//
// **우선순위**: 공식 확장 `keyboardShortcuts`는 코어 Tab 키맵(우선순위 50)보다 먼저 돈다
// (`columnsKeymap.ts` 머리 주석). columns 확장의 `ArrowRight`와는 같은 우선순위라 tiptap이
// 확장 배열을 **뒤집어** 플러그인을 쌓는 규칙(`ExtensionManager.plugins` — 배열 뒤쪽이 먼저)에
// 따라 `extensions.ts`에서 columns **뒤**에 둔 이 확장이 먼저 처리한다(s47 ⓒ 실측 고정).
import { createExtension } from '@blocknote/core'
import type { Mark } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'

const TABLE = 'table'

/** 순수 판정의 입력 — PM 상태에서 뽑아낸 **사실**만 담는다. */
export type MarkEscapeFacts = {
  /** 커서가 접혀 있는가(선택 범위가 없다). */
  collapsed: boolean
  /** 다음 입력에 붙을 스타일 마크 이름(`storedMarks ?? $cursor.marks()` ∩ styleSchema). 비면 제스처 후보가 아니다. */
  pending: readonly string[]
  /** 같은 텍스트 블록 안 다음 문자가 `pending` 전부를 갖고 있는가(= 구간 중간). */
  nextInherits: boolean
  /** 직전 문자가 **스타일 마크 붙은 공백**인가(스페이스 2회 판정). */
  prevIsMarkedSpace: boolean
  /** 커서가 표 안인가(Tab 제스처 비활성 — 셀 이동 우선). */
  inTable: boolean
}

const NO_FACTS: MarkEscapeFacts = {
  collapsed: false,
  pending: [],
  nextInherits: false,
  prevIsMarkedSpace: false,
  inTable: false,
}

/** 편집기가 스타일 마크로 등재한 마크 이름 집합 — `activeStyles.ts`와 같은 조회(상수 복제 금지). */
export function styleMarkNamesOf(editor: { schema: { styleSchema: object } }): ReadonlySet<string> {
  return new Set(Object.keys(editor.schema.styleSchema))
}

function hasAll(marks: readonly Mark[], names: readonly string[]): boolean {
  return names.every((name) => marks.some((mark) => mark.type.name === name))
}

/**
 * PM 상태에서 판정 사실을 뽑는다(여기만 PM을 안다 — 아래 순수 함수들은 이 결과만 본다).
 * 텍스트 커서가 아니면(노드 선택·범위 선택) 전부 false/∅라 어떤 키도 잡지 않는다.
 */
export function readMarkEscapeFacts(state: EditorState, styleMarkNames: ReadonlySet<string>): MarkEscapeFacts {
  const { selection } = state
  if (!selection.empty) return NO_FACTS
  const $cursor = selection.$from
  const parent = $cursor.parent
  if (!parent.isTextblock) return { ...NO_FACTS, collapsed: true }

  const marksNow = state.storedMarks ?? $cursor.marks()
  const pending = marksNow.filter((mark) => styleMarkNames.has(mark.type.name)).map((mark) => mark.type.name)

  const nodeAfter = $cursor.nodeAfter
  const nextInherits = pending.length > 0 && nodeAfter !== null && hasAll(nodeAfter.marks, pending)

  const nodeBefore = $cursor.nodeBefore
  const prevIsMarkedSpace =
    nodeBefore !== null &&
    nodeBefore.isText &&
    (nodeBefore.text ?? '').endsWith(' ') &&
    nodeBefore.marks.some((mark) => styleMarkNames.has(mark.type.name))

  let inTable = false
  for (let d = $cursor.depth; d > 0; d -= 1) {
    if ($cursor.node(d).type.name === TABLE) {
      inTable = true
      break
    }
  }

  return { collapsed: true, pending, nextInherits, prevIsMarkedSpace, inTable }
}

/** 구간 끝 = 접힌 커서 + 대기 스타일 마크 있음 + 다음 문자가 그 마크를 물려받지 않음. */
export function isAtMarkedRangeEnd(facts: MarkEscapeFacts): boolean {
  return facts.collapsed && facts.pending.length > 0 && !facts.nextInherits
}

/** `→` — 구간 끝이면 이동 없이 탈출. */
export function shouldEscapeOnArrowRight(facts: MarkEscapeFacts): boolean {
  return isAtMarkedRangeEnd(facts)
}

/** `Tab` — 구간 끝이면 들여쓰기 대신 탈출. 표 안에서는 비활성(셀 이동 우선). */
export function shouldEscapeOnTab(facts: MarkEscapeFacts): boolean {
  return isAtMarkedRangeEnd(facts) && !facts.inTable
}

/** `Space` 2회째 — 구간 끝 + 직전 문자가 스타일 마크 붙은 공백일 때만 치환 탈출. */
export function shouldEscapeOnSpace(facts: MarkEscapeFacts): boolean {
  return isAtMarkedRangeEnd(facts) && facts.prevIsMarkedSpace
}

/** 편집기 표면 중 이 모듈이 쓰는 최소 형태(`columnsKeymap.ts`의 `BnEditorLike`와 같은 관례). */
export type MarkEscapeEditorLike = {
  prosemirrorState: EditorState
  schema: { styleSchema: object }
  transact: <T>(callback: (tr: Transaction) => T) => T
}

/** 대기 마크에서 스타일 마크만 뺀 목록(링크 등 비-스타일 마크 보존). */
function withoutStyleMarks(marks: readonly Mark[], styleMarkNames: ReadonlySet<string>): Mark[] {
  return marks.filter((mark) => !styleMarkNames.has(mark.type.name))
}

/**
 * 탈출 커맨드(→·Tab) — 커서 이동 없이 대기 마크에서 스타일 마크만 제거한다.
 * `storedMarks`는 "다음 입력에 붙을 마크 **전체 목록**"이므로(`activeStyles.ts` 머리말) 스타일
 * 마크를 뺀 나머지(링크 등)를 그대로 다시 얹는다 — 빈 배열도 "전부 해제"라는 뜻이라 유효하다.
 * 판정은 호출자가 이미 끝냈다고 본다(사실 추출 → 순수 판정 → 이 커맨드).
 */
export function escapeMarks(editor: MarkEscapeEditorLike): void {
  const styleMarkNames = styleMarkNamesOf(editor)
  editor.transact((tr) => {
    const marksNow = tr.storedMarks ?? tr.selection.$from.marks()
    tr.setStoredMarks(withoutStyleMarks(marksNow, styleMarkNames))
  })
}

/**
 * 스페이스 2회째 커맨드 — 직전 공백(커서 바로 앞 1글자)에서 스타일 마크를 벗기고 대기 마크를
 * 비운다. **공백을 새로 넣지 않는다**(결과 = 마크 밖 공백 1개 · 커서는 그 뒤 그대로).
 * `removeMark`가 문서를 바꾸므로 `storedMarks`는 그 스텝에서 초기화된다 — 그 뒤 `setStoredMarks`로
 * 링크 등 비-스타일 마크만 다시 얹어야 다음 입력이 공백의 (이제 없는) 스타일을 물려받지 않는다.
 */
export function escapeMarksReplacingSpace(editor: MarkEscapeEditorLike): void {
  const styleMarkNames = styleMarkNamesOf(editor)
  editor.transact((tr) => {
    const $cursor = tr.selection.$from
    const marksNow = tr.storedMarks ?? $cursor.marks()
    const pos = $cursor.pos
    const spaceMarks = $cursor.nodeBefore?.marks ?? []
    for (const mark of spaceMarks) {
      if (styleMarkNames.has(mark.type.name)) tr.removeMark(pos - 1, pos, mark)
    }
    tr.setStoredMarks(withoutStyleMarks(marksNow, styleMarkNames))
  })
}

type ShortcutContext = { editor: MarkEscapeEditorLike }

function factsOf(editor: MarkEscapeEditorLike): MarkEscapeFacts {
  return readMarkEscapeFacts(editor.prosemirrorState, styleMarkNamesOf(editor))
}

/**
 * 확장에 그대로 꽂는 단축키 표(테스트에서도 이 객체를 직접 부른다). 키 이름 `Space`는
 * prosemirror-keymap의 `normalizeKeyName`이 `" "`로 정규화한다(`s47-mark-escape.mjs`가 실측).
 */
export const markEscapeShortcuts = {
  ArrowRight: ({ editor }: ShortcutContext) => {
    if (!shouldEscapeOnArrowRight(factsOf(editor))) return false
    escapeMarks(editor)
    return true
  },
  Tab: ({ editor }: ShortcutContext) => {
    if (!shouldEscapeOnTab(factsOf(editor))) return false
    escapeMarks(editor)
    return true
  },
  Space: ({ editor }: ShortcutContext) => {
    if (!shouldEscapeOnSpace(factsOf(editor))) return false
    escapeMarksReplacingSpace(editor)
    return true
  },
}

/** 두 편집 표면 공용 확장(`extensions.ts`가 columns 확장 **뒤**에 묶어 넘긴다). */
export function createMarkEscapeKeymapExtension() {
  return createExtension({
    key: 'editor2MarkEscape',
    keyboardShortcuts: markEscapeShortcuts as never,
  })
}
