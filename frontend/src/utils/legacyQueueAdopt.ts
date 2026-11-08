// stage-56(F-5, 설계 §5.9 [S56] F) — 레거시 localStorage 반입 대기열 1회 이관 전용 모듈.
// 구 대기열(F40-② 시절)의 저장 키 2개를 읽어 POST /api/import/runs/adopt로 보내고, 성공 시 키를 지운다.
// 이후 localStorage에 반입 상태를 쓰는 코드는 없다(서버 run이 정본). 서버 adopt가 퇴역하는 릴리스에서
// 이 모듈도 함께 삭제한다(backlog 퇴역 후보).
// 구 형식 파서는 퇴역한 대기열 저장소의 읽기 로직을 최소 복사한 것이다(쓰기·구독 없음).

const QUEUE_KEY = 'study-hub:convert-queue'
const LEGACY_KEY = 'study-hub:convert-job'

type LegacySourceKind = 'file' | 'url' | 'fetch' | 'split'

// 서버 adopt body의 entries[] 요소(프론트 StoredQueueEntry 모양 그대로 — 서버가 느슨 검증).
export interface LegacyQueueEntry {
  id: string
  jobId: string | null
  sourceKind: LegacySourceKind
  fileName?: string
  url?: string
  fetchLabel?: string
  categoryPath?: string | null
  previewId?: string | null
  committed?: boolean
  startError?: string | null
  createdAt: number
  splitId?: string | null
  splitTotal?: number
}

function isValidKind(v: unknown): v is LegacySourceKind {
  return v === 'file' || v === 'url' || v === 'fetch' || v === 'split'
}

function sanitize(raw: unknown): LegacyQueueEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Partial<LegacyQueueEntry>
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
    createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
    splitId: typeof e.splitId === 'string' ? e.splitId : null,
    splitTotal: typeof e.splitTotal === 'number' ? e.splitTotal : undefined,
  }
}

// 구 단건 레코드(`study-hub:convert-job`) -> 1건 항목 승격(읽기 전용).
function promoteSingle(): LegacyQueueEntry | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Record<string, unknown>
    if (typeof p.jobId !== 'string' || !p.jobId) return null
    if (!isValidKind(p.sourceKind)) return null
    return {
      id: `legacy_${p.jobId}`,
      jobId: p.jobId,
      sourceKind: p.sourceKind,
      fileName: typeof p.fileName === 'string' ? p.fileName : undefined,
      url: typeof p.url === 'string' ? p.url : undefined,
      fetchLabel: typeof p.fetchLabel === 'string' ? p.fetchLabel : undefined,
      categoryPath: null,
      previewId: null,
      committed: false,
      startError: null,
      createdAt: Date.now(),
      splitId: null,
    }
  } catch {
    return null
  }
}

export function hasLegacyKeys(): boolean {
  try {
    return window.localStorage.getItem(QUEUE_KEY) != null || window.localStorage.getItem(LEGACY_KEY) != null
  } catch {
    return false
  }
}

// 이관 대상 읽기 — 두 키를 합쳐 반환(같은 jobId 중복 제거). 키가 없거나 파싱 불가면 빈 배열.
export function readLegacyEntries(): LegacyQueueEntry[] {
  let entries: LegacyQueueEntry[] = []
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        entries = parsed.map(sanitize).filter((e): e is LegacyQueueEntry => e != null)
      }
    }
  } catch {
    entries = []
  }
  const single = promoteSingle()
  if (single && !entries.some((e) => e.jobId === single.jobId)) entries = [...entries, single]
  return entries
}

export function clearLegacyKeys(): void {
  try {
    window.localStorage.removeItem(QUEUE_KEY)
    window.localStorage.removeItem(LEGACY_KEY)
  } catch {
    // 무시
  }
}
