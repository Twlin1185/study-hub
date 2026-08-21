// 목차(TOC) 블록 삽입 커맨드(stage-37 F-3) — 슬래시 메뉴 전용 진입점 1개.
//
// `docEmbed`/`callout` 삽입(`refPicker/insert.ts`)과 같은 관례: 커서가 빈 문단이면 그 문단을
// 블록으로 대체하고, 아니면 커서 블록 뒤에 끼워 넣는다. TOC는 원자(`content: 'none'`)라 자식 삽입이
// 없다는 점만 다르다.
import type { NoteBlockNoteEditor } from '../schema'

function cursorBlockIsEmptyParagraph(editor: NoteBlockNoteEditor): boolean {
  const block = editor.getTextCursorPosition().block
  if (block.type !== 'paragraph') return false
  const content: unknown = block.content
  return Array.isArray(content) && content.length === 0
}

export function insertTocBlock(editor: NoteBlockNoteEditor): void {
  const current = editor.getTextCursorPosition().block
  const block = { type: 'toc' as const }
  if (cursorBlockIsEmptyParagraph(editor)) {
    editor.replaceBlocks([current.id], [block])
  } else {
    editor.insertBlocks([block], current.id, 'after')
  }
  editor.focus()
}
