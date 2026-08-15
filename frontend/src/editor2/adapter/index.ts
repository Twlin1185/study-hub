// 에디터 v2 어댑터 — **공개 API** (M33 / stage-33 규약 B)
//
//   toBlockNoteBlocks(doc)      : 앱 블록 문서 → BlockNote 블록 JSON + **미지원 보고**
//   fromBlockNoteBlocks(blocks) : BlockNote 블록 JSON → 앱 블록 문서(말미 빈 문단 트림 포함)
//
// 화면 코드는 이 모듈의 공개 API만 부른다 — 어댑터 밖에서 BlockNote 블록 JSON을 직접 손대지 않는다.
export { toBlockNoteBlocks, describeUnsupported } from './toBlockNote'
export { fromBlockNoteBlocks } from './fromBlockNote'
export { BN_BLOCK_TYPES } from './types'
export type {
  AdapterIssue,
  BnBlock,
  BnBlockType,
  BnInline,
  BnStyledText,
  ToBlockNoteResult,
} from './types'
