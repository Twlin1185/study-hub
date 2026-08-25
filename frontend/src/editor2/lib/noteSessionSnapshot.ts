// 노트 편집 세션 원본 스냅샷 — stage-39 규약 E(세션 원본 스냅샷·크래시 복구)의 노트 표면 형태.
//
// 스냅샷 = 편집 세션 진입 시점(또는 마지막 [저장]/[취소] 체크포인트)의 제목·블록·사이드카.
// [취소]의 복귀 기준점과 **동일 실체**(규약 C — 이원화 금지·저장소 하나). 저장/삭제 자체는
// 표면 중립 `sessionSnapshotStorage`(2026-08-23 정정 — 문서 표면(`docBlockSnapshot.ts`)과 공유)에
// 위임하고, 이 모듈은 노트 표면의 스냅샷 **형태**·검증기·동등 비교만 담당한다.
import { clearSnapshot, readSnapshot, writeSnapshot } from './sessionSnapshotStorage'
import { normalizeBlockTree } from './blockTreeNormalize'
import type { AdapterSidecar, BnBlock } from '../adapter'

const SURFACE = 'note'

export interface NoteSnapshot {
  title: string
  blocks: BnBlock[]
  sidecar: AdapterSidecar
}

function isNoteSnapshot(value: unknown): value is NoteSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<NoteSnapshot>
  return (
    typeof v.title === 'string' &&
    Array.isArray(v.blocks) &&
    typeof v.sidecar === 'object' &&
    v.sidecar !== null
  )
}

/** 부재·손상(파싱 실패·형태 불일치) 시 `null` — 호출부는 "생략 진입"(다이얼로그 없이 새 스냅샷 확보)으로 처리한다. */
export function readNoteSnapshot(noteId: number): NoteSnapshot | null {
  return readSnapshot(SURFACE, noteId, isNoteSnapshot)
}

/** 기록 성공 여부를 돌려준다 — 실패(용량 상한·비공개 모드 등) 시 호출부가 [취소]를 비활성 + 안내한다(규약 E 상한 조항). */
export function writeNoteSnapshot(noteId: number, snapshot: NoteSnapshot): boolean {
  return writeSnapshot(SURFACE, noteId, snapshot)
}

/** 정상 종결([저장]/[취소]/정상 이탈) — 다음 진입에서 거짓 복구 다이얼로그가 뜨지 않게 지운다. */
export function clearNoteSnapshot(noteId: number): void {
  clearSnapshot(SURFACE, noteId)
}

/**
 * 저장 직후 재진입에서 스냅샷이 "현재 로드된 내용과 그대로 같은지" 판정 — 같으면 예기치 못한
 * 종료가 아니라 정상 종결 직후의 단순 재열람(새로고침 등)이므로 거짓 복구 다이얼로그를 막는다.
 *
 * **검토 중요 2 수정**: 체크포인트(`a`)는 이제 어느 경로로 확보됐든(진입 시점·명시 저장 재기록)
 * 항상 `toBlockNoteBlocks`를 거친 **로드 형태**다(`NoteEditPage.tsx`의 명시 저장 성공 콜백이
 * 저장한 앱 블록을 다시 `toBlockNoteBlocks`로 되읽어 체크포인트에 쓴다 — 실 편집기 스키마
 * 산출물(`asAdapterBlocks(editor.document)`)을 직접 쓰지 않는다: 표 셀·이미지 기본 prop·경성
 * 줄바꿈 런 분할 등 정규화만으로는 못 맞추는 차이가 있다 — 실측: scratchpad 검증 스크립트).
 * `normalizeBlockTree`는 그래도 남을 수 있는 사소한 키 차이(빈 `children`/`props`)에 대한
 * 방어망으로 유지한다 — 두 출처가 이미 대개 같은 형태이므로 정상 경로에서는 사실상 항상 항등이다.
 */
export function noteSnapshotsEqual(a: NoteSnapshot, b: { title: string; blocks: BnBlock[] }): boolean {
  return (
    a.title === b.title &&
    JSON.stringify(normalizeBlockTree(a.blocks)) === JSON.stringify(normalizeBlockTree(b.blocks))
  )
}
