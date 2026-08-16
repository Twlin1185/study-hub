// **원자 인라인 보호** — 서식이 조용히 사라지는 경로를 막는다(stage-34 Phase 1 실측 후속).
//
// 사실관계: BlockNote는 커스텀 인라인 노드(`content: 'none'`)에 걸린 mark를 되읽을 때 버린다
// (`nodeToInlineContent` — Phase 1 실측). 즉 참조 칩·문단 안 이미지·원문 보존·줄바꿈이 **선택에
// 포함된 채** 서식 버튼을 누르면, 화면에는 잠깐 먹히는 것처럼 보이지만 저장·재로드하면 그 원자의
// 서식만 사라진다.
//
// **채택: 비활성화**(대안이던 "원자의 `styles` prop 동시 갱신"은 채택하지 않았다).
//   - `styles` prop은 **어댑터가 마크를 실어 나르는 전송로**다. 툴바가 그리로 직접 쓰면 마크 병합
//     규칙(`MARK_ORDER` · 마이크로 마크 상호 배타 · `:t` 쌍 병합)이 두 곳에 생기고, 텍스트와 원자가
//     섞인 선택에서는 서로 다른 경로로 갈라져 토글 상태(active) 판정까지 어긋난다.
//   - 비활성화는 **눈에 보이는 상태**다. 사용자는 "왜 안 되는지"를 툴팁으로 즉시 알 수 있고,
//     결과가 저장분과 어긋나지 않는다.
//
// 한계(보고 대상): 이 가드는 **방언 버튼**(밑줄·형광·스포일러·글자색·바탕색·크기)에만 건다.
// BlockNote 기본 버튼과 그 단축키(Ctrl+B 등)는 코어 소유라 여기서 막지 않는다.
import type { NoteBlockNoteEditor } from '../schema'

/** 마크를 실어 나를 수 없는 원자 인라인(스키마의 `content: 'none'` 커스텀 인라인). */
export const ATOM_INLINE_TYPES = ['refChip', 'inlineImage', 'inlineFallback', 'lineBreak'] as const

const ATOM_SET: ReadonlySet<string> = new Set(ATOM_INLINE_TYPES)

/** 지금 선택 범위에 원자 인라인이 하나라도 들어 있는가(커서만 있으면 `false`). */
export function selectionHasAtomInline(editor: NoteBlockNoteEditor): boolean {
  // 읽기 전용 `transact` — 트랜잭션을 변형하지 않으므로 dispatch되지 않는다(StateManager 실측).
  return editor.transact((tr) => {
    const { from, to } = tr.selection
    if (from === to) return false
    let found = false
    tr.doc.nodesBetween(from, to, (node) => {
      if (ATOM_SET.has(node.type.name)) found = true
      return !found
    })
    return found
  })
}

export const ATOM_GUARD_TOOLTIP =
  '선택에 참조 칩·이미지 같은 요소가 있어 이 서식을 적용할 수 없습니다 (저장할 때 사라지기 때문입니다)'
