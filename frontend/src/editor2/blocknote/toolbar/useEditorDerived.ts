// 파생값 구독 훅(stage-48 FB-22 · 규약 B) — `useAtomInlineGuard`(stage-47 F-2)가 원자 인라인
// 가드 1개에만 쓰던 패턴을, 에디터 상태에서 뽑아내는 임의의 파생값(T)로 일반화한다. `blocked`
// (boolean)·`target`(`CropTarget | null`)처럼 선택·내용이 바뀔 때마다 다시 계산해야 하는 값이면
// 어디든 이 훅 하나로 통일한다.
//
// 구독 폭은 `useAtomInlineGuard`와 같다: 선택 좌표만 구독하는 `useEditorSelectionChange`(tiptap
// `"selectionUpdate"`) 하나로는 좌표가 그대로인 트랜잭션(예: 선택 범위 안 내용이 명령으로 바뀌는
// 경우)에서 갱신이 누락된다 — `useEditorChange`(`docChanged`)도 함께 구독한다.
//
// 리렌더 절제: `compute`·`isEqual`은 **호출부가 모듈 스코프 함수로 넘긴다**(렌더마다 새 클로저를
// 넘기면 `useCallback([editor, compute, isEqual])`의 의존성이 매 렌더 바뀌어 두 구독 훅이 매번
// 해제·재등록된다 — `useFocusTrap` 재발화 회귀 전례, stage-40 검토). 함수형 갱신에서
// `isEqual(prev, next)`면 이전 값을 그대로 돌려줘 불필요한 setState도 생략한다.
import { useCallback, useState } from 'react'
import { useEditorChange, useEditorSelectionChange } from '@blocknote/react'
import type { NoteBlockNoteEditor } from '../schema'

/** 에디터의 지금 선택·내용에서 뽑아낸 파생값 T — 선택·내용 변경 모두에 갱신. */
export function useEditorDerived<T>(
  editor: NoteBlockNoteEditor,
  compute: (editor: NoteBlockNoteEditor) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const [value, setValue] = useState(() => compute(editor))
  const recompute = useCallback(() => {
    setValue((prev) => {
      const next = compute(editor)
      return isEqual(prev, next) ? prev : next
    })
  }, [editor, compute, isEqual])
  useEditorSelectionChange(recompute, editor)
  useEditorChange(recompute, editor)
  return value
}
