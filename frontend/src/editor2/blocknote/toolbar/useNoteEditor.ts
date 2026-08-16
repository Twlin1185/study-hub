// 편집기 UI ↔ 노트 스키마 **경계 캐스트 1곳**.
//
// `useBlockNoteEditor()`는 스키마를 모르는 제네릭 편집기를 돌려준다(컨텍스트에서 꺼내오므로 타입
// 인자를 잃는다). 툴바·피커는 노트 스키마의 블록/인라인/스타일을 이름으로 다루므로 여기서 한 번만
// 좁히고, 나머지 파일에는 캐스트를 두지 않는다(`blocknote/schema.ts`의 경계 캐스트 관례와 같은 취지).
import { useBlockNoteEditor } from '@blocknote/react'
import type { NoteBlockNoteEditor } from '../schema'

export function useNoteEditor(): NoteBlockNoteEditor {
  return useBlockNoteEditor() as unknown as NoteBlockNoteEditor
}
