// 웹 임베드 블록 삽입(stage-37 F-4 · 규약 B) — "조회 실패에도 삽입 성립"의 실제 이행 지점.
//
// `preview`가 `null`이면(조회를 안 했거나 실패) `title`·`meta` 없이 URL만의 블록을 넣는다 —
// 그것이 §4.30의 계약대로 **정상 상태**다(제목 없는 카드 → 렌더 쪽에서 도메인으로 대체 표시).
import type { NoteBlockNoteEditor } from '../schema'
import type { WebEmbedPreview } from './api'

function cursorBlockIsEmptyParagraph(editor: NoteBlockNoteEditor): boolean {
  const block = editor.getTextCursorPosition().block
  if (block.type !== 'paragraph') return false
  const content: unknown = block.content
  return Array.isArray(content) && content.length === 0
}

/** §4.30 응답 → 블록 prop `meta`(JSON 문자열). url·title은 블록 자신의 필드라 여기 담지 않는다. */
function encodeMeta(preview: WebEmbedPreview): string {
  const meta = {
    description: preview.description,
    siteName: preview.siteName,
    image: preview.image,
    favicon: preview.favicon,
    fetchedAt: preview.fetchedAt,
  }
  return JSON.stringify(meta)
}

export function insertWebEmbedBlock(
  editor: NoteBlockNoteEditor,
  url: string,
  preview: WebEmbedPreview | null,
): void {
  if (!url) return
  const props = {
    url,
    title: preview?.title ? preview.title : '',
    meta: preview ? encodeMeta(preview) : '',
  }
  const current = editor.getTextCursorPosition().block
  const block = { type: 'webEmbed' as const, props }
  if (cursorBlockIsEmptyParagraph(editor)) {
    editor.replaceBlocks([current.id], [block])
  } else {
    editor.insertBlocks([block], current.id, 'after')
  }
  editor.focus()
}
