// 도킹 서식 툴바 (stage-40 FB-9, 규약 A) — 편집 표면 상단에 상시 고정(sticky)되는 서식 툴바.
//
// 부유 툴바(`NoteFormattingToolbar` — `FormattingToolbarController`가 선택 시에만 띄운다)와
// **병행**한다(무변). 항목 구성은 `buildFormattingToolbarItems`(규약 A ③ 단일 출처)를 그대로
// 재사용하고, `<FormattingToolbar>`(`@blocknote/react`)를 컨트롤러(플로팅 포지셔너) 없이 이
// 고정 컨테이너에 직접 렌더한다 — `Components.FormattingToolbar.Root`는 순수 Flex 컨테이너라
// (`@blocknote/mantine` `toolbar/Toolbar.tsx` 실측 — 위치 지정은 `FormattingToolbarController`의
// floating-ui 래퍼가 담당하고 클래스 자체엔 위치 규칙이 없다) 컨트롤러 밖에서 써도 자리를 차지하지
// 않는 사고가 없다.
//
// **표면당 1개** — `NoteEditorDialectUI`가 `BlockNoteView`의 children으로 이 컴포넌트를 렌더하므로,
// `useNoteEditor()`가 그 `BlockNoteContext`(표면마다 새로 만들어진다)에서 편집기를 가져와 판정
// 기준이 자연히 "그 표면 편집기의 현재 선택/커서"가 된다(포커스 여부와 무관 — 레이아웃 점프 방지).
import { useState } from 'react'
import type { MouseEvent } from 'react'
import { useEditorSelectionChange, FormattingToolbar } from '@blocknote/react'
import { selectionHasAtomInline } from './atoms'
import { shouldShowTextFormattingGroup, useSelectedBlockTypes } from './blockFilter'
import { buildFormattingToolbarItems } from './NoteFormattingToolbar'
import { useNoteEditor } from './useNoteEditor'

/**
 * 규약 A ④ — 도킹 툴바 클릭이 편집기 선택을 잃게 해서는 안 된다. 부유 툴바는 플로팅 포털이
 * 알아서 처리하지만(초점이 옮겨가도 ProseMirror 선택은 유지) 도킹은 일반 DOM 흐름이라 버튼
 * 클릭 시 브라우저 기본 동작(포커스 이동)이 편집기 blur를 유발할 수 있다 — 버튼 대상
 * `mousedown`만 막는다(ProseMirror 메뉴바의 통상 관례). **입력 필드(`INPUT`/`TEXTAREA`)는
 * 제외** — 드롭다운 안 색 직접 입력(`HexInputRow`)·콜아웃 제목 입력이 포커스를 받아야 하기
 * 때문이다(막으면 타이핑이 안 된다).
 */
function preserveEditorSelectionOnMouseDown(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target as HTMLElement
  if (target.closest('input, textarea')) return
  if (target.closest('button')) event.preventDefault()
}

export default function DockedFormattingToolbar() {
  const editor = useNoteEditor()
  const [blocked, setBlocked] = useState(() => selectionHasAtomInline(editor))
  useEditorSelectionChange(() => setBlocked(selectionHasAtomInline(editor)))
  const blockTypes = useSelectedBlockTypes(editor)
  const showTextGroup = shouldShowTextFormattingGroup(blockTypes)

  return (
    <div className="editor2-docked-toolbar" onMouseDown={preserveEditorSelectionOnMouseDown}>
      <FormattingToolbar>{buildFormattingToolbarItems({ blocked, showTextGroup })}</FormattingToolbar>
    </div>
  )
}
