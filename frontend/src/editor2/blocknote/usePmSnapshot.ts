// ProseMirror 플러그인 상태를 React로 끌어오는 **구독 훅 1개**(stage-36 F-6·F-7 공용).
//
// 왜 `useEditorState`(@blocknote/react)를 쓰지 않는가: 찾기/바꾸기·표 열 정렬은 **문서를 바꾸지
// 않는 meta 전용 트랜잭션**으로도 상태가 움직인다(검색어 입력·정렬 선택). 문서 변경/선택 변경
// 이벤트에만 붙는 구독은 그 경우를 놓친다. tiptap의 `transaction` 이벤트는 **모든 트랜잭션**에
// 대해 한 번씩 발화하므로 이 두 기능의 단일 구독 지점으로 정확하다.
// (`_tiptapEditor` 직접 접근은 `refPicker/insert.ts`의 `setTextSelection` 전례를 따른다.)
import { useEffect, useState } from 'react'
import type { EditorState } from 'prosemirror-state'
import type { BlockNoteEditor } from '@blocknote/core'

/**
 * `read(state)`의 결과를 들고 있다가 트랜잭션마다 다시 읽는다.
 * `equal`로 값이 같다고 판정되면 리렌더하지 않는다(매 키 입력마다 패널이 다시 그려지지 않게).
 *
 * `idle`은 **뷰가 아직 없을 때**(첫 렌더 — BlockNoteView children은 편집기 mount 콜백보다 먼저
 * 그려진다. `prosemirrorView`는 `_tiptapEditor.view`이고 코어도 `?.`로 다룬다) 쓰는 값이다.
 * mount 직후 effect가 곧바로 다시 읽으므로 이 값이 화면에 오래 남지 않는다.
 *
 * 편집기 타입은 **스키마 제네릭에 무관하게 느슨히**(`BlockNoteEditor<any, any, any>`) 받는다 —
 * 이 훅이 쓰는 멤버(`prosemirrorView`·`_tiptapEditor`)는 스키마와 무관하고, 커스텀 블록 스펙의
 * `render(({ editor }) => …)`가 주는 `editor`는 **그 블록 하나만의 스키마로 좁혀진 타입**이라
 * (stage-37 F-3 `TocBlockRender`) 화면 전체 스키마 타입(`NoteBlockNoteEditor`)과 구조적으로
 * 안 맞는다(TS2345 실측). 호출부가 무엇을 넘기든(화면 전체 스키마든 블록 하나짜리든) 받는다.
 */
export function usePmSnapshot<T>(
  editor: BlockNoteEditor<any, any, any>,
  read: (state: EditorState) => T,
  equal: (a: T, b: T) => boolean,
  idle: T,
): T {
  const [snapshot, setSnapshot] = useState<T>(() => {
    const state = editor.prosemirrorView?.state
    return state ? read(state) : idle
  })

  useEffect(() => {
    const tiptap = editor._tiptapEditor
    const sync = () => {
      const state = editor.prosemirrorView?.state
      const next = state ? read(state) : idle
      setSnapshot((prev) => (equal(prev, next) ? prev : next))
    }
    sync()
    tiptap.on('transaction', sync)
    return () => {
      tiptap.off('transaction', sync)
    }
    // `read`·`equal`·`idle`은 모듈 스코프 상수로 넘기는 것이 전제다(매 렌더 새 값이면 구독이 요동친다).
  }, [editor, read, equal, idle])

  return snapshot
}
