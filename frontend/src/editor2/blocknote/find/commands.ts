// 찾기/바꾸기 **커맨드**(stage-36 F-7 · 규약 E) — 패널 버튼과 단축키가 부르는 유일한 지점.
//
// undo 계약(규약 E "안정 undo"): 바꾸기·전체 바꾸기는 **각각 undo 1단위**다.
// 근거 = `editor.transact()`. BlockNote는 이 콜백 안의 모든 변경을 하나의 트랜잭션으로 모아
// 한 번만 dispatch한다(`BlockNoteEditor.transact` 주석: "grouped together, so that we can
// dispatch them as a single operation (thus creating only a single undo step)"). 전체 바꾸기가
// 일치 N건을 고쳐도 Ctrl+Z 한 번이면 전부 되돌아온다.
import { TextSelection } from 'prosemirror-state'
import type { NoteBlockNoteEditor } from '../schema'
import { getFindState, withFindAction } from './findPlugin'
import type { FindMatch } from './matches'

/** 패널 열기(현재 선택 글자가 있으면 그것을 첫 검색어로 쓴다 — 브라우저 찾기와 같은 관례). */
export function openFind(editor: NoteBlockNoteEditor, seed?: string): void {
  const view = editor.prosemirrorView
  view.dispatch(withFindAction(view.state.tr, { type: 'open', query: seed }))
}

export function closeFind(editor: NoteBlockNoteEditor): void {
  const view = editor.prosemirrorView
  if (!getFindState(view.state).open) return
  view.dispatch(withFindAction(view.state.tr, { type: 'close' }))
}

export function setFindQuery(editor: NoteBlockNoteEditor, query: string, caseSensitive: boolean): void {
  const view = editor.prosemirrorView
  view.dispatch(withFindAction(view.state.tr, { type: 'query', query, caseSensitive }))
}

/** 다음/이전 일치로 이동 + 그 자리를 화면 안으로 끌어온다(선택도 함께 옮겨 바로 바꿀 수 있게). */
export function stepFind(editor: NoteBlockNoteEditor, delta: 1 | -1): void {
  const view = editor.prosemirrorView
  const state = getFindState(view.state)
  if (state.matches.length === 0) return
  const size = state.matches.length
  const nextIndex = (state.activeIndex + delta + size) % size
  const target = state.matches[nextIndex]
  const tr = withFindAction(view.state.tr, { type: 'step', delta })
  tr.setSelection(TextSelection.create(tr.doc, target.from, target.to)).scrollIntoView()
  view.dispatch(tr)
}

/**
 * 패널을 열 때 검색어 자리에 미리 채울 **선택 글자**. 블록을 가로지르거나 지나치게 길면
 * 씨앗으로 쓰지 않는다(빈 문자열) — 검색어 칸에 문단이 통째로 들어가는 꼴을 막는다.
 */
const SEED_MAX_LENGTH = 120

export function selectedPlainText(editor: NoteBlockNoteEditor): string {
  return editor.transact((tr) => {
    const { from, to } = tr.selection
    if (from === to) return ''
    const text = tr.doc.textBetween(from, to, '\u0000', '\u0000')
    if (text.includes('\u0000') || text.length > SEED_MAX_LENGTH) return ''
    return text
  })
}

/**
 * 일치 구간들을 `replacement`로 바꾼다 — **문서 뒤에서 앞으로** 훑어 앞선 치환이 뒤 위치를
 * 밀어내지 않게 한다(위치 재매핑이 필요 없다 = 계산이 자명하다).
 * 마크는 일치 **시작 글자의 것**을 그대로 물려준다(굵게 걸린 낱말을 바꾸면 결과도 굵다).
 */
function applyReplacements(
  editor: NoteBlockNoteEditor,
  matches: readonly FindMatch[],
  replacement: string,
): void {
  if (matches.length === 0) return
  editor.transact((tr) => {
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const { from, to } = matches[i]
      if (replacement === '') {
        tr.delete(from, to)
        continue
      }
      const marks = tr.doc.resolve(from + 1).marks()
      tr.replaceWith(from, to, tr.doc.type.schema.text(replacement, marks))
    }
  })
}

/** 현재 일치 1건만 바꾼다(undo 1단위). */
export function replaceCurrent(editor: NoteBlockNoteEditor, replacement: string): boolean {
  const state = getFindState(editor.prosemirrorView.state)
  if (state.activeIndex < 0) return false
  applyReplacements(editor, [state.matches[state.activeIndex]], replacement)
  return true
}

/** 문서 안 모든 일치를 바꾼다 — **전체가 undo 1단위**(규약 E). 바꾼 건수를 돌려준다. */
export function replaceAll(editor: NoteBlockNoteEditor, replacement: string): number {
  const state = getFindState(editor.prosemirrorView.state)
  const count = state.matches.length
  if (count === 0) return 0
  applyReplacements(editor, state.matches, replacement)
  return count
}
