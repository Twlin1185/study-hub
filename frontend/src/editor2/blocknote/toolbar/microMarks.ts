// 마이크로 마크 상호 배타 — **강제 지점 ①(툴바·단축키 커맨드 래퍼)** (stage-34 규약 C).
//
// 규약 C: `++`(밑줄) · `==`(형광) · `||`(스포일러)는 한 구간에 **최대 1개**. 이미 다른 마이크로
// 마크가 걸린 구간에 새 것을 적용하면 **대체(replace)** 한다(라디오 동작). 무시·차단하면 사용자는
// 버튼이 고장 난 것으로 읽는다. 안내 토스트는 만들지 않는다 — active 표시로 충분(과설계 금지).
//
// 3지점(①툴바 ②역방향 정규화 ③붙여넣기)이 **같은 상수** `MICRO_MARKS`를 본다. 여기서 그 상수를
// 다시 정의하지 않고 `adapter/marks.ts`에서 그대로 가져온다(단일 출처).
//
// **활성 판정은 `activeStyles.ts` 한 곳을 거친다**(stage-46 F-2 · 규약 D). 코어
// `editor.getActiveStyles()`를 직접 읽으면 접힌 커서의 **대기 마크**(ProseMirror `storedMarks`)가
// 보이지 않아 토글이 한 방향으로만 간다 — 켠 직후 다시 눌러도 계속 `addStyles`가 나가고, 밑줄
// 구간 안에서 끈 뒤 다시 눌러도 계속 `removeStyles`가 나간다(= "Ctrl+U가 안 먹힌다" · FB-17).
// 툴바 표시(`isSelected`)와 **같은 판정**을 써야 이중 토글·표시 어긋남이 생기지 않는다.
import { MICRO_MARKS, type MicroMark } from '../../adapter/marks'
import type { NoteBlockNoteEditor } from '../schema'
import { readActiveStyles } from './activeStyles'

type StyleBag = Parameters<NoteBlockNoteEditor['addStyles']>[0]

function activeStyleRecord(editor: NoteBlockNoteEditor): Record<string, unknown> {
  return readActiveStyles(editor)
}

export function isMicroMarkActive(styles: Record<string, unknown>, mark: MicroMark): boolean {
  return styles[mark] === true
}

/** 지금 걸린 마이크로 마크(0개 또는 1개여야 정상 — 2개 이상이면 역방향 정규화가 접는다). */
export function activeMicroMarkNames(styles: Record<string, unknown>): MicroMark[] {
  return MICRO_MARKS.filter((mark) => styles[mark] === true)
}

/** 켠다(이미 켜져 있으면 그대로) — 다른 마이크로 마크는 **대체**된다. */
export function applyMicroMark(editor: NoteBlockNoteEditor, mark: MicroMark): void {
  const styles = activeStyleRecord(editor)
  const others = MICRO_MARKS.filter((name) => name !== mark && styles[name] === true)
  if (others.length > 0) {
    editor.removeStyles(Object.fromEntries(others.map((name) => [name, true])) as StyleBag)
  }
  if (styles[mark] !== true) editor.addStyles({ [mark]: true } as StyleBag)
}

export function clearMicroMark(editor: NoteBlockNoteEditor, mark: MicroMark): void {
  editor.removeStyles({ [mark]: true } as StyleBag)
}

/**
 * 툴바 버튼·단축키가 **유일하게** 부르는 커맨드. 켜져 있으면 끄고, 꺼져 있으면 다른 마이크로 마크를
 * 걷어낸 뒤 켠다.
 */
export function toggleMicroMark(editor: NoteBlockNoteEditor, mark: MicroMark): void {
  const styles = activeStyleRecord(editor)
  if (styles[mark] === true) clearMicroMark(editor, mark)
  else applyMicroMark(editor, mark)
}

export { MICRO_MARKS }
export type { MicroMark }

export const MICRO_MARK_LABEL: Record<MicroMark, string> = {
  underline: '밑줄',
  highlight: '형광펜',
  spoiler: '스포일러',
}
