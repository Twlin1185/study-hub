// 문서 상세 편집 표면(진입점① `/docs/:id` [편집] — `DocBlockEditor.tsx`) 세션 원본 스냅샷.
//
// stage-39 F-1 실측 편입분(2026-08-23 지시서 정정 — 규약 D·E) — 노트 편집(§5.16)과 **동일 계약
// (규약 A~E)**을 적용하되, 스냅샷 **형태**만 문서 표면에 맞게 확장한다: 규약 E "블록 상태(제목
// 포함)"를 문서 표면에 준용하면 편집 대상 필드 전체(제목·보기·정답·난이도·본문·해설 2표면)가
// 스냅샷 범위다. 저장/삭제 자체는 표면 중립 `sessionSnapshotStorage`(노트 표면과 공유 — 이원화
// 금지)에 위임한다.
import { clearSnapshot, readSnapshot, writeSnapshot } from '../lib/sessionSnapshotStorage'
import { normalizeBlockTree } from '../lib/blockTreeNormalize'
import type { AdapterSidecar, BnBlock } from '../adapter'

const SURFACE = 'doc'

export interface DocBlockSurfaceSnapshot {
  blocks: BnBlock[]
  sidecar: AdapterSidecar
}

export interface DocBlockSnapshot {
  title: string
  choices: string
  answer: string
  difficulty: string
  content: DocBlockSurfaceSnapshot
  /** 해설 표면이 없는 문서(개념·플래시카드)는 `null` — 노트의 `refChip` 계열과 같은 "없으면 없다" 원칙. */
  explanation: DocBlockSurfaceSnapshot | null
}

function isSurfaceSnapshot(value: unknown): value is DocBlockSurfaceSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<DocBlockSurfaceSnapshot>
  return Array.isArray(v.blocks) && typeof v.sidecar === 'object' && v.sidecar !== null
}

function isDocBlockSnapshot(value: unknown): value is DocBlockSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<DocBlockSnapshot>
  return (
    typeof v.title === 'string' &&
    typeof v.choices === 'string' &&
    typeof v.answer === 'string' &&
    typeof v.difficulty === 'string' &&
    isSurfaceSnapshot(v.content) &&
    (v.explanation === null || v.explanation === undefined || isSurfaceSnapshot(v.explanation))
  )
}

/** 부재·손상 시 `null` — 호출부는 "생략 진입"으로 처리한다. */
export function readDocBlockSnapshot(docId: number): DocBlockSnapshot | null {
  return readSnapshot(SURFACE, docId, isDocBlockSnapshot)
}

/** 기록 성공 여부를 돌려준다 — 실패 시 호출부가 [취소]를 비활성 + 안내한다(규약 E 상한 조항). */
export function writeDocBlockSnapshot(docId: number, snapshot: DocBlockSnapshot): boolean {
  return writeSnapshot(SURFACE, docId, snapshot)
}

/** 정상 종결([저장]/[취소]/"편집 종료"·정상 이탈) — 다음 진입에서 거짓 복구 다이얼로그가 뜨지 않게 지운다. */
export function clearDocBlockSnapshot(docId: number): void {
  clearSnapshot(SURFACE, docId)
}

function surfaceBlocksEqual(a: BnBlock[] | null, b: BnBlock[] | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return JSON.stringify(normalizeBlockTree(a)) === JSON.stringify(normalizeBlockTree(b))
}

/**
 * 현재 로드된(자동저장분) 내용과 스냅샷이 그대로 같은지 — 같으면 거짓 복구 다이얼로그를 막는다.
 *
 * **검토 중요 2 수정**: 체크포인트(`a`)는 이제 어느 경로로 확보됐든(진입 시점·명시 저장 재기록)
 * 항상 `toBlockNoteBlocks`를 거친 **로드 형태**다(`DocBlockEditor.tsx`의 명시 저장 성공 콜백이
 * 저장한 앱 블록을 다시 `toBlockNoteBlocks`로 되읽어 체크포인트에 쓴다 — 실 편집기 스키마
 * 산출물을 직접 쓰지 않는다). `normalizeBlockTree`는 그래도 남을 수 있는 사소한 키 차이(빈
 * `children`/`props`)에 대한 방어망으로 유지한다 — 두 출처가 이미 대개 같은 형태이므로 정상
 * 경로에서는 사실상 항상 항등이다.
 */
export function docBlockSnapshotsEqual(
  a: DocBlockSnapshot,
  b: {
    title: string
    choices: string
    answer: string
    difficulty: string
    content: BnBlock[]
    explanation: BnBlock[] | null
  },
): boolean {
  return (
    a.title === b.title &&
    a.choices === b.choices &&
    a.answer === b.answer &&
    a.difficulty === b.difficulty &&
    surfaceBlocksEqual(a.content.blocks, b.content) &&
    surfaceBlocksEqual(a.explanation?.blocks ?? null, b.explanation)
  )
}
