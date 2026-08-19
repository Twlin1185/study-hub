// 표 열 정렬 → **사이드카 직렬화**(stage-36 F-6 · 규약 E "저장 시 사이드카 `table:align` 규약으로").
//
// 저장 경로(`fromBlockNoteResult`)는 사이드카의 `tableAlign`만 본다. 편집 세션 동안 정렬을 들고
// 있는 것은 PM 플러그인이므로, **저장 직전에 한 번** 그 값을 사이드카로 옮겨 적는다.
// 어댑터·변환기는 **손대지 않는다** — 이 함수는 사이드카의 소비자이자 기록자일 뿐이다.
//
// 복원 조건 정합: `fromBlockNote`는 `saved.length === 열 수`일 때만 정렬을 되살린다. 플러그인은
// 열 증감 때마다 배열 길이를 실제 열 수에 맞춰 다시 만들므로(위치 매핑) 이 조건이 항상 참이고,
// 그래서 편집 UI 경로에서는 `table:align` 폐기(`tableAlignDrops`)가 발생하지 않는다.
import type { AdapterSidecar } from '../../adapter'
import type { NoteBlockNoteEditor } from '../schema'
import { readTableAlign } from './tableAlignPlugin'

/**
 * 편집기의 현재 표 열 정렬을 세션 사이드카에 반영한다(제자리 수정).
 * 정렬이 하나도 없는 표는 항목을 **지운다** — 값이 전부 `null`인 배열을 남겨 두면 사이드카가
 * 무의미하게 부풀고, 저장분(Markdown 구분행)과도 같은 뜻이 아니게 된다.
 */
export function syncTableAlignIntoSidecar(editor: NoteBlockNoteEditor, sidecar: AdapterSidecar): void {
  // 언마운트 저장 경로에서는 뷰가 이미 사라졌을 수 있다 — 그때는 사이드카를 **건드리지 않는다**
  // (로드 때 받은 값이 그대로 살아 있으므로 종전 동작으로 안전하게 되돌아간다).
  const state = editor.prosemirrorView?.state
  if (!state) return
  const aligns = readTableAlign(state)
  for (const [blockId, align] of Object.entries(aligns)) {
    const meaningful = align.some((value) => value !== null)
    const entry = sidecar[blockId]
    if (meaningful) {
      if (entry) entry.tableAlign = align
      else sidecar[blockId] = { tableAlign: align }
    } else if (entry?.tableAlign) {
      delete entry.tableAlign
    }
  }
}
