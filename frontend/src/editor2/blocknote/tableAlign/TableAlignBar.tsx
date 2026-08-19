// 표 **열 정렬 편집 UI**(stage-36 F-6 · 규약 E).
//
// 커서가 표 안에 있을 때만 뜬다. 대상은 **커서가 놓인 열 하나**이고, 값은 GFM 구분행이 표현할 수
// 있는 네 상태(없음/좌/가운데/우)뿐이다 — 표현할 수 없는 값을 만들지 않는 것이 계약이다.
//
// 정렬은 문서가 아니라 **편집 세션 상태**다(사유는 `tableAlignPlugin.ts` 머리말). 그래서
//   · 화면 반영 = PM 장식(플러그인) → 문서를 건드리지 않고도 즉시 보인다,
//   · 저장 반영 = 표면의 `build()`가 사이드카 `table:align`으로 직렬화,
//   · **되돌리기(Ctrl+Z)의 대상이 아니다** — 문서 변경이 아니기 때문이다. 대신 "없음"이 늘 한 번의
//     클릭으로 돌아가는 자리에 있어 되돌림이 필요 없다.
import { useCallback } from 'react'
import type { EditorState } from 'prosemirror-state'
import { useNoteEditor } from '../toolbar/useNoteEditor'
import { usePmSnapshot } from '../usePmSnapshot'
import {
  getTableAlignState,
  selectedTableColumn,
  withTableAlignAction,
  type ColumnAlign,
} from './tableAlignPlugin'

interface AlignSnapshot {
  blockId: string | null
  colIndex: number
  columnCount: number
  current: ColumnAlign
}

const IDLE: AlignSnapshot = { blockId: null, colIndex: -1, columnCount: 0, current: null }

function readAlign(state: EditorState): AlignSnapshot {
  const column = selectedTableColumn(state)
  if (!column) return IDLE
  const entry = getTableAlignState(state).entries.find((item) => item.blockId === column.blockId)
  if (!entry) return IDLE
  return {
    blockId: column.blockId,
    colIndex: column.colIndex,
    columnCount: entry.align.length,
    current: entry.align[column.colIndex] ?? null,
  }
}

function sameAlign(a: AlignSnapshot, b: AlignSnapshot): boolean {
  return (
    a.blockId === b.blockId &&
    a.colIndex === b.colIndex &&
    a.columnCount === b.columnCount &&
    a.current === b.current
  )
}

const CHOICES: { value: ColumnAlign; label: string; hint: string }[] = [
  { value: null, label: '없음', hint: '정렬 지정 없음' },
  { value: 'left', label: '왼쪽', hint: '왼쪽 정렬' },
  { value: 'center', label: '가운데', hint: '가운데 정렬' },
  { value: 'right', label: '오른쪽', hint: '오른쪽 정렬' },
]

export default function TableAlignBar() {
  const editor = useNoteEditor()
  const snapshot = usePmSnapshot(editor, readAlign, sameAlign, IDLE)

  const apply = useCallback(
    (value: ColumnAlign) => {
      if (snapshot.blockId === null) return
      const view = editor.prosemirrorView
      view.dispatch(
        withTableAlignAction(view.state.tr, {
          type: 'set',
          blockId: snapshot.blockId,
          colIndex: snapshot.colIndex,
          value,
        }),
      )
      editor.focus()
    },
    [editor, snapshot.blockId, snapshot.colIndex],
  )

  if (snapshot.blockId === null) return null

  return (
    <div
      role="group"
      aria-label="표 열 정렬"
      className="editor2-table-align-bar flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2 py-1 text-xs shadow"
    >
      <span className="text-muted">
        열 {snapshot.colIndex + 1}/{snapshot.columnCount} 정렬
      </span>
      {CHOICES.map((choice) => {
        const active = snapshot.current === choice.value
        return (
          <button
            key={choice.label}
            type="button"
            title={choice.hint}
            aria-pressed={active}
            onClick={() => apply(choice.value)}
            className={`rounded border px-1.5 py-0.5 ${
              active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
            }`}
          >
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}
