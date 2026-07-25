import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Paginated } from './client'
import type { ReviewNote, ReviewNoteFilters, ReviewNotePatch } from './types'

export const reviewNoteKeys = {
  list: (filters: ReviewNoteFilters) => ['review-notes', filters] as const,
  all: (filters: Omit<ReviewNoteFilters, 'page' | 'size'>) => ['review-notes', 'all', filters] as const,
}

// 백엔드 review-notes size 상한(routers/review_notes.py `le=200`) — 이 값을 넘기면 422.
const MAX_PAGE_SIZE = 200

function buildQuery(filters: ReviewNoteFilters): string {
  const params = new URLSearchParams()
  if (filters.resolved != null) params.set('resolved', filters.resolved ? '1' : '0')
  if (filters.wrong_reason) params.set('wrong_reason', filters.wrong_reason)
  if (filters.category_id != null) params.set('category_id', String(filters.category_id))
  params.set('page', String(filters.page ?? 1))
  params.set('size', String(filters.size ?? 50))
  return params.toString()
}

// 4xx는 재요청해도 결과가 바뀌지 않으므로 즉시 포기한다(422 상한 초과 등으로 인한 재시도 폭주 방지).
function skip4xxRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}

export function useReviewNotes(filters: ReviewNoteFilters) {
  return useQuery({
    queryKey: reviewNoteKeys.list(filters),
    queryFn: () => api.get<Paginated<ReviewNote>>(`/review-notes?${buildQuery(filters)}`),
    retry: skip4xxRetry,
  })
}

// 인쇄 뷰(§5.10) 전용 — 인쇄는 페이지네이션이 아니라 완결된 전체 목록이 필요하므로, 서버 상한
// (size=200) 이내로 페이지를 순회하며 total에 도달할 때까지 수집한다. 빈 페이지를 받으면
// (total 불일치 등 방어) 즉시 중단해 무한 루프를 막는다.
export function useAllReviewNotes(filters: Omit<ReviewNoteFilters, 'page' | 'size'>) {
  return useQuery({
    queryKey: reviewNoteKeys.all(filters),
    queryFn: async () => {
      const collected: ReviewNote[] = []
      let page = 1
      for (;;) {
        const res = await api.get<Paginated<ReviewNote>>(
          `/review-notes?${buildQuery({ ...filters, page, size: MAX_PAGE_SIZE })}`,
        )
        if (res.items.length === 0) break
        collected.push(...res.items)
        if (collected.length >= res.total) break
        page += 1
      }
      return collected
    },
    retry: skip4xxRetry,
  })
}

export function useUpdateReviewNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & ReviewNotePatch) =>
      api.patch<ReviewNote>(`/review-notes/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-notes'] }),
  })
}
