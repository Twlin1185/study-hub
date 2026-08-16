// 에디터 v2 어댑터 — **공개 API** (M33 / stage-33 규약 B · stage-34 확장)
//
//   toBlockNoteBlocks(doc)               : 앱 블록 문서 → BlockNote 블록 JSON + 미지원 보고 + 사이드카
//   fromBlockNoteBlocks(blocks, sidecar?): BlockNote 블록 JSON → 앱 블록 문서(말미 빈 문단 트림 포함)
//   fromBlockNoteResult(...)             : 위와 같되 규약 C 정규화 집계까지 함께 돌려준다
//   collapseMicroMarks / MICRO_MARKS     : 마이크로 마크 상호 배타(규약 C) — 툴바·붙여넣기가 재사용
//
// 화면 코드는 이 모듈의 공개 API만 부른다 — 어댑터 밖에서 BlockNote 블록 JSON을 직접 손대지 않는다.
export { toBlockNoteBlocks, describeUnsupported } from './toBlockNote'
export { fromBlockNoteBlocks, fromBlockNoteResult } from './fromBlockNote'
export type { FromBlockNoteResult } from './fromBlockNote'
export { MICRO_MARKS, activeMicroMarks, collapseMicroMarks } from './marks'
export type { MicroMark, MicroMarkCollapse } from './marks'
export { BN_BLOCK_TYPES, BN_INLINE_TYPES, CALLOUT_VARIANTS, isCalloutVariant } from './types'
export type {
  AdapterIssue,
  AdapterSidecar,
  AdapterSidecarEntry,
  BnBlock,
  BnBlockType,
  BnInline,
  BnStyledText,
  CalloutVariant,
  ToBlockNoteResult,
} from './types'
