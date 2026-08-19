// 찾기/바꾸기 — **문서에서 일치 구간을 모으는 순수 함수**(stage-36 F-7 · 규약 E).
//
// BlockNote에는 찾기/바꾸기가 없다(`editor-v2.m31-analysis.md` §2.3 "부재 — 자체 구현 필요").
// 그래서 ProseMirror 계층에서 직접 만든다. 이 파일은 그중 **DOM도 편집기 인스턴스도 필요 없는
// 부분**만 담는다 — 검증 스크립트(`scripts/s36-editor-ux.mjs`)가 이 함수를 그대로 불러
// 실제 `noteSchema` 문서에 대고 돌린다.
//
// ---------------------------------------------------------------- 규약 E가 정한 1차 범위
//   · **리터럴 검색만** — 정규식 없음(YAGNI). 대소문자 구분은 선택.
//   · 범위 = **현재 편집 문서 안**(표면별). 전역 검색은 기존 FTS 담당 — 혼동 금지.
//   · **원자 노드 내부 텍스트는 대상에서 제외**한다(참조 칩·인라인 이미지·줄바꿈·원문 보존·수식).
//     이유: 원자는 앱 모델에서 텍스트가 아니라 **값**이다(칩의 `target`, 수식의 LaTeX 소스).
//     그 안을 치환하면 참조 대상이나 수식이 조용히 망가진다 = 도메인 붕괴.
//
// ---------------------------------------------------------------- 제외를 구현하는 방법
// 텍스트 블록 하나의 인라인 자식을 훑으며 문자열을 만들되, **텍스트 노드가 아닌 자식**은
// `SEP`(널 문자) 한 글자로 바꿔 넣는다. 검색어에는 널 문자가 들어올 수 없으므로
//   ① 원자 **내부**는 애초에 문자열에 들어가지 않고(= 검색되지 않는다),
//   ② 원자를 **가로지르는** 일치도 성립하지 않는다(`가나[칩]다라`에서 "나다"는 잡히지 않는다).
// 동시에 문자 인덱스 → 문서 위치 표(`offsets`)를 함께 만들어, 마크로 쪼개진 텍스트 노드
// (`가**나**다`)를 가로지르는 일치는 **정상적으로** 잡는다(이건 사용자가 기대하는 동작이다).
import type { Node as PMNode } from 'prosemirror-model'

/** 원자·비텍스트 인라인이 차지하는 자리표시 문자. 검색어에는 들어올 수 없는 값이어야 한다. */
const SEP = '\u0000'

/**
 * 텍스트 블록이어도 **검색 대상이 아닌** 블록 타입.
 *
 * `mathBlock`은 스펙 content가 `"plain"`이라 ProseMirror에서는 텍스트 블록으로 보이지만,
 * 그 안은 **LaTeX 소스**다(인라인 `math`와 같은 이유로 제외 — `toolbar/atoms.ts` 참조).
 * `sourceFallback`·`docEmbed`·`callout`은 content가 `'none'`이라 애초에 텍스트 블록이 아니지만,
 * 스펙이 바뀌어도 의도가 남도록 함께 적어 둔다(콜아웃 **자식 블록**은 별개 블록이므로 검색된다).
 */
export const FIND_EXCLUDED_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'mathBlock',
  'sourceFallback',
  'docEmbed',
])

export interface FindMatch {
  /** 문서 위치(포함). */
  from: number
  /** 문서 위치(제외). */
  to: number
}

/** 검색어로 쓸 수 없는 값인가(빈 문자열·자리표시 문자 포함). */
export function isSearchableQuery(query: string): boolean {
  return query.length > 0 && !query.includes(SEP)
}

/**
 * 문서 전체에서 `query`와 리터럴로 일치하는 구간을 **문서 순서대로** 모은다.
 * 겹치는 일치는 세지 않는다(찾은 자리 뒤부터 다시 찾는다 — "aaa"에서 "aa"는 1건).
 */
export function collectMatches(doc: PMNode, query: string, caseSensitive: boolean): FindMatch[] {
  const matches: FindMatch[] = []
  if (!isSearchableQuery(query)) return matches
  const needle = caseSensitive ? query : query.toLowerCase()

  doc.descendants((node, pos) => {
    if (FIND_EXCLUDED_BLOCK_TYPES.has(node.type.name)) return false
    if (!node.isTextblock) return true

    // 문자 인덱스 → 문서 위치 표. `text[i]`의 문서 위치가 `offsets[i]`다.
    let text = ''
    const offsets: number[] = []
    let cursor = pos + 1
    node.forEach((child) => {
      if (child.isText) {
        const raw = child.text ?? ''
        for (let i = 0; i < raw.length; i += 1) {
          text += raw[i]
          offsets.push(cursor + i)
        }
      } else {
        // 원자·비텍스트 인라인 — 한 글자짜리 벽으로 바꾼다(내부는 훑지 않는다).
        text += SEP
        offsets.push(cursor)
      }
      cursor += child.nodeSize
    })

    const haystack = caseSensitive ? text : text.toLowerCase()
    let at = haystack.indexOf(needle)
    while (at !== -1) {
      const last = at + needle.length - 1
      matches.push({ from: offsets[at], to: offsets[last] + 1 })
      at = haystack.indexOf(needle, at + needle.length)
    }
    // 텍스트 블록의 인라인 자식은 위에서 직접 훑었다 — 더 내려가지 않는다.
    return false
  })

  return matches
}

/** `pos` 이후(같은 자리 포함)의 첫 일치 번호. 없으면 0(문서를 한 바퀴 돌아 처음으로). */
export function firstMatchAtOrAfter(matches: FindMatch[], pos: number): number {
  const index = matches.findIndex((match) => match.from >= pos)
  return index === -1 ? 0 : index
}
