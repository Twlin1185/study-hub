// 참조 칩·임베드 블록·콜아웃 **삽입 커맨드** — 규약 A ①②의 실행 지점.
//
// 여기 있는 모든 함수는 다음 두 계약을 지킨다:
//   ① 대상(`target`)은 **피커가 고른 값만** 받는다 — 자유 입력 경로가 없다(규약 B).
//   ② `replaceSelection`이 명시적으로 참일 때만 선택을 덮어쓴다. 그 외에는 **선택을 접고 커서 위치에**
//      삽입한다 — 사용자의 글자가 조용히 사라지는 경로를 만들지 않는다(규약 A ②).
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

// ---------------------------------------------------------------- 다단(columns · stage-41 규약 B)
//
// "커서/선택이 columns 또는 콜아웃 **안**인지" 판정(원자 가드 관례와 같은 결 — 숨기지 않고 비활성
// + 사유). `getParentBlock`은 바로 위 1단계만 주므로 뿌리까지 반복해서 걷는다.
function blockHasColumnsOrCalloutAncestor(editor: NoteBlockNoteEditor, blockId: string): boolean {
  let current = blockId
  for (;;) {
    const parent = editor.getParentBlock(current)
    if (!parent) return false
    if (parent.type === 'columns' || parent.type === 'callout') return true
    current = parent.id
  }
}

/**
 * "다단 넣기" 차단 판정(착수 전 결정 ③) — 커서/선택이 columns·콜아웃 **안**이거나, 선택에 columns
 * 블록 자신이 최상위로 포함돼 있으면(그대로 감싸면 columns-안-columns가 된다) 막는다. 콜아웃을
 * 감싸는 것은 허용된다(콜아웃 안 columns만 금지 — columns 안 콜아웃은 허용, 자식 제한 0).
 */
export function columnsInsertBlocked(editor: NoteBlockNoteEditor): boolean {
  try {
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
    return blocks.some(
      (block) => block.type === 'columns' || blockHasColumnsOrCalloutAncestor(editor, block.id),
    )
  } catch {
    return false
  }
}

/**
 * 다단(columns) 삽입 — 선택 블록이 있으면 그 블록들을 자식으로 감싸고(`wrapInColumns`), 없으면
 * 빈 문단 1개를 자식으로 하는 빈 컨테이너를 커서 자리에 넣는다. **중첩 차단은 호출자 책임**
 * (슬래시·툴바가 `columnsInsertBlocked`로 각자 가드한다 — 이 함수 자체는 방어하지 않는다,
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
  const block = {
    type: 'columns' as const,
    props: { count, meta: '' },
    children: [{ type: 'paragraph' as const }],
  }
  const inserted = cursorBlockIsEmptyParagraph(editor)
    ? editor.replaceBlocks([current.id], [block]).insertedBlocks
    : editor.insertBlocks([block], current.id, 'after')
  const child = inserted[0]?.children?.[0]
  if (child) editor.setTextCursorPosition(child.id, 'start')
  editor.focus()
}

/**
 * 선택된 최상위 블록들을 columns 컨테이너의 자식으로 감싼다 — 원래 블록(id 포함)을 그대로
 * `children`으로 넘기고 `replaceBlocks`로 제자리 치환한다(엔진이 같은 트랜잭션 안에서 id를
 * 재사용해도 안전 — `removeAndInsertBlocks` 실측: 삽입이 먼저, 원본 삭제는 그 뒤라 일시적으로
 * id가 겹쳐도 최종 문서에서는 하나만 남는다). id를 보존하므로 감싸진 블록(예: 제목)을 가리키는
 * 앵커 칩이 깨지지 않는다. 한 번의 `replaceBlocks` = undo 1단위.
 */
export function wrapInColumns(
  editor: NoteBlockNoteEditor,
  blocks: readonly { id: string }[],
  count: 2 | 3,
): void {
  if (blocks.length === 0) return
  const ids = blocks.map((b) => b.id)
  const container = {
    type: 'columns' as const,
    props: { count, meta: '' },
    children: blocks as any,
  }
  editor.replaceBlocks(ids, [container])
  editor.focus()
}

/**
 * [단 해제] — 컨테이너 자리에 자식 블록을 순서대로 승격한다(`replaceBlocks` 1콜 = undo 1단위,
 * 조용한 손실 0). 자식이 0이면(이론상 — 빈 컨테이너는 편집기 쪽 정리가 상시 없앤다) 빈 문단
 * 1개로 대체한다.
 */
export function unwrapColumns(editor: NoteBlockNoteEditor, containerId: string): void {
  const current = editor.getBlock(containerId)
  if (!current) return
  const children = current.children && current.children.length > 0 ? current.children : [{ type: 'paragraph' as const }]
  editor.replaceBlocks([containerId], children as any)
  editor.focus()
}
