import { useQuery } from '@tanstack/react-query'
import { api, type Paginated } from './client'
import type { DocumentType, SearchResultItem } from './types'

// 설계 §4.9 (v1.5 확정) — GET /api/search?q=&type=&page=&size= (FTS5, 스니펫 포함).
// 응답은 §3 페이지 봉투(Paginated). q가 비어 있으면 호출하지 않는다.
export function useSearch(q: string, type?: DocumentType | '', page = 1, size = 30) {
  const trimmed = q.trim()
  const params = new URLSearchParams()
  params.set('q', trimmed)
  if (type) params.set('type', type)
  params.set('page', String(page))
  params.set('size', String(size))

  return useQuery({
    queryKey: ['search', trimmed, type ?? '', page, size],
    queryFn: () => api.get<Paginated<SearchResultItem>>(`/search?${params.toString()}`),
    enabled: trimmed.length > 0,
  })
}
