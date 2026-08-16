// 한글 조합 중 undo/redo 구제 래퍼 (stage-34 결함 U-1).
//
// **증상**: 한글을 치다가 `Ctrl+Z`를 누르면 아무 일도 일어나지 않는다. 영문이거나 조합이 끝난
// 뒤(스페이스·문장부호·방향키·클릭 이후)에는 정상 동작하므로 "가끔 안 먹는다"로 보인다.
//
// **원인(실측)**: `prosemirror-view`의 `editHandlers.keydown`이 맨 앞에서
// `if (inOrNearComposition(view)) return;` 으로 빠져나간다(dist/index.js). 그 함수는
// `view.composing`이면 무조건 true다. 즉 **조합 중에는 키맵 자체가 돌지 않는다** —
// BlockNote가 `Mod-z → editor.undo()`로 걸어 둔 바인딩도 예외가 아니다. 윈도우 한글 IME는
// 다음 자모·스페이스·이동 전까지 **현재 음절의 조합을 유지**하므로, 타이핑 직후의 `Ctrl+Z`는
// 사실상 항상 이 경로에 걸린다. (`inOrNearComposition`의 나머지 절반인 compositionEndedAt
// 유예는 Safari 한정이라 이 앱의 대상 환경에서는 무관하다.)
//
// **해법**: 편집 표면 안에서 난 `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y`를 `document` 캡처 단계에서
// 가로채되, **조합 중일 때만** 처리하고 나머지는 손대지 않고 흘려보낸다(기본 키맵이 그대로
// 돌아야 이중 undo가 안 난다 — 규약 C의 마이크로 마크 래퍼와 같은 정신).
// 조합 중이면 ① `blur()`로 IME에 **확정(commit)을 강제**하고 ② 조합 종료 처리가 끝난 뒤
// ③ 포커스를 되돌린 다음 `editor.undo()`/`redo()`를 **직접** 부른다(키맵을 우회하므로
// 위 early return과 무관하다).
//
// **딜레이 40ms의 근거(prosemirror-view 실측)**: `compositionend` 핸들러는
//   - `view.input.composing = false` (동기)
//   - 밀린 DOM 변경 반영 = `Promise.resolve().then(() => domObserver.flush())` (**마이크로태스크**)
//   - `scheduleComposeEnd(view, 20)` → `endComposition(view)` (**+20ms 타이머**)
// 순으로 움직인다. 40ms면 셋이 모두 끝난 뒤라 "조합분이 문서에 들어간 상태"에서 되돌리게 된다.
// 0ms로 당기면 +20ms의 `endComposition`과 경합해 undo 직후 조합분이 다시 얹히는 경로가 생긴다.
import { useEffect } from 'react'
import { useEditorDOMElement } from '@blocknote/react'
import type { NoteBlockNoteEditor } from '../schema'

/** 조합 종료(마이크로태스크 flush + 20ms endComposition)를 모두 넘긴 뒤 되돌리기까지의 대기(ms). */
const COMPOSITION_SETTLE_MS = 40

export function useHistoryShortcuts(editor: NoteBlockNoteEditor): void {
  const dom = useEditorDOMElement()
  useEffect(() => {
    if (!dom) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      // 조합 중에는 `event.key`가 'Process'로 오는 IME가 있어 물리 키(`code`)로도 판정한다.
      const key = event.key.toLowerCase()
      const isZ = key === 'z' || event.code === 'KeyZ'
      const isY = key === 'y' || event.code === 'KeyY'
      if (!isZ && !isY) return
      // 편집 표면 밖(제목 입력란·피커 검색창 등)은 건드리지 않는다.
      if (!(event.target instanceof Node) || !dom.contains(event.target)) return

      const view = editor.prosemirrorView
      // 조합 중이 아니면 **아무것도 하지 않는다** — BlockNote 기본 키맵이 정상 동작하는 경로다.
      if (!view.composing) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      const rewind = isY || event.shiftKey ? () => editor.redo() : () => editor.undo()
      // blur = IME에 조합 확정 강제. 확정분은 하나의 히스토리 단계로 문서에 들어가고,
      // 이어지는 undo가 그 단계를 되돌린다(= 사용자가 기대하는 "방금 친 글자 취소").
      dom.blur()
      window.setTimeout(() => {
        view.focus()
        rewind()
      }, COMPOSITION_SETTLE_MS)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [dom, editor])
}
