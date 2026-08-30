// 참조 칩·임베드 블록·콜아웃 **삽입 커맨드** — 규약 A ①②의 실행 지점.
//
// 여기 있는 모든 함수는 다음 두 계약을 지킨다:
//   ① 대상(`target`)은 **피커가 고른 값만** 받는다 — 자유 입력 경로가 없다(규약 B).
//   ② `replaceSelection`이 명시적으로 참일 때만 선택을 덮어쓴다. 그 외에는 **선택을 접고 커서 위치에**
//      삽입한다 — 사용자의 글자가 조용히 사라지는 경로를 만들지 않는다(규약 A ②).
import {
  emptyColumns,
  isEmptyParagraph,
  makeColumn,
  normalizedColumnsChildren,
} from '../columnsNormalize'
import type { NoteBlockNoteEditor } from '../schema'
import type { RefKind } from './RefTitleContext'

/**
 * 선택을 **접는다**(끝 지점으로). BlockNote `insertInlineContent`는 `tr.selection.from~to`를
 * 대체하므로, 선택을 유지한 채 삽입하려면 먼저 커서로 접어야 한다.
 */
function collapseSelection(editor: NoteBlockNoteEditor): void {
  const to = editor.transact((tr) => tr.selection.to)
  editor._tiptapEditor.commands.setTextSelection(to)
}

/** 참조 칩(doc·anchor) 삽입. `label === ''` = 추종형(대상 제목을 따라간다). */
export function insertRefChip(
  editor: NoteBlockNoteEditor,
  refType: Exclude<RefKind, 'embed'>,
  target: string,
  label: string,
  replaceSelection: boolean,
): void {
  if (!target) return
  if (!replaceSelection) collapseSelection(editor)
  // `styles: ''` = 원자에 걸린 서식 없음(어댑터가 마크를 실어 나르는 전송로 — 새 칩은 비운다).
  editor.insertInlineContent([{ type: 'refChip', props: { refType, target, label, styles: '' } }], {
    updateSelection: true,
  })
  editor.focus()
}

/** 현재 커서 블록이 "비어 있는 문단"인가 — 슬래시 메뉴 직후의 빈 줄을 그대로 쓰기 위한 판정. */
function cursorBlockIsEmptyParagraph(editor: NoteBlockNoteEditor): boolean {
  const block = editor.getTextCursorPosition().block
  if (block.type !== 'paragraph') return false
  const content: unknown = block.content
  return Array.isArray(content) && content.length === 0
}

/**
 * 문서 임베드는 **블록**으로 삽입한다(규약 A ① — 문단 안 임베드는 기존 데이터 수용 전용).
 * 선택이 있어도 **덮어쓰지 않는다**: 블록 삽입으로 본문 글자를 지우는 경로를 만들지 않는다.
 */
export function insertDocEmbedBlock(editor: NoteBlockNoteEditor, target: string, label: string): void {
  if (!target) return
  const current = editor.getTextCursorPosition().block
  const block = { type: 'docEmbed' as const, props: { target, label } }
  if (cursorBlockIsEmptyParagraph(editor)) {
    editor.replaceBlocks([current.id], [block])
  } else {
    editor.insertBlocks([block], current.id, 'after')
  }
  editor.focus()
}

/**
 * 콜아웃 삽입(규약 E) — `variant`는 고정 목록에서만, `title`은 `isSafeRefText` 통과분만 온다.
 * 콜아웃 본문은 **자식 블록**이므로(스펙 `content: 'none'`) 빈 문단 하나를 함께 넣어 바로 쓸 수 있게 한다.
 */
export function insertCalloutBlock(editor: NoteBlockNoteEditor, variant: string, title: string): void {
  const current = editor.getTextCursorPosition().block
  const block = {
    type: 'callout' as const,
    props: { variant, title },
    children: [{ type: 'paragraph' as const }],
  }
  const inserted = cursorBlockIsEmptyParagraph(editor)
    ? editor.replaceBlocks([current.id], [block]).insertedBlocks
    : editor.insertBlocks([block], current.id, 'after')
  const child = inserted[0]?.children?.[0]
  if (child) editor.setTextCursorPosition(child.id, 'start')
  editor.focus()
}


// ---------------------------------------------- 다단(columns > column · stage-41 규약 B **2차**)
//
// 2차는 **고정 열**이다 — 삽입하면 곧바로 빈 단 n개(각 빈 문단 1개)가 서고, 각 단은 독립된 내용
// 흐름을 갖는다. 여기 함수들은 `columnsNormalize.ts`의 헬퍼로 자식 목록을 만들어 **정규화 훅과
// 같은 규칙**을 쓴다(둘이 어긋나면 삽입 직후 훅이 다시 손대는 깜빡임이 생긴다).

/**
 * "커서/선택이 columns·column 또는 콜아웃 **안**인지" 판정(원자 가드 관례와 같은 결 — 숨기지 않고
 * 비활성 + 사유). `getParentBlock`은 바로 위 1단계만 주므로 뿌리까지 반복해서 걷는다.
 * `column` 안 = `columns` 안이지만(단은 컨테이너 밖에 못 산다) 유입 데이터의 비정규 배치까지
 * 막으려고 `column`도 조상 판정에 넣는다(규약 B 2차).
 */
function blockHasColumnsOrCalloutAncestor(editor: NoteBlockNoteEditor, blockId: string): boolean {
  let current = blockId
  for (;;) {
    const parent = editor.getParentBlock(current)
    if (!parent) return false
    if (parent.type === 'columns' || parent.type === 'column' || parent.type === 'callout') {
      return true
    }
    current = parent.id
  }
}

/**
 * "다단 넣기" 차단 판정(착수 전 결정 ③) — 커서/선택이 columns·column·콜아웃 **안**이거나, 선택에
 * columns/column 블록 자신이 최상위로 포함돼 있으면(그대로 감싸면 columns-안-columns가 된다) 막는다.
 * 콜아웃을 감싸는 것은 허용된다(콜아웃 **안** columns만 금지 — columns 안 콜아웃은 허용).
 */
export function columnsInsertBlocked(editor: NoteBlockNoteEditor): boolean {
  try {
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
    return blocks.some(
      (block) =>
        block.type === 'columns' ||
        block.type === 'column' ||
        blockHasColumnsOrCalloutAncestor(editor, block.id),
    )
  } catch {
    return false
  }
}

/** 컨테이너 한 채 — 자식 = 빈 단 n개(규약 B "삽입 = 빈 단 n개"). */
function newColumnsContainer(count: 2 | 3) {
  return { type: 'columns' as const, props: { count, meta: '' }, children: emptyColumns(count) as any }
}

/** 삽입 직후 **1단의 첫 문단**으로 커서를 옮긴다(규약 B — 바로 쓸 수 있어야 한다). */
function focusFirstCell(editor: NoteBlockNoteEditor, container: { children?: any[] } | undefined): void {
  const firstBlockOfFirstCell = container?.children?.[0]?.children?.[0]
  if (firstBlockOfFirstCell?.id) editor.setTextCursorPosition(firstBlockOfFirstCell.id, 'start')
  editor.focus()
}

/**
 * 다단(columns) 삽입 — 선택 블록이 있으면 그 블록들을 **1단**에 넣고 나머지 단은 빈 문단으로
 * 채운다(`wrapInColumns`), 없으면 빈 단 n개짜리 컨테이너를 커서 자리에 넣는다.
 * **중첩 차단은 호출자 책임**(슬래시·툴바가 `columnsInsertBlocked`로 각자 가드한다 —
 * `insertCalloutBlock`과 같은 관례).
 */
export function insertColumnsBlock(editor: NoteBlockNoteEditor, count: 2 | 3): void {
  const selection = editor.getSelection()
  const selected = selection?.blocks
  if (selected && selected.length > 0) {
    wrapInColumns(editor, selected, count)
    return
  }
  const current = editor.getTextCursorPosition().block
  const block = newColumnsContainer(count)
  const inserted = cursorBlockIsEmptyParagraph(editor)
    ? editor.replaceBlocks([current.id], [block]).insertedBlocks
    : editor.insertBlocks([block], current.id, 'after')
  focusFirstCell(editor, inserted[0])
}

/**
 * 선택된 최상위 블록들을 **1단**에 넣어 감싼다 — 원래 블록(id 포함)을 그대로 그 단의 `children`으로
 * 넘기고 `replaceBlocks`로 제자리 치환한다(엔진이 같은 트랜잭션 안에서 id를 재사용해도 안전 —
 * `removeAndInsertBlocks` 실측: 삽입이 먼저, 원본 삭제는 그 뒤라 일시적으로 id가 겹쳐도 최종
 * 문서에는 하나만 남는다). id를 보존하므로 감싸진 블록(예: 제목)을 가리키는 앵커 칩이 깨지지 않는다.
 * 나머지 단은 빈 문단 1개씩(규약 B). 한 번의 `replaceBlocks` = undo 1단위.
 */
export function wrapInColumns(
  editor: NoteBlockNoteEditor,
  blocks: readonly { id: string }[],
  count: 2 | 3,
): void {
  if (blocks.length === 0) return
  const ids = blocks.map((b) => b.id)
  const cells = [makeColumn(blocks as any), ...emptyColumns(count - 1)]
  const container = { type: 'columns' as const, props: { count, meta: '' }, children: cells as any }
  editor.replaceBlocks(ids, [container])
  editor.focus()
}

/**
 * 단 수 변경(컨트롤 띠 2/3 토글 · 규약 B) — **2→3 = 빈 단 추가 · 3→2 = 마지막 단 내용을 앞 단
 * 끝에 병합**(조용한 손실 0). 한 번의 `replaceBlocks`(컨테이너 통째) = undo 1단위이고, 남는 단의
 * id를 그대로 물려주므로 남는 쪽은 제자리에 있는 것처럼 보인다.
 * 병합할 때 tail 단이 **빈 문단만**으로 이뤄졌으면 통째로 버린다 — 빈 줄을 앞 단 끝에 붙이면 3↔2를
 * 오갈 때마다 빈 줄이 쌓이기 때문이다. 그 밖에는 **내부 빈 문단까지 그대로** 옮긴다(검토 경-3 —
 * 문단 사이 빈 줄도 사용자가 쓴 것이다). 내용이 있는 블록은 어느 경우에도 버리지 않는다.
 */
export function setColumnsCount(
  editor: NoteBlockNoteEditor,
  containerId: string,
  count: 2 | 3,
): void {
  const current = editor.getBlock(containerId)
  if (!current || current.type !== 'columns') return

  // 정규화와 같은 규칙으로 먼저 정규 자식 목록을 얻는다(비정규 자식이 섞여 있어도 손실 0).
  const normalized = normalizedColumnsChildren(current as any)
  const cells = normalized.children.map((cell) => ({
    id: cell.id,
    children: [...(cell.children ?? [])],
  }))

  while (cells.length > count) {
    const tail = cells.pop()
    const tailKids = tail?.children ?? []
    // 검토 경-3 — tail 단의 **내부** 빈 문단은 보존한다(문단 사이 빈 줄도 사용자가 쓴 레이아웃이다).
    // 버리는 것은 tail이 **빈 문단만으로** 이뤄졌을 때뿐이다(그때만 붙일 내용이 없다).
    const onlyBlank = tailKids.every((block) => isEmptyParagraph(block))
    if (tailKids.length > 0 && !onlyBlank) cells[cells.length - 1].children.push(...tailKids)
  }
  while (cells.length < count) cells.push({ id: undefined, children: [] })

  const children = cells.map((cell) => makeColumn(cell.children, cell.id))
  editor.replaceBlocks(
    [containerId],
    [
      {
        id: containerId,
        type: 'columns' as const,
        // 사용자가 단 수를 명시적으로 골랐으니 이제 `count`가 정본 — 유입 원문의 `n=abc` 같은
        // 비정수 속성 쌍은 여기서만 버린다(아래 `columnsMetaWithoutN` 주석).
        props: { count, meta: columnsMetaWithoutN(current.props.meta as string) },
        children: children as any,
      } as any,
    ],
  )
  editor.focus()
}

/**
 * [단 해제] — **1단→2단→3단 순서로** 각 단의 자식을 컨테이너 자리에 승격한다(`replaceBlocks` 1콜
 * = undo 1단위, 조용한 손실 0). 단이 아닌 자식(비정규)도 자리 순서 그대로 딸려 나온다. 결과가
 * 0개면 빈 문단 1개로 대체한다(빈 자리를 남기지 않는다).
 */
export function unwrapColumns(editor: NoteBlockNoteEditor, containerId: string): void {
  const current = editor.getBlock(containerId)
  if (!current) return
  const promoted: any[] = []
  for (const child of current.children ?? []) {
    if (child.type === 'column') promoted.push(...(child.children ?? []))
    else promoted.push(child)
  }
  const children = promoted.length > 0 ? promoted : [{ type: 'paragraph' as const }]
  editor.replaceBlocks([containerId], children as any)
  editor.focus()
}

/**
 * 단 수 토글 시 `meta` 주머니의 `attrs`에서 `n` 쌍을 떼어 낸다(1차 검토 경-1 · 2026-08-30). 유입
 * 원문이 정수가 아닌 `n`(`n=abc`·`n=2.5`)이면 파서가 그 쌍을 `attrs`에 통짜 보존하고, 직렬화는
 * "attrs에 `n`이 있으면 count 파생 `n`을 붙이지 않는다"(`blocksToMarkdown` — 원문 왕복 우선).
 * 그대로 두면 사용자가 2↔3을 바꿔도 저장 결과가 원문 `n=abc`로 돌아가 **조용히 무효화**된다.
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
