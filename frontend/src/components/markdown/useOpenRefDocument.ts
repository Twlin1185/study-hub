// [원문 열기] 내비게이션 — 임베드 카드·자리표시자·링크 칩이 공유한다.
//
// 알려진 제약(2026-08-02): 해석 API(§4.19 ③) 응답 스키마에 문서 id가 없어 doc_no만으로는
// /docs/{id}로 직행할 수 없다. 백엔드가 id를 함께 내려주면(EmbedResolveItem.id) 그 경로를 쓰고,
// 없으면 doc_no를 질의로 하는 검색 화면으로 폴백한다. 폴백 여부와 무관하게 호출부는 이 훅만 쓴다.
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EmbedResolveItem } from '../../api/embeds'

export function useOpenRefDocument() {
  const navigate = useNavigate()
  return useCallback(
    (docNo: string, item?: EmbedResolveItem) => {
      if (item?.id != null) {
        navigate(`/docs/${item.id}`)
        return
      }
      navigate(`/search?q=${encodeURIComponent(docNo)}`)
    },
    [navigate],
  )
}
