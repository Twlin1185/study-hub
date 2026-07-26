import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import type {
  ConvertJobStartResponse,
  FetchAdaptersResponse,
  FetchCertsResponse,
  FetchExamsRequest,
  FetchExamsResponse,
  FetchImportRequest,
} from './types'

// 설계 §4.13(S10, F35 2단계) — 사이트에서 가져오기. 신규는 수집기(어댑터)뿐, 진행·미리보기는
// 기존 convert 잡 큐(useConvertJob·useConvertedPreview, api/convert.ts)를 그대로 재사용한다.

export function useFetchAdapters() {
  return useQuery({
    queryKey: ['fetch', 'adapters'],
    queryFn: () => api.get<FetchAdaptersResponse>('/fetch/adapters'),
    staleTime: 60_000,
  })
}

// 자격증 검색 — 서버가 TTL 24h로 캐시하므로 프론트도 매 타이핑마다 조회하지 않고 커밋된
// 검색어(q)에 대해서만 질의한다(호출부에서 debounce/버튼 제출로 committed q를 넘김).
export function useFetchCerts(q: string) {
  return useQuery({
    queryKey: ['fetch', 'certs', q],
    queryFn: () => api.get<FetchCertsResponse>(`/fetch/certs?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  })
}

export function useFetchExams() {
  return useMutation({
    mutationFn: (body: FetchExamsRequest) => api.post<FetchExamsResponse>('/fetch/exams', body),
  })
}

// convert 잡 큐 재사용(kind='fetch') — 응답 형태는 useStartConvert와 동일 {job_id}.
// 진행·결과 조회는 기존 GET /api/convert/{job_id}(useConvertJob)를 그대로 쓴다.
export function useFetchImport() {
  return useMutation({
    mutationFn: (body: FetchImportRequest) => api.post<ConvertJobStartResponse>('/fetch/import', body),
  })
}
