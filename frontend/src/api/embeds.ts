// 문서 상호참조 — 임베드 해석 API (설계 §4.19 ③, S17/F43).
//
// POST /api/documents/resolve-embeds — 본문 전용 배치 조회(읽기 전용).
// **answer·explanation 필드는 응답 스키마에 존재하지 않는다**(필터링이 아니라 부재 — 불변 규칙 1).
// 이 모듈은 TanStack Query를 쓰지 않는다: 설계 §4.19가 "열람 컴포넌트 수명 동안의 메모리 캐시,
// 전역 영속 캐시 금지"를 확정했기 때문이다(캐시는 components/markdown/embedResolver.ts).
import { api } from './client'
import type { DocumentType } from './types'

// 요청 상한 — 중복 제거 후 50개 (§4.19 ③). 초과분은 여러 배치로 나눠 보낸다.
export const RESOLVE_EMBEDS_MAX = 50

export interface EmbedResolveItem {
  doc_no: string
  found: boolean
  // found=false면 아래 필드는 생략/null. 삭제 문서(is_active=false)는 title만 오고 content=null.
  title?: string | null
  type?: DocumentType | null
  content?: string | null
  is_active?: boolean | null
  // 설계 §4.19 ③ 확정 스키마에는 문서 id가 없다(2026-08-02). 백엔드가 추후 id를 함께 내려주면
  // [원문 열기]가 /docs/{id}로 직행하고, 없으면 doc_no 검색 화면으로 폴백한다(RefTargets 참고).
  id?: number | null
}

interface ResolveEmbedsResponse {
  items: EmbedResolveItem[]
}

// 중복 제거 + 50개 단위 분할 배치. 호출자는 한 번에 필요한 doc_no를 모아서 넘긴다.
export async function resolveEmbeds(docNos: string[]): Promise<EmbedResolveItem[]> {
  const unique = Array.from(new Set(docNos.filter(Boolean)))
  const out: EmbedResolveItem[] = []
  for (let i = 0; i < unique.length; i += RESOLVE_EMBEDS_MAX) {
    const chunk = unique.slice(i, i + RESOLVE_EMBEDS_MAX)
    const res = await api.post<ResolveEmbedsResponse>('/documents/resolve-embeds', { doc_nos: chunk })
    out.push(...(res?.items ?? []))
  }
  return out
}
