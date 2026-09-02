// 활성 서식 판정 **단일 출처**(stage-46 F-2 · 규약 D) — 접힌 커서의 **대기 마크**까지 본다.
//
// **왜 필요한가(FB-16·FB-17의 공통 뿌리)**: BlockNote 0.54의 `editor.getActiveStyles()`는
// `StyleManager.getActiveStyles()`(core dist `src-BkfZVfaO.js:2758~2769` 실측)에서
// **`selection.$to.marks()`만** 읽고 ProseMirror의 `state.storedMarks`를 보지 않는다.
// 접힌 커서에서 버튼·단축키로 마크를 걸면 그 마크는 문서가 아니라 `storedMarks`(대기 마크)에만
// 얹히므로, 코어 판정으로는 **아무 일도 일어나지 않은 것과 구분되지 않는다**. 그 결과가 두 가지다:
//   ① 표시 — `useActiveStyles()`의 값이 그대로라 버튼이 눌림(active)으로 바뀌지 않는다(FB-16).
//      덤으로 `useEditorState`의 깊은 비교(`fast-deep-equal`)가 "변화 없음"으로 판정해 **리렌더
//      자체가 생략**된다.
//   ② 판정 — `toggleMicroMark`(`microMarks.ts`)도 같은 값을 읽으므로 접힌 커서에서 **토글이 한
//      방향으로만** 간다(켠 뒤 다시 눌러도 계속 `addStyles` · 밑줄 구간 안에서 끈 뒤 다시 눌러도
//      계속 `removeStyles`). 사용자에게는 "Ctrl+U가 안 먹힌다"로 보인다(FB-17).
//
// **판정 규약**: ProseMirror에서 `storedMarks`는 "다음 입력에 붙을 마크 **전체 목록**"이다(문서에서
// 상속한 마크를 덧붙이는 것이 아니라 **대체**한다 — 그래서 빈 배열 `[]`은 "전부 해제"라는 뜻이지
// "정보 없음"이 아니다). 따라서:
//   - 선택이 접혀 있고 `storedMarks !== null` → **대기 마크만으로** 활성 서식을 만든다.
//   - 그 밖(선택 범위가 있거나 대기 마크가 없음) → 코어 `getActiveStyles()` 그대로.
// 매핑 규칙(mark 타입 → 스타일 키·값)은 코어와 **같은 규칙**을 쓴다(styleSchema 조회 · boolean은
// `true` · string은 `stringValue`) — 두 경로가 어긋나면 이중 토글이 난다.
import { useEditorState } from '@blocknote/react'
import type { NoteBlockNoteEditor } from '../schema'

/** 툴바가 다루는 활성 서식 뷰 — `{ bold: true, t: '[["c","red"]]' , … }` 꼴의 평평한 레코드. */
export type ActiveStyleRecord = Record<string, unknown>

type StyleConfigView = { type: string; propSchema: string }

/**
 * 접힌 커서의 대기 마크(`storedMarks`) → 활성 서식 레코드. 대기 마크가 없으면 `null`.
 *
 * 읽기 전용 `transact`다 — 트랜잭션을 변형하지 않으므로 dispatch되지 않는다(`atoms.ts`와 같은 관례).
 */
function pendingStyleRecord(editor: NoteBlockNoteEditor): ActiveStyleRecord | null {
  return editor.transact((tr) => {
    if (!tr.selection.empty) return null
    const stored = tr.storedMarks
    if (!stored) return null
    const styleSchema = editor.schema.styleSchema as unknown as Record<string, StyleConfigView | undefined>
    const out: ActiveStyleRecord = {}
    for (const mark of stored) {
      const config = styleSchema[mark.type.name]
      if (!config) continue
      out[config.type] = config.propSchema === 'boolean' ? true : mark.attrs.stringValue
    }
    return out
  })
}

/** 지금 활성인 서식(대기 마크 우선) — 커맨드 쪽(`microMarks`·`textStyle`)이 쓰는 비-훅 진입점. */
export function readActiveStyles(editor: NoteBlockNoteEditor): ActiveStyleRecord {
  return pendingStyleRecord(editor) ?? (editor.getActiveStyles() as unknown as ActiveStyleRecord)
}

/**
 * 툴바 버튼의 `isSelected` 판정용 훅 — `useActiveStyles()`를 **대체**한다(규약 D: 소비 지점이
 * 공용 헬퍼 1곳을 거친다).
 *
 * `useActiveStyles()`를 그대로 쓰지 못하는 이유는 머리말 ① — 그 훅의 selector가 코어
 * `getActiveStyles()`라 대기 마크만 바뀐 트랜잭션에서는 값이 같아 리렌더가 생략된다. 같은 구독
 * 기구(`useEditorState`, `on: 'all'` 기본)에 selector만 갈아 끼운다.
 */
export function useActiveStyleRecord(editor: NoteBlockNoteEditor): ActiveStyleRecord {
  return useEditorState({
    editor,
    selector: () => readActiveStyles(editor),
  })
}
