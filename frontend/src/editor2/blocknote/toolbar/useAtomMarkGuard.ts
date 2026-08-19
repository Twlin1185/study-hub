// 원자 서식 가드 — **코어 단축키까지 확장**(stage-36 F-8 · 규약 E).
//
// stage-34가 남긴 알려진 한계(`atoms.ts` 머리말 "알려진 한계"): 가드가 **방언 버튼과 Mod+U**에만
// 걸려 있어, 참조 칩·수식이 섞인 선택에서 `Ctrl+B`/`Ctrl+I`/`Ctrl+Shift+S`/`Ctrl+E`를 누르면
// 그 원자에 얹힌 코어 마크가 저장·재로드에서 조용히 사라졌다. 그 경로를 여기서 닫는다.
//
// **동작**: 선택에 원자 인라인이 없으면 **아무것도 하지 않는다**(BlockNote 기본 키맵이 그대로
// 돈다 — 이중 토글이 나지 않게 하는 것이 규약 C 래퍼와 같은 정신). 원자가 섞여 있을 때만
// 기본 동작을 막는다. 등록 위치가 `document` 캡처인 이유도 `useMicroMarkShortcuts`와 같다
// (ProseMirror가 편집 표면 노드에 먼저 리스너를 붙으므로 전파 경로의 맨 앞에서 끊어야 한다).
//
// 대상 키는 BlockNote 0.54가 실제로 등록한 코어 마크 단축키다(dist 실측:
// `Mod-b`/`Mod-B` 굵게 · `Mod-i`/`Mod-I` 기울임 · `Mod-Shift-s` 취소선 · `Mod-e` 코드).
// 밑줄(`Mod-u`)은 규약 C 래퍼가 이미 가드와 함께 가로챈다 — 여기서 중복 처리하지 않는다.
import { useEffect } from 'react'
import { useEditorDOMElement } from '@blocknote/react'
import { selectionHasAtomInline } from './atoms'
import type { NoteBlockNoteEditor } from '../schema'

/** 눌린 키가 코어 마크 단축키인가. */
function isCoreMarkShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  const key = event.key.toLowerCase()
  if (event.shiftKey) return key === 's' || event.code === 'KeyS'
  return key === 'b' || key === 'i' || key === 'e'
}

export function useAtomMarkGuard(editor: NoteBlockNoteEditor): void {
  const dom = useEditorDOMElement()
  useEffect(() => {
    if (!dom) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCoreMarkShortcut(event)) return
      if (!(event.target instanceof Node) || !dom.contains(event.target)) return
      // 원자가 없으면 손대지 않는다 — 기본 키맵이 정상 동작하는 경로다.
      if (!selectionHasAtomInline(editor)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [dom, editor])
}
