// 참조 피커의 **최근 문서 목록** — localStorage 로컬 저장(stage-34 규약 A ①: "신규 API 0").
//
// **한계를 먼저 밝힌다**: D9 격리 계약상 편집기 v2는 기존 문서 뷰어(`src/pages/**`)에 훅을 걸 수
// 없다. 그래서 여기 쌓이는 것은 "문서 화면에서 최근 열람한 문서"가 아니라 **"노트에서 최근 참조·
// 삽입한 문서"**다. 문서 열람 이력과 합치려면 뷰어 쪽 기록 지점이 필요한데 그것은 M34(연결) 범위다.
//
// 저장 형식은 최소한만 — 제목은 표시용 캐시일 뿐이고, 실제 제목은 항상 `resolve-embeds`가 이긴다
// (제목이 바뀌면 칩은 추종형으로 따라간다 — 규약 A ③).

const STORAGE_KEY = 'editor2.recentRefDocs.v1'
const MAX_ITEMS = 10

export interface RecentDoc {
  doc_no: string
  title: string
  /** 문서 내부 PK — 있으면 `[문서 열기]`가 바로 `/docs/{id}`로 간다. */
  id?: number | null
}

function isRecentDoc(value: unknown): value is RecentDoc {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.doc_no === 'string' && typeof item.title === 'string'
}

export function readRecentDocs(): RecentDoc[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentDoc).slice(0, MAX_ITEMS)
  } catch {
    // 사용자 데이터가 아니라 편의 캐시다 — 깨졌으면 조용히 빈 목록으로 시작한다.
    return []
  }
}

/** 최근 목록 맨 앞으로 올린다(중복 제거 · 최대 10건). */
export function rememberRecentDoc(doc: RecentDoc): void {
  if (typeof window === 'undefined' || !doc.doc_no) return
  const next = [doc, ...readRecentDocs().filter((item) => item.doc_no !== doc.doc_no)].slice(0, MAX_ITEMS)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 용량 초과 등 — 기능의 본질이 아니므로 삼킨다.
  }
}
