// 마이크로 마크 상호 배타 규칙 — stage-34 규약 C의 **단일 출처**.
//
// 배경: F52 마이크로 3종(`++밑줄++` · `==형광==` · `||스포일러||`)은 `remarkStudy`가 표식 안쪽을
// **다시 파싱하지 않는다**. 그래서 `++==x==++`처럼 두 개가 같은 구간에 겹치면 Markdown 왕복이
// 성립하지 않는다(안쪽 표식이 평문이 된다). 규약 C는 이것을 "같은 구간에 마이크로 마크는 1개"로
// 못 박고, 그 판정을 이 파일 한 곳에 둔다.
//
// **`@blocknote/*`를 import하지 않는다**(어댑터 규약 B — 편집기 청크 유출 금지, R37).
// 순수 함수만 두므로 툴바 커맨드 래퍼(강제 지점 ①)·붙여넣기 접기(③ — 둘 다 Phase 2)도
// 이 모듈을 그대로 재사용한다.
import { MARK_ORDER } from '../schema/blocks'
import type { InlineStyles, MarkName } from '../schema/blocks'

/** 서로 배타적인 마이크로 마크 3종(F52). */
export const MICRO_MARKS = ['underline', 'highlight', 'spoiler'] as const

export type MicroMark = (typeof MICRO_MARKS)[number]

function isMicroMark(name: MarkName): name is MicroMark {
  return (MICRO_MARKS as readonly string[]).includes(name)
}

/** 지금 걸려 있는 마이크로 마크 목록 — **`MARK_ORDER` 순서**로 돌려준다(우선순위 = 앞이 이긴다). */
export function activeMicroMarks(styles: InlineStyles | undefined): MicroMark[] {
  if (!styles) return []
  return MARK_ORDER.filter((name) => isMicroMark(name) && styles[name] === true) as MicroMark[]
}

export interface MicroMarkCollapse {
  /** 접힌 결과(입력을 변형하지 않는다 — 필요할 때만 새 객체를 만든다) */
  styles: InlineStyles | undefined
  /** 제거된 마크 목록. 비어 있으면 접을 것이 없었다는 뜻이다. */
  removed: MicroMark[]
}

/**
 * 마이크로 마크가 2개 이상 걸려 있으면 **`MARK_ORDER` 우선순위로 1개만 남긴다**
 * (underline > highlight > spoiler). 접힌 사실은 `removed`로 **집계 보고**한다 — 조용히 접지 않는다.
 *
 * 이 함수는 순수하다: 접을 것이 없으면 입력 객체를 그대로 돌려준다.
 */
export function collapseMicroMarks(styles: InlineStyles | undefined): MicroMarkCollapse {
  const active = activeMicroMarks(styles)
  if (active.length <= 1 || !styles) return { styles, removed: [] }
  const removed = active.slice(1)
  const out: InlineStyles = { ...styles }
  for (const name of removed) delete out[name]
  return { styles: out, removed }
}
