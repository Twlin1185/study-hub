// 편집 표면의 **방언 UI 묶음** — `<BlockNoteView>`의 children으로 한 줄만 놓으면 된다.
//
// 여기 있는 것: 방언 서식 툴바(G-2) · **슬래시 메뉴 전수표**(stage-36 F-5) · 마이크로 마크 단축키 래퍼 ·
// 원자 서식 가드의 코어 단축키 확장(F-8) · 한글 조합 중 undo/redo 구제 래퍼(결함 U-1) ·
// 표 열 정렬 바(F-6) · 찾기/바꾸기 패널(F-7).
// 참조 피커·칩 팝오버는 `RefUiProvider`가 **BlockNoteView 바깥**에서 띄운다(칩 노드 뷰가 그 컨텍스트를
// 구독해야 하고, 툴바가 닫혀도 피커는 살아 있어야 하기 때문).
//
// `BlockNoteView`에는 `formattingToolbar={false} slashMenu={false}`만 넘기면 된다 — 나머지 기본 UI
// (**사이드 메뉴·드래그 핸들**·링크 툴바·표 핸들·이모지)는 그대로 살아 있다(`BlockNoteDefaultUI` 실측).
// 드래그 재배열(F-5)이 코어 사이드 메뉴 그대로인 이유가 이것이다 — 끄지 않았으므로 켜져 있다.
import { FormattingToolbarController, SuggestionMenuController } from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { useRefPickerCommands } from './refPicker/RefUiProvider'
import FindReplacePanel from './find/FindReplacePanel'
import { buildSlashItems } from './slash/slashItems'
import TableAlignBar from './tableAlign/TableAlignBar'
import NoteFormattingToolbar from './toolbar/NoteFormattingToolbar'
import { useAtomMarkGuard } from './toolbar/useAtomMarkGuard'
import { useHistoryShortcuts } from './toolbar/useHistoryShortcuts'
import { useMicroMarkShortcuts } from './toolbar/useMicroMarkShortcuts'
import { useNoteEditor } from './toolbar/useNoteEditor'

export default function NoteEditorDialectUI() {
  const editor = useNoteEditor()
  const { openPicker } = useRefPickerCommands()
  useMicroMarkShortcuts(editor)
  // 원자가 섞인 선택에서 코어 마크 단축키를 막는다(F-8 — 그 밖에는 무개입).
  useAtomMarkGuard(editor)
  // 한글 조합 중 Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y 구제(결함 U-1) — 조합 중이 아닐 때는 무개입.
  useHistoryShortcuts(editor)

  return (
    <>
      <FormattingToolbarController formattingToolbar={NoteFormattingToolbar} />
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => filterSuggestionItems(buildSlashItems(editor, openPicker), query)}
      />
      {/* 표면 부속 패널 — 화면 오른쪽 아래에 고정한다(문서가 길어도 따라다닌다).
          둘 다 조건부라 아무것도 없을 때는 클릭을 가로채지 않는다(`pointer-events` — notes.css). */}
      <div className="editor2-surface-overlay">
        <TableAlignBar />
        <FindReplacePanel />
      </div>
    </>
  )
}
