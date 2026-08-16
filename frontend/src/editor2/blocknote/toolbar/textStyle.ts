// `:t{c= bg= s=}` 툴바 커맨드 — **속성 쌍 보존 갱신** (stage-34 규약 E · 불변 규칙 5).
//
// `t` 스타일의 값은 `JSON.stringify(AttrPair[])`다(Phase 1 결정 — 화이트리스트 prop 3개로 쪼개면
// `c=rebeccapurple` 같은 실재 표본이 조용히 사라진다). 그래서 툴바는 **덮어쓰지 않고 병합**한다:
//   - 건드리는 키(`c`·`bg`·`s`)만 갱신하고 나머지 쌍은 **값·순서 그대로** 남긴다.
//   - 같은 키가 여러 번 있으면 **첫 자리에 새 값을 놓고 나머지 중복만 걷는다**(사용자가 그 키를
//     명시적으로 지정한 상황이라 결과가 모호하면 안 된다). 다른 키는 손대지 않는다.
//   - 쌍이 0개가 되면 스타일 자체를 제거한다.
//
// 값 도메인은 `components/markdown/palette.ts` **단일 출처**(팔레트 7색 ∪ `#rrggbb` ∪ size 3종).
// 편집기 v2가 새 색 규칙을 만들지 않는다.
import { decodeTextStylePairs, encodeTextStylePairs } from '../specs/styles'
import { interpretTextStyle } from '../../schema/blocks'
import type { AttrPair, TextStyleView } from '../../schema/blocks'
import type { NoteBlockNoteEditor } from '../schema'

type StyleBag = Parameters<NoteBlockNoteEditor['addStyles']>[0]

/** `:t`가 담는 키 — 툴바가 건드릴 수 있는 전부다(자유 속성 편집 UI는 없다 — 규약 E). */
export type TextStyleKey = 'c' | 'bg' | 's'

export function readTextStyleValue(styles: Record<string, unknown>): string {
  const value = styles.t
  return typeof value === 'string' ? value : ''
}

export function readTextStyleView(styles: Record<string, unknown>): TextStyleView {
  return interpretTextStyle(decodeTextStylePairs(readTextStyleValue(styles)))
}

/** 키 하나를 갱신한 쌍 목록(순수 함수 — 나머지 쌍은 순서까지 그대로). */
export function withTextStyleKey(pairs: AttrPair[], key: TextStyleKey, value: string | null): AttrPair[] {
  const out: AttrPair[] = []
  let placed = false
  for (const [k, v] of pairs) {
    if (k !== key) {
      out.push([k, v])
      continue
    }
    if (value !== null && !placed) {
      out.push([key, value])
      placed = true
    }
    // value === null이면 그 키의 쌍을 전부 버린다(= 제거). 중복 쌍도 함께 정리된다.
  }
  if (value !== null && !placed) out.push([key, value])
  return out
}

/** 선택 구간의 `:t`에서 키 하나만 바꾼다. `value === null`이면 그 키를 없앤다. */
export function setTextStyleKey(
  editor: NoteBlockNoteEditor,
  key: TextStyleKey,
  value: string | null,
): void {
  const styles = editor.getActiveStyles() as unknown as Record<string, unknown>
  const next = withTextStyleKey(decodeTextStylePairs(readTextStyleValue(styles)), key, value)
  const encoded = encodeTextStylePairs(next)
  if (encoded === '') editor.removeStyles({ t: '' } as StyleBag)
  else editor.addStyles({ t: encoded } as StyleBag)
}
