// 원자 인라인 가드 **구독 훅**(stage-47 F-2 · FB-6-후속① · 규약 B) — 부유(`NoteFormattingToolbar`)·
// 도킹(`DockedFormattingToolbar`) 툴바가 `blocked`를 **같은 훅 1개**로 얻는다.
//
// 판정 자체는 `selectionHasAtomInline`(`atoms.ts`) 그대로다. 바뀐 것은 **구독 폭**: 종전에는
// `useEditorSelectionChange`(tiptap `"selectionUpdate"`)만 구독해 선택의 숫자 좌표(anchor/head)가
// 그대로인 트랜잭션(예: 선택 범위 안 원자가 명령으로 바뀌는 경우)에서는 갱신이 누락됐다.
// `useSelectedBlockTypes`(`blockFilter.ts`)와 같은 정책으로 **내용 변경**(`useEditorChange` —
// `docChanged`인 트랜잭션마다)도 함께 구독한다.
//
// 리렌더 절제: `useCallback([editor])`로 콜백을 고정하고(안 그러면 두 훅이 렌더마다 구독
// 해제·재등록), 함수형 갱신에서 값이 같으면 이전 값을 돌려줘 setState를 생략한다 — 불필요한
// 리렌더가 엔진 `useFocusTrap`을 재발화시키던 회귀 전례(stage-40 검토) 때문이다.
import { useCallback, useState } from 'react'
import { useEditorChange, useEditorSelectionChange } from '@blocknote/react'
import type { NoteBlockNoteEditor } from '../schema'
import { selectionHasAtomInline } from './atoms'

/** 지금 선택에 원자 인라인이 섞여 텍스트 서식을 막아야 하는가 — 선택·내용 변경 모두에 갱신. */
export function useAtomInlineGuard(editor: NoteBlockNoteEditor): boolean {
  const [blocked, setBlocked] = useState(() => selectionHasAtomInline(editor))
  const recompute = useCallback(() => {
    setBlocked((prev) => {
      const next = selectionHasAtomInline(editor)
      return prev === next ? prev : next
    })
  }, [editor])
  useEditorSelectionChange(recompute, editor)
  useEditorChange(recompute, editor)
  return blocked
}
