import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { ResolveEmbedsResponse } from './types'

// 설계 §4.19 ③·⑥ — 배치 해석. 캐시 키 = ['embeds', 정렬된 doc_no 목록] — 문서 열람 1회당
// 배치 1회(+중첩 시 깊이당 1회)로 수렴한다. 문서 변경 mutation 후 이 prefix를 invalidate한다
// (api/documents.ts·convert.ts·import.ts의 각 mutation onSuccess에 병기).
export const embedKeys = {
  all: ['embeds'] as const,
  batch: (docNos: string[]) => ['embeds', docNos] as const,
}

// 요청당 최대 50개(설계 §4.19 ③) — 초과분은 호출부에서 배치를 나누지 않고 그냥 절단한다.
// (개인 규모에서 한 문서 스캔이 50개를 넘는 참조를 갖는 경우는 사실상 없다 — 넘으면 문서
// 설계 신호로 보고 서버 422를 그대로 사용자에게 보여주는 대신 조용히 앞 50개만 요청한다.)
const MAX_BATCH = 50

export function useResolveEmbeds(docNos: string[]) {
  const key = [...new Set(docNos)].sort().slice(0, MAX_BATCH)
  return useQuery({
    queryKey: embedKeys.batch(key),
    queryFn: () => api.post<ResolveEmbedsResponse>('/documents/resolve-embeds', { doc_nos: key }),
    enabled: key.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}
