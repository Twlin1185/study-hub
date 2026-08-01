// AI 풀이 생성(F44-②) 잡 id 로컬 추적 — utils/regenerateJobs.ts(F30)와 동일한 명세 갭 대응:
// 설계 §4.20 ②에는 "문서별 진행 중 잡 조회" 엔드포인트가 없어(job_id를 알아야만
// GET .../explain/{job_id} 폴링 가능), 시작 시점에 받은 job_id를 localStorage에 문서별로
// 저장해 새로고침 후에도 진행 상황을 이어서 확인할 수 있게 한다. 승인/폐기 시 제거.
const PREFIX = 'study-hub:explain-job:'

export interface StoredExplainJob {
  jobId: string
}

export function getStoredExplainJob(documentId: number): StoredExplainJob | null {
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${documentId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredExplainJob
    if (!parsed.jobId) return null
    return parsed
  } catch {
    return null
  }
}

export function setStoredExplainJob(documentId: number, job: StoredExplainJob): void {
  try {
    window.localStorage.setItem(`${PREFIX}${documentId}`, JSON.stringify(job))
  } catch {
    // localStorage 사용 불가 환경 — 조용히 무시 (진행 중 배지만 못 보일 뿐 생성 자체는 성공)
  }
}

export function clearStoredExplainJob(documentId: number): void {
  try {
    window.localStorage.removeItem(`${PREFIX}${documentId}`)
  } catch {
    // 무시
  }
}
