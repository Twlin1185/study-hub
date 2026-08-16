// 노트 편집 표면의 **방언 UI 묶음** — `<BlockNoteView>`의 children으로 한 줄만 놓으면 된다.
//
// 여기 있는 것: 방언 서식 툴바(G-2) · 슬래시 메뉴 참조 3항목(규약 A ①) · 마이크로 마크 단축키 래퍼 ·
// 한글 조합 중 undo/redo 구제 래퍼(결함 U-1).
// 참조 피커·칩 팝오버는 `RefUiProvider`가 **BlockNoteView 바깥**에서 띄운다(칩 노드 뷰가 그 컨텍스트를
// 구독해야 하고, 툴바가 닫혀도 피커는 살아 있어야 하기 때문).
//
// `BlockNoteView`에는 `formattingToolbar={false} slashMenu={false}`만 넘기면 된다 — 나머지 기본 UI
// (사이드 메뉴·드래그 핸들·링크 툴바·표 핸들·이모지)는 그대로 살아 있다(`BlockNoteDefaultUI` 실측).
import { FormattingToolbarController, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { useRefPickerCommands } from './refPicker/RefUiProvider'
import NoteFormattingToolbar from './toolbar/NoteFormattingToolbar'
import { refSlashItems } from './toolbar/refSlashItems'
import { useHistoryShortcuts } from './toolbar/useHistoryShortcuts'
import { useMicroMarkShortcuts } from './toolbar/useMicroMarkShortcuts'
import { useNoteEditor } from './toolbar/useNoteEditor'

export default function NoteEditorDialectUI() {
  const editor = useNoteEditor()
  const { openPicker } = useRefPickerCommands()
  useMicroMarkShortcuts(editor)
  // 한글 조합 중 Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y 구제(결함 U-1) — 조합 중이 아닐 때는 무개입.
  useHistoryShortcuts(editor)

  return (
    <>
      <FormattingToolbarController formattingToolbar={NoteFormattingToolbar} />
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            [...getDefaultReactSlashMenuItems(editor), ...refSlashItems(openPicker)],
            query,
          )
        }
      />
    </>
  )
}
