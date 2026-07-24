// 재생성(F30) 잡 id 로컬 추적 — 설계 §4.10에는 "문서별 진행 중 잡 조회" 엔드포인트가 없어
// (job_id를 알아야만 GET .../regenerate/{job_id} 폴링 가능), 신고 시점에 받은 job_id를
// localStorage에 문서별로 저장해 다른 화면(퀴즈·학습 모드)에서 신고해도 문서 상세에서
// 이어서 진행 상황을 확인할 수 있게 한다. 승인/폐기 시 제거. 최종 보고 참고(명세 갭).
//
// S8(§4.11)부터는 신고 사유(reason)도 함께 저장한다 — 잡 실패 시 [API로 재시도]가 같은 사유로
// engine:'api' 재요청을 보내야 하는데, 새로고침 후에는 컴포넌트 상태에 원래 reason이 남아있지
// 않기 때문이다.
const PREFIX = 'study-hub:regen-job:'

export interface StoredRegenerateJob {
  jobId: string
  reason: string
}

export function getStoredRegenerateJob(documentId: number): StoredRegenerateJob | null {
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${documentId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredRegenerateJob
    if (!parsed.jobId) return null
    return parsed
  } catch {
    return null
  }
}

export function setStoredRegenerateJob(documentId: number, job: StoredRegenerateJob): void {
  try {
    window.localStorage.setItem(`${PREFIX}${documentId}`, JSON.stringify(job))
  } catch {
    // localStorage 사용 불가 환경 — 조용히 무시 (진행 중 배지만 못 보일 뿐 신고 자체는 성공)
  }
}

export function clearStoredRegenerateJob(documentId: number): void {
  try {
    window.localStorage.removeItem(`${PREFIX}${documentId}`)
  } catch {
    // 무시
  }
}
