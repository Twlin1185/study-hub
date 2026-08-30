// 편집 표면의 **방언 UI 묶음** — `<BlockNoteView>`의 children으로 한 줄만 놓으면 된다.
//
// 여기 있는 것: 방언 서식 툴바(G-2) · **슬래시 메뉴 전수표**(stage-36 F-5) · 마이크로 마크 단축키 래퍼 ·
// 원자 서식 가드의 코어 단축키 확장(F-8) · 한글 조합 중 undo/redo 구제 래퍼(결함 U-1) ·
// 표 열 정렬 바(F-6) · 찾기/바꾸기 패널(F-7) · 웹 임베드 URL 삽입 패널(stage-37 F-4).
// 참조 피커·칩 팝오버는 `RefUiProvider`가 **BlockNoteView 바깥**에서 띄운다(칩 노드 뷰가 그 컨텍스트를
// 구독해야 하고, 툴바가 닫혀도 피커는 살아 있어야 하기 때문). 웹 임베드 삽입 패널은 그런 조건이
// 없다(칩처럼 편집기 밖 노드 뷰가 여는 게 아니라 **이 슬래시 메뉴 하나**만 연다) — 그래서 별도
// Provider 없이 이 컴포넌트가 직접 상태를 들고 있다가 렌더한다.
//
// `BlockNoteView`에는 `formattingToolbar={false} slashMenu={false} sideMenu={false}`를 넘긴다 —
// 나머지 기본 UI(링크 툴바·표 핸들·이모지)는 그대로 살아 있다(`BlockNoteDefaultUI` 실측).
// 사이드 메뉴는 stage-41 2차부터 **여기서 되건다**(`SideMenuController` + `ColumnAwareSideMenu`) —
// 단(`column`) 위에서만 감추고 그 밖에는 코어와 동일하다. 드래그 재배열(F-5)은 그대로다.
import { useState } from 'react'
import {
  FormattingToolbarController,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useExtensionState,
} from '@blocknote/react'
import { SideMenuExtension, filterSuggestionItems } from '@blocknote/core/extensions'
import { useRefPickerCommands } from './refPicker/RefUiProvider'
import FindReplacePanel from './find/FindReplacePanel'
import { buildSlashItems } from './slash/slashItems'
import TableAlignBar from './tableAlign/TableAlignBar'
import DockedFormattingToolbar from './toolbar/DockedFormattingToolbar'
import NoteFormattingToolbar from './toolbar/NoteFormattingToolbar'
import { useAtomMarkGuard } from './toolbar/useAtomMarkGuard'
import { useHistoryShortcuts } from './toolbar/useHistoryShortcuts'
import { useMicroMarkShortcuts } from './toolbar/useMicroMarkShortcuts'
import { useNoteEditor } from './toolbar/useNoteEditor'
import WebEmbedInsertPanel from './webEmbed/WebEmbedInsertPanel'

/**
 * 사이드 메뉴(＋ 추가·드래그 핸들) — **단(`column`) 위에서는 감춘다**(stage-41 규약 B 2차).
 * 셀을 통째로 끌어내면 `columns` 구조가 깨지고(정규화가 되돌리느라 깜빡인다) 단 자체를 다른 곳에
 * 떨어뜨리는 조작은 우리 UX에 없기 때문이다. **다른 블록은 기본 `SideMenu` 그대로**이고
 * `columns` 컨테이너 자신도 핸들을 유지한다(통째 이동·삭제).
 *
 * 0.54의 커스텀 `sideMenu`는 **props를 받지 않는다**(`SideMenuController`가 `<Component />`로만
 * 렌더한다 — node_modules 실측). 그래서 대상 블록은 사이드 메뉴 확장의 상태 저장소에서 직접 읽는다.
 */
function ColumnAwareSideMenu() {
  const blockType = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block?.type as string | undefined,
  })
  if (blockType === 'column') return null
  return <SideMenu />
}

export default function NoteEditorDialectUI() {
  const editor = useNoteEditor()
  const { openPicker } = useRefPickerCommands()
  useMicroMarkShortcuts(editor)
  // 원자가 섞인 선택에서 코어 마크 단축키를 막는다(F-8 — 그 밖에는 무개입).
  useAtomMarkGuard(editor)
  // 한글 조합 중 Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y 구제(결함 U-1) — 조합 중이 아닐 때는 무개입.
  useHistoryShortcuts(editor)

  const [webEmbedPanel, setWebEmbedPanel] = useState<{ rect: DOMRect | null } | null>(null)
  const openWebEmbedPanel = () => setWebEmbedPanel({ rect: editor.getSelectionBoundingBox() ?? null })

  return (
    <>
      {/* 도킹 서식 툴바(stage-40 FB-9, 규약 A①②) — 부유 컨트롤러와 병행. DOM 순서는 여기지만
          CSS `order`(notes.css)로 편집 표면 최상단·sticky에 앉힌다(구현 재량 — 규약 A①). */}
      <DockedFormattingToolbar />
      <FormattingToolbarController formattingToolbar={NoteFormattingToolbar} />
      {/* 기본 사이드 메뉴를 끄고(`BlockNoteView sideMenu={false}`) 같은 것을 여기서 되건다 —
          단(`column`)에서만 null(위 주석). */}
      <SideMenuController sideMenu={ColumnAwareSideMenu} />
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(buildSlashItems(editor, openPicker, openWebEmbedPanel), query)
        }
      />
      {webEmbedPanel && (
        <WebEmbedInsertPanel
          editor={editor}
          rect={webEmbedPanel.rect}
          onClose={() => setWebEmbedPanel(null)}
        />
      )}
      {/* 표면 부속 패널 — 화면 오른쪽 아래에 고정한다(문서가 길어도 따라다닌다).
          둘 다 조건부라 아무것도 없을 때는 클릭을 가로채지 않는다(`pointer-events` — notes.css). */}
      <div className="editor2-surface-overlay">
        <TableAlignBar />
        <FindReplacePanel />
      </div>
    </>
  )
}
