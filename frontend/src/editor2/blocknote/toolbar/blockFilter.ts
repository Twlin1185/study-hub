// 블록 타입별 툴바 필터 (stage-40 FB-6, 규약 B) — 부유·도킹 공통 규칙.
//
// 판정 입력 = **선택 범위에 걸친 블록 집합**(범위 선택이면 그 블록들 · 커서만 있으면 커서 블록
// 1개 — `imageCropEligibility.ts`의 `getSelection().blocks ?? [getTextCursorPosition().block]`
// 전례). 순수 함수 1개(`shouldShowTextFormattingGroup`)로 규칙 1~4를 판정하고, 부유
// (`NoteFormattingToolbar`)·도킹(`DockedFormattingToolbar`)이 **같은 함수**를 호출한다
// (`s40-toolbar-filter.mjs`가 이 함수만 단위 검사한다 — 규약 E).
import { useState } from 'react'
import { useEditorSelectionChange } from '@blocknote/react'
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
 *   1. 선택 블록이 전부 원자·미디어 블록 → `false`(숨김)
 *   2. 선택 블록이 전부 코드 블록 → `false`(숨김)
 *   3. 텍스트 블록이 섞여 있으면(혼합 포함) → `true`(표시) — 원자 인라인 가드(`atoms.ts`)는 직교로 별도 적용
 *   4. 빈 집합(도킹 미포커스 등) → `true`(전체 표시)
 * **블록 기능군**(블록 타입 변경·콜아웃·이미지 자르기 등)은 이 함수의 대상이 아니다 — 항상 유지.
 */
export function shouldShowTextFormattingGroup(blockTypes: readonly string[]): boolean {
  if (blockTypes.length === 0) return true
  if (blockTypes.every((type) => ATOM_MEDIA_SET.has(type))) return false
  if (blockTypes.every((type) => CODE_SET.has(type))) return false
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

/** 선택/커서가 바뀔 때마다 블록 타입 배열을 다시 계산하는 훅(`useEditorSelectionChange` 전례). */
export function useSelectedBlockTypes(editor: NoteBlockNoteEditor): string[] {
  const [types, setTypes] = useState<string[]>(() => computeSelectedBlockTypes(editor))
  useEditorSelectionChange(() => setTypes(computeSelectedBlockTypes(editor)), editor)
  return types
}
