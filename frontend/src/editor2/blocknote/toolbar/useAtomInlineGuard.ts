// 원자 인라인 가드 **구독 훅**(stage-47 F-2 · FB-6-후속① · 규약 B) — 부유(`NoteFormattingToolbar`)·
// 도킹(`DockedFormattingToolbar`) 툴바가 `blocked`를 **같은 훅 1개**로 얻는다.
//
// 판정 자체는 `selectionHasAtomInline`(`atoms.ts`) 그대로다. stage-48 FB-22로 구독 배선을
// `useEditorDerived`(모듈 스코프 `compute`를 받는 일반화 버전)로 옮겼다 — 동작은 이전과 동일하다
// (선택·내용 변경 모두 구독, 값이 같으면 setState 생략). 이 파일이 남아 있는 것은 호출부
// (`useAtomInlineGuard(editor)`)가 boolean 하나만 받는 편이 파라미터를 매번 넘기는 것보다
// 읽기 쉬워서다.
import { useEditorDerived } from './useEditorDerived'
import type { NoteBlockNoteEditor } from '../schema'
import { selectionHasAtomInline } from './atoms'

/** 지금 선택에 원자 인라인이 섞여 텍스트 서식을 막아야 하는가 — 선택·내용 변경 모두에 갱신. */
export function useAtomInlineGuard(editor: NoteBlockNoteEditor): boolean {
  return useEditorDerived(editor, selectionHasAtomInline)
}
