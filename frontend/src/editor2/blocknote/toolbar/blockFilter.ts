// 블록 타입별 툴바 필터 (stage-40 FB-6, 규약 B) — 부유·도킹 공통 규칙.
//
// 판정 입력 = **선택 범위에 걸친 블록 집합**(범위 선택이면 그 블록들 · 커서만 있으면 커서 블록
// 1개 — `imageCropEligibility.ts`의 `getSelection().blocks ?? [getTextCursorPosition().block]`
// 전례). 순수 함수 1개(`shouldShowTextFormattingGroup`)로 규칙 1~4를 판정하고, 부유
// (`NoteFormattingToolbar`)·도킹(`DockedFormattingToolbar`)이 **같은 함수**를 호출한다
// (`s40-toolbar-filter.mjs`가 이 함수만 단위 검사한다 — 규약 E).
import { useCallback, useState } from 'react'
import { useEditorChange, useEditorSelectionChange } from '@blocknote/react'
import type { NoteBlockNoteEditor } from '../schema'

/** 원자·미디어 블록(규약 B ②) — 텍스트를 실을 수 없는 블록 7종. */
export const ATOM_MEDIA_BLOCK_TYPES = [
  'image',
  'webEmbed',
  'docEmbed',
  'toc',
  'divider',
  'mathBlock',
  'sourceFallback',
] as const

/** 코드 블록(규약 B ②). */
export const CODE_BLOCK_TYPES = ['codeBlock'] as const

const ATOM_MEDIA_SET: ReadonlySet<string> = new Set(ATOM_MEDIA_BLOCK_TYPES)
const CODE_SET: ReadonlySet<string> = new Set(CODE_BLOCK_TYPES)

/**
 * 규칙 1~4(규약 B ③) — 순수 함수. **텍스트 서식군**(볼드·기울임·취소선·링크·밑줄·형광·스포일러·
 * 글자색/바탕색/크기·인라인 코드·참조 삽입)을 렌더해야 하면 `true`.
 *   1. 선택 블록에 **텍스트를 실을 수 있는 블록이 하나도 없음**(전부 원자·미디어 · 전부 코드 ·
 *      또는 그 둘의 혼합) → `false`(숨김) — 검토 반려 결함 6: 종전에는 원자·코드 각각 "전부 이
 *      군만"일 때만 숨겼고 `['image','codeBlock']`처럼 **군이 섞였지만 텍스트 블록은 여전히 0개**인
 *      경우를 놓쳐 표시로 새 나갔다. 텍스트를 실을 수 있는 블록이 하나도 없다는 FB-6 원의도로
 *      일반화한다.
 *   2. 텍스트 블록이 하나라도 섞여 있으면 → `true`(표시) — 원자 인라인 가드(`atoms.ts`)는 직교로 별도 적용
 *   3. 빈 집합(도킹 미포커스 등) → `true`(전체 표시)
 * **블록 기능군**(블록 타입 변경·콜아웃·이미지 자르기 등)은 이 함수의 대상이 아니다 — 항상 유지.
 */
export function shouldShowTextFormattingGroup(blockTypes: readonly string[]): boolean {
  if (blockTypes.length === 0) return true
  if (blockTypes.every((type) => ATOM_MEDIA_SET.has(type) || CODE_SET.has(type))) return false
  return true
}

/**
 * 지금 선택(또는 커서) 블록들의 타입 배열 — 기본 파일 버튼·`CropButton`과 같은 방식
 * (`getSelection().blocks` 우선, 없으면 커서 블록 1개). 에디터가 아직 마운트되지 않았거나
 * 선택을 읽을 수 없는 드문 경우엔 **빈 배열**(규칙 4 — 전체 표시)로 물러난다.
 */
export function computeSelectedBlockTypes(editor: NoteBlockNoteEditor): string[] {
  try {
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
    return blocks.map((block) => block.type)
  } catch {
    return []
  }
}

/**
 * 선택/커서 또는 편집기 **내용**이 바뀔 때마다 블록 타입 배열을 다시 계산하는 훅.
 *
 * 검토 반려 결함 5 — 원인: 종전에는 `useEditorSelectionChange`(tiptap `"selectionUpdate"`)만
 * 구독했는데, 이 이벤트는 `!prevSelection.eq(nextSelection)`일 때만 발화한다
 * (`node_modules/@tiptap/core/dist/index.js` `dispatchTransaction` 실측). 슬래시 명령으로 커서
 * 위치의 블록 **타입만** 바뀌고 선택의 숫자 좌표(anchor/head)가 그대로인 트랜잭션(예: `/code`로
 * 문단을 코드 블록으로 바꾸는 경우)에서는 `selectionUpdate`가 아예 안 쏘여 갱신이 누락됐다 —
 * 그 결과 도킹·부유 툴바가 코드 블록 커서에서도 직전 블록(문단) 기준의 텍스트 서식군을 계속
 * 렌더했다. 엔진 자신의 블록 타입 셀렉트(`ToolbarSelect`)가 항상 올바르게 갱신되는 이유는
 * `useSelectedBlocks`가 `useEditorState({on:'all'})`(tiptap `"transaction"` — 선택 변경 여부와
 * 무관하게 **매 트랜잭션마다** 발화)를 쓰기 때문이다(`@blocknote/react` `hooks/useEditorState.ts`
 * 실측). 같은 폭으로 맞추기 위해 내용 변경 구독(`useEditorChange` → tiptap `"update"`,
 * `docChanged`인 트랜잭션마다 발화)을 추가한다 — 선택 변경 없이 블록 타입만 바뀌는 트랜잭션도
 * `docChanged`이므로 이 경로로 반드시 잡힌다. (`computeSelectedBlockTypes`의 collapsed-선택
 * 폴백 자체는 처음부터 옳았다 — `editor.getSelection()`은 선택이 collapsed거나 노드 선택이면
 * `undefined`를 반환하고(`undefined ?? [...]`가 정상 폴백), 빈 배열로 새는 경로는 없었다.)
 */
export function useSelectedBlockTypes(editor: NoteBlockNoteEditor): string[] {
  const [types, setTypes] = useState<string[]>(() => computeSelectedBlockTypes(editor))
  // useCallback([editor])으로 고정 — 그러지 않으면 매 렌더 새 함수라 아래 두 훅이 렌더마다
  // 구독 해제·재등록을 반복한다(검토 지적, 기능 결함은 아님). setTypes는 함수형 갱신 + 얕은
  // 배열 비교로 내용이 같으면 이전 참조를 그대로 유지해 불필요한 리렌더를 줄인다.
  const recompute = useCallback(() => {
    setTypes((prev) => {
      const next = computeSelectedBlockTypes(editor)
      if (
        prev.length === next.length &&
        prev.every((type, index) => type === next[index])
      ) {
        return prev
      }
      return next
    })
  }, [editor])
  useEditorSelectionChange(recompute, editor)
  useEditorChange(recompute, editor)
  return types
}
