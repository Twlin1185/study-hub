// 슬래시 메뉴 항목 **조달 지점**(stage-36 F-5) — 표는 `slashTable.ts`가 갖고 있다.
//
// 이 파일만 편집기 패키지(`@blocknote/react`·`@blocknote/math-block`)를 런타임에 import한다.
// 조립 규칙(순서·그룹·별칭)은 `composeSlashItems`가 전부 담당하며, 그쪽은 편집기 없이도 돌아
// 검증 스크립트(`scripts/s36-editor-ux.mjs` 계열 ①)가 전수표를 그대로 시험할 수 있다.
import { getDefaultReactSlashMenuItems } from '@blocknote/react'
import type { DefaultReactSuggestionItem } from '@blocknote/react'
import { getMathSlashMenuItems } from '@blocknote/math-block'
import type { RefKind } from '../refPicker/RefTitleContext'
import type { NoteBlockNoteEditor } from '../schema'
import { composeSlashItems } from './slashTable'

export function buildSlashItems(
  editor: NoteBlockNoteEditor,
  openPicker: (mode: RefKind) => void,
): DefaultReactSuggestionItem[] {
  return composeSlashItems(
    getDefaultReactSlashMenuItems(editor),
    getMathSlashMenuItems(editor) as DefaultReactSuggestionItem[],
    editor,
    openPicker,
  )
}
