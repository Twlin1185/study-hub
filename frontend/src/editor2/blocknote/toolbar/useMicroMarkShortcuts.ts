// 마이크로 마크 **단축키 래퍼**(강제 지점 ①의 나머지 절반 — 규약 C).
//
// BlockNote 기본 `underline`에는 Mod+U 단축키가 이미 달려 있다. 그대로 두면 툴바 버튼은 상호
// 배타를 지키는데 단축키만 규약을 우회한다(`==형광==` 위에 Ctrl+U → 두 마이크로 마크 공존 →
// Markdown 왕복 붕괴). 그래서 그 키를 가로채 같은 커맨드(`toggleMicroMark`)로 돌린다.
//
// **어디에 등록하는가 — `document` 캡처(+ 편집 표면 포함 여부로 게이트)**:
//   `editor.domElement`는 ProseMirror의 contenteditable **그 자체**이고, PM은 바로 그 노드에
//   keydown 리스너를 (뷰 생성 시점에 = 이 effect보다 **먼저**) 붙인다. 같은 노드에 capture 플래그로
//   등록해도 이벤트가 그 노드를 target으로 하면 **AT_TARGET 단계**라 capture/bubble 구분이 없고
//   **등록 순서**대로 실행된다 — 즉 PM이 먼저 토글하고 우리가 한 번 더 토글해 무효화·이중 토글이
//   난다. `stopPropagation`은 **같은 노드의 다른 리스너를 막지 못한다**.
//   그래서 전파 경로의 **맨 앞**인 `document`에 capture로 붙는다. 캡처 단계에서 부른
//   `stopPropagation`은 다음 노드(=편집 표면)로의 전달 자체를 끊으므로 PM 핸들러가 아예 돌지 않는다
//   (같은 노드 보험으로 `stopImmediatePropagation`도 함께 부른다). 전역 리스너지만 편집 표면 안에서
//   난 키만 처리하도록 `dom.contains(target)`로 좁히므로 피커·툴바 입력창에는 영향이 없다.
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
      // `code` 대체 판정(stage-46 F-3): 한글 IME 조합 중에는 `key`가 `Process`로 들어오고,
      // 비-US 배열에서는 다른 문자로 들어온다 — 그때도 물리 U 키는 잡는다(`useAtomMarkGuard`가
      // `Mod+Shift+S`에 이미 쓰는 관례와 같다). Mod+U는 원래 물리 키 기준 단축키다.
      if (event.key.toLowerCase() !== 'u' && event.code !== 'KeyU') return
      // 편집 표면 밖(피커 검색창·툴바 입력란 등)의 Ctrl+U는 건드리지 않는다.
      if (!(event.target instanceof Node) || !dom.contains(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      // 원자 인라인이 섞인 선택에서는 아무것도 하지 않는다 — 저장 시 사라질 서식을 걸지 않는다
      // (`atoms.ts` 참조). 기본 동작도 함께 막혔으므로 조용한 손실 경로가 없다.
      if (selectionHasAtomInline(editor)) return
      toggleMicroMark(editor, 'underline')
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [dom, editor])
}
