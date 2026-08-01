// [원문 열기] 내비게이션 — 임베드 카드·자리표시자·링크 칩이 공유한다.
//
// 해석 API(설계 §4.19 ③, 2026-08-02 보완 확정)는 `found: true`인 항목에 문서 내부 PK(`id`)를
// 항상 내려준다(삭제 문서 포함) → 기존 `/docs/{id}` 라우트로 직행한다. 해석 응답이 아직 도착하지
// 않아 id를 모르는 동안에는 호출부가 버튼을 비활성으로 두므로, 이 훅은 id가 확정된 경우만 받는다.
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export function useOpenRefDocument() {
  const navigate = useNavigate()
  return useCallback(
    (documentId: number) => {
      navigate(`/docs/${documentId}`)
    },
    [navigate],
  )
}
