// 반입 화면(§5.9) "원본 파일로 시작"/"URL로 시작" 진행 중 잡을 localStorage에 추적 — 새로고침해도
// 폴링이 이어지게 한다(설계 §4.11 진행 가시화 요구사항). convert 잡 큐는 동시 1개(설계 §4.10)이므로
// 전역 단일 슬롯으로 충분하다. 파일 소스는 File 객체를 되살릴 수 없어 jobId만 복원되고, URL 소스는
// url 문자열도 함께 저장해 [API로 재시도]가 새로고침 후에도 동작한다.
const KEY = 'study-hub:convert-job'

export interface StoredConvertJob {
  jobId: string
  sourceKind: 'file' | 'url'
  url?: string
  fileName?: string
}

export function getStoredConvertJob(): StoredConvertJob | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredConvertJob
    if (!parsed.jobId || (parsed.sourceKind !== 'file' && parsed.sourceKind !== 'url')) return null
    return parsed
  } catch {
    return null
  }
}

export function setStoredConvertJob(job: StoredConvertJob): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(job))
  } catch {
    // localStorage 사용 불가 환경 — 조용히 무시 (새로고침 재개만 못 할 뿐 잡 자체는 서버에서 진행)
  }
}

export function clearStoredConvertJob(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // 무시
  }
}
