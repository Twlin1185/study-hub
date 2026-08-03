// 반입 대기열(F40-②, 설계 §5.9) 영속 저장소 — 진행 중인 convert 잡 기록을 **배열**로 보관해
// 새로고침·재접속 후에도 목록과 진행 상태가 복원되게 한다.
//
// 기존 단건 레코드(`study-hub:convert-job`, utils/convertJob.ts)는 읽기 시 **1건 큐로 승격**한다
// — 진행 중 잡이 있는 상태로 새 빌드가 배포돼도 폴링이 끊기지 않아야 하기 때문이다(호환 필수).
// 승격 후 구 키는 제거하고 이후로는 배열 키만 사용한다.
//
// 서버 워커는 동시 1개(설계 §4.10)라 이 큐는 "병렬 실행"이 아니라 **투입 순서 기록**일 뿐이다.
// File 객체는 직렬화할 수 없어 저장하지 않는다 — 새로고침 후 재시도는 재선택 안내로 이어진다.
import type { LlmErrorInfo } from '../api/types'

const QUEUE_KEY = 'study-hub:convert-queue'
const LEGACY_KEY = 'study-hub:convert-job'

// 'split'(S23, §4.25, F49) — 분할 위저드가 enqueue한 조각. 서버가 이미 등록한 기존 convert
// 잡의 job_id를 그대로 받아 큐에 편입하는 항목이라, POST /api/convert를 다시 부르는 'file'과
// 달리 File 객체·재시도 대상이 없다(원본 재업로드는 위저드 쪽 책임 — §4.25 세칙).
export type QueueSourceKind = 'file' | 'url' | 'fetch' | 'split'

export interface StoredQueueEntry {
  // 프론트 전용 식별자 — jobId가 아직 없는 시작 대기 상태에서도 카드를 구분해야 한다.
  id: string
  jobId: string | null
  sourceKind: QueueSourceKind
  fileName?: string
  url?: string
  fetchLabel?: string
  // 시작 시 함께 보낸 분류 경로(F40-③) — 재시도 시 같은 경로로 다시 요청한다.
  categoryPath?: string | null
  // 변환 완료 시 받은 preview_id. **잡(TTL 1h·서버 재시작으로 소멸)보다 오래 남겨야** 한다 —
  // 뒤 항목을 검토하는 동안 앞 항목의 잡이 사라져도, 보존된 JSON에서 미리보기가 복구되므로
  // (F40-①, §4.3) 이 id만 있으면 [검토]를 계속 이어갈 수 있다.
  previewId?: string | null
  // 커밋 완료(반입 완료) — 목록에 남겨 두되 폴링은 멈춘다.
  committed?: boolean
  // POST /api/convert 자체가 거부된 경우(예: 한도 기억 사전 차단 409).
  startError?: string | null
  startErrorInfo?: LlmErrorInfo | null
  createdAt: number
}

function isValidKind(v: unknown): v is QueueSourceKind {
  return v === 'file' || v === 'url' || v === 'fetch' || v === 'split'
}

export function newEntryId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function sanitize(raw: unknown): StoredQueueEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Partial<StoredQueueEntry>
  if (!isValidKind(e.sourceKind)) return null
  if (typeof e.id !== 'string' || !e.id) return null
  return {
    id: e.id,
    jobId: typeof e.jobId === 'string' ? e.jobId : null,
    sourceKind: e.sourceKind,
    fileName: typeof e.fileName === 'string' ? e.fileName : undefined,
    url: typeof e.url === 'string' ? e.url : undefined,
    fetchLabel: typeof e.fetchLabel === 'string' ? e.fetchLabel : undefined,
    categoryPath: typeof e.categoryPath === 'string' ? e.categoryPath : null,
    previewId: typeof e.previewId === 'string' ? e.previewId : null,
    committed: e.committed === true,
    startError: typeof e.startError === 'string' ? e.startError : null,
    startErrorInfo: e.startErrorInfo ?? null,
    createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
  }
}

// 구 단건 레코드 → 1건 큐 승격(호환). 형태는 utils/convertJob.ts의 StoredConvertJob.
function promoteLegacy(): StoredQueueEntry | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      jobId?: unknown
      sourceKind?: unknown
      url?: unknown
      fileName?: unknown
      fetchLabel?: unknown
    }
    if (typeof parsed.jobId !== 'string' || !parsed.jobId) return null
    if (!isValidKind(parsed.sourceKind)) return null
    return {
      id: newEntryId(),
      jobId: parsed.jobId,
      sourceKind: parsed.sourceKind,
      fileName: typeof parsed.fileName === 'string' ? parsed.fileName : undefined,
      url: typeof parsed.url === 'string' ? parsed.url : undefined,
      fetchLabel: typeof parsed.fetchLabel === 'string' ? parsed.fetchLabel : undefined,
      categoryPath: null,
      previewId: null,
      committed: false,
      startError: null,
      startErrorInfo: null,
      createdAt: Date.now(),
    }
  } catch {
    return null
  }
}

function clearLegacy(): void {
  try {
    window.localStorage.removeItem(LEGACY_KEY)
  } catch {
    // 무시
  }
}

export function readQueue(): StoredQueueEntry[] {
  let entries: StoredQueueEntry[] = []
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        entries = parsed.map(sanitize).filter((e): e is StoredQueueEntry => e != null)
      }
    }
  } catch {
    entries = []
  }

  const legacy = promoteLegacy()
  if (legacy) {
    clearLegacy()
    // 같은 잡이 이미 배열에 있으면 중복 추가하지 않는다(두 번 승격되는 사고 방지).
    if (!entries.some((e) => e.jobId === legacy.jobId)) {
      entries = [...entries, legacy]
      writeQueue(entries)
    }
  }
  return entries
}

export function writeQueue(entries: StoredQueueEntry[]): void {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage 사용 불가 환경 — 조용히 무시(복원만 못 할 뿐 잡 자체는 서버에서 진행)
  }
}

// 카드 제목 — 파일명 · URL · 사이트 회차 라벨 순으로 사람이 알아볼 수 있는 이름을 고른다.
export function entryLabel(entry: StoredQueueEntry): string {
  return entry.fileName || entry.url || entry.fetchLabel || entry.jobId || '이름 없는 작업'
}
