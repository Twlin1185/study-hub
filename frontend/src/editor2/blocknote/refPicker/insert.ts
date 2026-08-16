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
