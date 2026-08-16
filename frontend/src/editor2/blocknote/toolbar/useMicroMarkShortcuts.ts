// 마이크로 마크 **단축키 래퍼**(강제 지점 ①의 나머지 절반 — 규약 C).
//
// BlockNote 기본 `underline`에는 Mod+U 단축키가 이미 달려 있다. 그대로 두면 툴바 버튼은 상호
// 배타를 지키는데 단축키만 규약을 우회한다(`==형광==` 위에 Ctrl+U → 두 마이크로 마크 공존 →
// Markdown 왕복 붕괴). 그래서 편집 표면 DOM에서 **캡처 단계로 가로채** 같은 커맨드로 돌린다.
//
// 새 단축키는 만들지 않는다 — 형광·스포일러의 단축키는 계획서에 없다(임의 확정 금지).
import { useEffect } from 'react'
import { useEditorDOMElement } from '@blocknote/react'
import { selectionHasAtomInline } from './atoms'
import { toggleMicroMark } from './microMarks'
import type { NoteBlockNoteEditor } from '../schema'

export function useMicroMarkShortcuts(editor: NoteBlockNoteEditor): void {
  const dom = useEditorDOMElement()
  useEffect(() => {
    if (!dom) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'u') return
      event.preventDefault()
      event.stopPropagation()
      // 원자 인라인이 섞인 선택에서는 아무것도 하지 않는다 — 저장 시 사라질 서식을 걸지 않는다
      // (`atoms.ts` 참조). 기본 동작도 함께 막혔으므로 조용한 손실 경로가 없다.
      if (selectionHasAtomInline(editor)) return
      toggleMicroMark(editor, 'underline')
    }
    dom.addEventListener('keydown', onKeyDown, true)
    return () => dom.removeEventListener('keydown', onKeyDown, true)
  }, [dom, editor])
}
