// 블록 트리 정규화 — 세션 스냅샷 동등 비교 안정화(stage-39 검토 중요 2 수정).
//
// 살아있는 편집기 문서(`editor.document` — 실제 BlockNote 스키마 산출물)는 자식이 없는 블록에도
// 항상 `children: []`을 싣는다. 반면 서버 로드 경로(`toBlockNoteBlocks` 어댑터)는 앱 스키마에
// children 필드가 없는 블록 타입(문단·헤딩·이미지 등)에서 그 키 자체를 내보내지 않는다(실측 —
// `adapter/toBlockNote.ts` `blockToBnInner`: listItem·quote·callout만 `children`을 명시하고
// 나머지는 아예 프로퍼티가 없다). 두 출처가 구조적으로 달라 `JSON.stringify` 동등 비교가 항상
// 어긋나던 결함(검토 중요 2 — 명시 [저장] 후 재진입에서 거짓 복구 다이얼로그가 무조건 뜬다)을
// 막기 위해, 비교 직전 양쪽을 이 함수로 정규화해 "빈 children 키는 없는 것과 같다"로 맞춘다.
//
// 노트·문서 두 표면(`noteSessionSnapshot.ts`·`docBlockSnapshot.ts`)이 공유한다.
import type { BnBlock } from '../adapter'

export function normalizeBlockTree(blocks: BnBlock[]): BnBlock[] {
  return blocks.map(normalizeOne)
}

function normalizeOne(block: BnBlock): BnBlock {
  // 실측(스크립트 검증 — 검토 중요 2 재현): `children` 외에 **`props`도 같은 비대칭을 가진다**.
  // 실 편집기 스키마 왕복 산출물은 props 없는 블록 타입(문단 등)에도 항상 `props: {}`를 싣지만,
  // `toBlockNoteBlocks` 로드 경로는 그 타입에 `props` 키 자체를 만들지 않는다. 두 키 모두
  // "비어 있으면 없는 것과 같다"로 통일해야 두 출처가 실제로 동일 비교된다.
  const withExtras = block as BnBlock & { children?: BnBlock[]; props?: Record<string, unknown> }
  const { children, props, ...rest } = withExtras
  const normalized = { ...rest } as BnBlock & { children?: BnBlock[]; props?: Record<string, unknown> }
  if (Array.isArray(children) && children.length > 0) {
    normalized.children = normalizeBlockTree(children)
  }
  if (props && typeof props === 'object' && Object.keys(props).length > 0) {
    normalized.props = props
  }
  return normalized as BnBlock
}
