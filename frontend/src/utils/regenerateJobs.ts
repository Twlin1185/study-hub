// 재생성(F30) 잡 id 로컬 추적 — 설계 §4.10에는 "문서별 진행 중 잡 조회" 엔드포인트가 없어
// (job_id를 알아야만 GET .../regenerate/{job_id} 폴링 가능), 신고 시점에 받은 job_id를
// localStorage에 문서별로 저장해 다른 화면(퀴즈·학습 모드)에서 신고해도 문서 상세에서
// 이어서 진행 상황을 확인할 수 있게 한다. 승인/폐기 시 제거. 최종 보고 참고(명세 갭).
const PREFIX = 'study-hub:regen-job:'

export function getStoredRegenerateJobId(documentId: number): string | null {
  try {
    return window.localStorage.getItem(`${PREFIX}${documentId}`)
  } catch {
    return null
  }
}

export function setStoredRegenerateJobId(documentId: number, jobId: string): void {
  try {
    window.localStorage.setItem(`${PREFIX}${documentId}`, jobId)
  } catch {
    // localStorage 사용 불가 환경 — 조용히 무시 (진행 중 배지만 못 보일 뿐 신고 자체는 성공)
  }
}

export function clearStoredRegenerateJobId(documentId: number): void {
  try {
    window.localStorage.removeItem(`${PREFIX}${documentId}`)
  } catch {
    // 무시
  }
}
